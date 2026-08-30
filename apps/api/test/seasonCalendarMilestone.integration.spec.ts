/**
 * `seasonCalendar.rescheduleMilestone` e `cancelMilestone` — le due uscite motivate dal ciclo di
 * vita di un evento.
 *
 * Entrambe erano scoperte: gli schemi di input sono stati condivisi con il dialog senza che nulla
 * potesse dimostrare cosa accettano. Qui si fissano la regola sulla motivazione (obbligatoria,
 * trimmata, max 500) e le due proprietà che giustificano l'esistenza delle procedure: reschedule è
 * l'unica via per muovere un evento congelato, cancel è l'unico modo di ritirarlo senza distruggerne
 * la storia.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  createCalendarFixture,
  createCallerWithSession,
  createAnonymousCaller,
  createTestUser,
  expectUnauthorized,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
let adminSession: UserSession;
let editorSession: UserSession;
let viewerSession: UserSession;

let calendarId: string;
let planningGroupId: string;
let phaseId: string;

const asAdmin = () => createCallerWithSession(adminSession);
const asEditor = () => createCallerWithSession(editorSession);
const asViewer = () => createCallerWithSession(viewerSession);

/**
 * Un gruppo con `frozenAt` valorizzato, nuovo a ogni chiamata: l'indice unico parziale
 * `(planningGroupId, phaseId) WHERE cancelledAt IS NULL` ammette un solo evento attivo con fase per
 * gruppo, quindi condividerne uno farebbe collidere i test fra loro invece che con il codice.
 */
async function createFrozenGroup(): Promise<string> {
  const group = await prisma.planningGroup.create({
    data: { calendarId, name: `Congelato ${randomUUID().slice(0, 8)}`, frozenAt: new Date() },
  });
  return group.id;
}

/** Un evento nuovo nel gruppo indicato. Ogni test ne crea uno: le mutation sono distruttive. */
async function createEvent(
  opts: { groupId?: string; startAt?: Date; endAt?: Date | null; withPhase?: boolean; allDay?: boolean } = {}
) {
  const { groupId = planningGroupId, startAt = new Date('2099-06-01'), endAt = null, withPhase = false, allDay = false } = opts;
  return prisma.calendarEvent.create({
    data: {
      calendarId,
      planningGroupId: groupId,
      title: `Milestone ${randomUUID().slice(0, 8)}`,
      startAt,
      endAt,
      allDay,
      ...(withPhase ? { phaseId } : {}),
    },
  });
}

beforeAll(async () => {
  prisma = await setupTestDb();

  const [admin, editor, viewer] = await Promise.all([
    createTestUser('admin'),
    createTestUser('editor'),
    createTestUser('viewer'),
  ]);
  adminSession = admin.session;
  editorSession = editor.session;
  viewerSession = viewer.session;

  const fixture = await createCalendarFixture(prisma, { prefix: 'MIL', groupName: 'Gruppo principale' });
  calendarId = fixture.calendarId;
  planningGroupId = fixture.planningGroupId;

  // Senza questo `assertBrandAccess` risponderebbe FORBIDDEN a editor e viewer prima ancora di
  // guardare i permessi, e i test sui ruoli passerebbero per il motivo sbagliato.
  await grantBrandAccess(prisma, {
    brandIds: [fixture.brandId],
    userIds: [editor.user.id, viewer.user.id],
    label: 'Milestone',
  });

  const phase = await prisma.phase.create({
    data: { value: `MPH_${fixture.uid}`, label: 'Fase milestone', order: 210, isActive: true },
  });
  phaseId = phase.id;
});

describe('rescheduleMilestone — la motivazione', () => {
  it('è obbligatoria', async () => {
    const event = await createEvent();
    await expect(
      // @ts-expect-error -- obbligatoria nello schema: qui si verifica che lo sia anche a runtime,
      // per un client che aggira i tipi.
      asAdmin().seasonCalendar.rescheduleMilestone({ id: event.id, startAt: new Date('2099-07-01').toISOString() })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('non può essere di soli spazi, e arriva senza spazi ai bordi', async () => {
    const event = await createEvent();
    await expect(
      asAdmin().seasonCalendar.rescheduleMilestone({
        id: event.id, startAt: new Date('2099-07-01').toISOString(), reason: '   ',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await asAdmin().seasonCalendar.rescheduleMilestone({
      id: event.id, startAt: new Date('2099-07-01').toISOString(), reason: '  slitta la consegna  ',
    });
    const log = await prisma.auditLog.findFirst({
      where: { targetId: event.id, action: 'CALENDAR_EVENT_RESCHEDULE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((log!.metadata as { reason?: string }).reason).toBe('slitta la consegna');
  });

  it('ha un tetto di 500 caratteri', async () => {
    const event = await createEvent();
    await expect(
      asAdmin().seasonCalendar.rescheduleMilestone({
        id: event.id, startAt: new Date('2099-07-01').toISOString(), reason: 'x'.repeat(501),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      asAdmin().seasonCalendar.rescheduleMilestone({
        id: event.id, startAt: new Date('2099-07-01').toISOString(), reason: 'x'.repeat(500),
      })
    ).resolves.toMatchObject({ id: event.id });
  });
});

describe('rescheduleMilestone — è l’unica uscita da un evento congelato', () => {
  it('sposta un evento che updateMilestone rifiuterebbe', async () => {
    // Fase + gruppo congelato + scadenza passata = `isEventDateLocked`. È la situazione per cui la
    // procedura esiste: la data è un impegno preso, si muove solo dichiarando perché.
    const locked = await createEvent({ groupId: await createFrozenGroup(), startAt: new Date('2020-01-01'), withPhase: true });

    await expect(
      asAdmin().seasonCalendar.updateMilestone({
        id: locked.id, data: { startAt: new Date('2020-02-01').toISOString() },
      })
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await expect(
      asAdmin().seasonCalendar.rescheduleMilestone({
        id: locked.id, startAt: new Date('2020-02-01').toISOString(), reason: 'fornitore in ritardo',
      })
    ).resolves.toMatchObject({ id: locked.id });
  });

  it('non riscrive il baseline: la varianza continua a misurare sul piano originale', async () => {
    const baselineStart = new Date('2099-06-01');
    const event = await prisma.calendarEvent.create({
      data: {
        calendarId, planningGroupId: await createFrozenGroup(), title: `Baseline ${randomUUID().slice(0, 8)}`,
        startAt: baselineStart, baselineStartAt: baselineStart,
      },
    });

    await asAdmin().seasonCalendar.rescheduleMilestone({
      id: event.id, startAt: new Date('2099-09-01').toISOString(), reason: 'ripianificato',
    });

    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.startAt.toISOString()).toBe(new Date('2099-09-01').toISOString());
    expect(after.baselineStartAt?.toISOString()).toBe(baselineStart.toISOString());
  });

  it('registra in chiaro il cambio di allDay', async () => {
    // `oldAllDay`/`newAllDay` arrivavano come `[REDACTED]`: lo spread condizionale che le aggiunge
    // nasconde le chiavi al controllo di tipo su `AuditMetadata`, quindi nessuno se n'era accorto.
    const event = await createEvent({ allDay: false });
    await asAdmin().seasonCalendar.rescheduleMilestone({
      id: event.id, startAt: new Date('2099-07-01').toISOString(), allDay: true, reason: 'diventa giornata intera',
    });

    const log = await prisma.auditLog.findFirst({
      where: { targetId: event.id, action: 'CALENDAR_EVENT_RESCHEDULE' },
      orderBy: { createdAt: 'desc' },
    });
    const metadata = log!.metadata as { oldAllDay?: unknown; newAllDay?: unknown };
    expect(metadata.oldAllDay).toBe(false);
    expect(metadata.newAllDay).toBe(true);
  });
});

describe('cancelMilestone — ritirare senza distruggere', () => {
  it('registra chi, quando e perché', async () => {
    const event = await createEvent();
    await asAdmin().seasonCalendar.cancelMilestone({ id: event.id, reason: '  campionatura annullata  ' });

    const after = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.cancelledAt).not.toBeNull();
    expect(after.cancelReason).toBe('campionatura annullata');
    expect(after.cancelledByUserId).toBe(adminSession.user.id);
  });

  it('ri-annullare va in conflitto', async () => {
    const event = await createEvent();
    await asAdmin().seasonCalendar.cancelMilestone({ id: event.id, reason: 'annullata' });
    await expect(
      asAdmin().seasonCalendar.cancelMilestone({ id: event.id, reason: 'di nuovo' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('un evento annullato non si può più spostare', async () => {
    const event = await createEvent();
    await asAdmin().seasonCalendar.cancelMilestone({ id: event.id, reason: 'annullata' });
    await expect(
      asAdmin().seasonCalendar.rescheduleMilestone({
        id: event.id, startAt: new Date('2099-08-01').toISOString(), reason: 'tentativo',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('libera lo slot fase+gruppo, che l’indice unico parziale teneva occupato', async () => {
    const group = await prisma.planningGroup.create({
      data: { calendarId, name: `Slot ${randomUUID().slice(0, 8)}` },
    });
    const first = await createEvent({ groupId: group.id, withPhase: true });

    await expect(createEvent({ groupId: group.id, withPhase: true })).rejects.toThrow();

    await asAdmin().seasonCalendar.cancelMilestone({ id: first.id, reason: 'sostituita' });
    await expect(createEvent({ groupId: group.id, withPhase: true })).resolves.toMatchObject({
      planningGroupId: group.id,
    });
  });

  it('è permesso su un evento congelato, dove deleteMilestone non lo è', async () => {
    // La ragione per cui cancel esiste: un impegno passato si ritira, non si cancella.
    const locked = await createEvent({ groupId: await createFrozenGroup(), startAt: new Date('2020-01-01'), withPhase: true });

    await expect(
      asAdmin().seasonCalendar.deleteMilestone({ id: locked.id })
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await expect(
      asAdmin().seasonCalendar.cancelMilestone({ id: locked.id, reason: 'ritirata' })
    ).resolves.toBeTruthy();
  });
});

describe('chi può muovere e annullare', () => {
  it('un editor con accesso al brand può', async () => {
    const event = await createEvent();
    await expect(
      asEditor().seasonCalendar.rescheduleMilestone({
        id: event.id, startAt: new Date('2099-07-15').toISOString(), reason: 'riorganizzazione',
      })
    ).resolves.toMatchObject({ id: event.id });
  });

  it('un viewer no', async () => {
    const event = await createEvent();
    await expectUnauthorized(
      () => asViewer().seasonCalendar.cancelMilestone({ id: event.id, reason: 'tentativo' }),
      'FORBIDDEN'
    );
  });

  it('un anonimo nemmeno', async () => {
    const event = await createEvent();
    const anon = await createAnonymousCaller();
    await expectUnauthorized(
      () => anon.seasonCalendar.cancelMilestone({ id: event.id, reason: 'tentativo' }),
      'UNAUTHORIZED'
    );
  });

  it('un evento inesistente è NOT_FOUND, non un errore generico', async () => {
    await expect(
      asAdmin().seasonCalendar.cancelMilestone({ id: randomUUID(), reason: 'tentativo' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
