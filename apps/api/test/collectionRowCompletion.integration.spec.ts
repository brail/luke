/**
 * Explicit completion of a collection layout row (`rows.setCompleted`) and what depends on
 * it: the frozen outcome computed by the alert engine and the total time to completion.
 *
 * Why an explicit state is needed: the calendar cannot infer it. A row sitting at the last
 * phase has *reached* it, not completed it (`getActivePhaseFromEvents` still measures it against
 * that phase's deadline), so without a declared signal there is no moment at which
 * a row "finishes".
 *
 * Covers: RBAC of the two new procedures, audit row, idempotence of completion (the original
 * date must not be overwritten), reopening, on-time/late outcome chosen against the last
 * milestone tied to an **active** phase, exclusion of completed rows from the bottleneck
 * index, and lead time with its exclusions.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import {
  createAnonymousCaller,
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let editorSession: UserSession;
let viewerSession: UserSession;
let layoutId: string;
let groupId: string;
let phaseId: string;
/** Planning group with a milestone due in 2099: closing today is early. */
let futureDeadlineGroupId: string;
/** Group with a milestone due in 2020: closing today is late. */
let pastDeadlineGroupId: string;
/** Group whose only milestone is attached to a deactivated phase. */
let retiredPhaseGroupId: string;
/** Group with milestones on two active phases: a row sitting at the first one skips one by completing. */
let skipGroupId: string;
/** Group whose only milestones sit on a retired phase: it no longer measures anything. */
let onlyRetiredGroupId: string;
let finalPhaseValue: string;

const asAdmin = () => createCallerWithSession(adminSession);
const asEditor = () => createCallerWithSession(editorSession);
const asViewer = () => createCallerWithSession(viewerSession);

async function createRow(planningGroupId?: string) {
  return asAdmin().collectionLayout.rows.create({
    groupId,
    planningGroupId,
    gender: 'UOMO',
    line: `Riga ${randomUUID().slice(0, 8)}`,
    status: COLLECTION_STATUS[0],
    productCategory: 'TEST',
    skuForecast: null,
    qtyForecast: null,
    phaseId,
  });
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();

  const [admin, editor, viewer] = await Promise.all([
    createTestUser('admin'),
    createTestUser('editor'),
    createTestUser('viewer'),
  ]);
  adminSession = admin.session;
  editorSession = editor.session;
  viewerSession = viewer.session;

  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `CB${uid}`, name: `Compl Brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `CS${uid}`, name: `Compl Season ${uid}`, year: 2034, isActive: true } }),
  ]);

  await grantBrandAccess(prisma, {
    brandIds: [brand.id],
    userIds: [editor.user.id, viewer.user.id],
    label: 'Compl',
  });

  const layout = await asAdmin().collectionLayout.getOrCreate({
    brandId: brand.id,
    seasonId: season.id,
    availableGenders: ['UOMO'],
  });
  layoutId = layout.id;
  const group = await asAdmin().collectionLayout.groups.create({
    collectionLayoutId: layout.id,
    data: { name: 'Gruppo', order: 0 },
  });
  groupId = group.id;

  const [phase, retiredPhase, finalPhase] = await Promise.all([
    prisma.phase.create({ data: { value: `CPH_${uid}`, label: 'Fase attiva', order: 200, isActive: true } }),
    prisma.phase.create({ data: { value: `CPHR_${uid}`, label: 'Fase ritirata', order: 201, isActive: false } }),
    prisma.phase.create({ data: { value: `CPHF_${uid}`, label: 'Fase finale', order: 202, isActive: true } }),
  ]);
  phaseId = phase.id;
  finalPhaseValue = finalPhase.value;

  // The season calendar is the one the engine resolves from the layout (brand + season).
  const calendar = await prisma.seasonCalendar.create({ data: { brandId: brand.id, seasonId: season.id } });
  const [future, past, retired, skip, onlyRetired] = await Promise.all([
    prisma.planningGroup.create({ data: { calendarId: calendar.id, name: `Futuro ${uid}` } }),
    prisma.planningGroup.create({ data: { calendarId: calendar.id, name: `Passato ${uid}` } }),
    prisma.planningGroup.create({ data: { calendarId: calendar.id, name: `Ritirato ${uid}` } }),
    prisma.planningGroup.create({ data: { calendarId: calendar.id, name: `Salto ${uid}` } }),
    prisma.planningGroup.create({ data: { calendarId: calendar.id, name: `Solo ritirate ${uid}` } }),
  ]);
  futureDeadlineGroupId = future.id;
  pastDeadlineGroupId = past.id;
  retiredPhaseGroupId = retired.id;
  skipGroupId = skip.id;
  onlyRetiredGroupId = onlyRetired.id;

  await Promise.all([
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: future.id, phaseId: phase.id, title: 'Gate futuro', startAt: new Date('2099-06-30') },
    }),
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: past.id, phaseId: phase.id, title: 'Gate passato', startAt: new Date('2020-06-30') },
    }),
    // Same group, two milestones: one on an active phase (2020), one on a retired phase and further
    // out in time (2099). This checks which of the two acts as the closing deadline.
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: retired.id, phaseId: phase.id, title: 'Gate attivo', startAt: new Date('2020-06-30') },
    }),
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: retired.id, phaseId: retiredPhase.id, title: 'Gate ritirato', startAt: new Date('2099-06-30') },
    }),
    // Two milestones on active phases: a row sitting at the first one skips one by completing.
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: skip.id, phaseId: phase.id, title: 'Gate intermedio', startAt: new Date('2099-06-30') },
    }),
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: skip.id, phaseId: finalPhase.id, title: 'Gate finale', startAt: new Date('2099-09-30') },
    }),
    // The group's only milestone, on a retired phase: it must no longer provide a deadline.
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: onlyRetired.id, phaseId: retiredPhase.id, title: 'Gate solo ritirato', startAt: new Date('2020-06-30') },
    }),
  ]);
});

/** Row in the group that has a later milestone: completing here skips "Final phase". */
function createRowAtEarlierPhase() {
  return createRow(skipGroupId);
}

describe('rows.setCompleted — permessi', () => {
  it('un viewer non può concludere una riga', async () => {
    const row = await createRow();
    await expectUnauthorized(
      () => asViewer().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' }),
      'FORBIDDEN'
    );
  });

  it('un anonimo non può concludere una riga', async () => {
    const row = await createRow();
    const anon = await createAnonymousCaller();
    await expectUnauthorized(
      () => anon.collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' }),
      'UNAUTHORIZED'
    );
  });

  it('un editor può concludere: è la stessa scrittura di rows.update, non un privilegio admin', async () => {
    const row = await createRow();
    const result = await asEditor().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });
    expect(result.completedAt).toBeInstanceOf(Date);
  });
});

describe('rows.setCompleted — stato e audit', () => {
  it('scrive una riga di audit distinta per conclusione e riapertura', async () => {
    const row = await createRow();

    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: false, note: 'motivazione di test' });

    const [completeLogs, reopenLogs] = await Promise.all([
      prisma.auditLog.findMany({ where: { action: 'COLLECTION_ROW_COMPLETE', targetId: row.id } }),
      prisma.auditLog.findMany({ where: { action: 'COLLECTION_ROW_REOPEN', targetId: row.id } }),
    ]);
    expect(completeLogs).toHaveLength(1);
    expect(reopenLogs).toHaveLength(1);
    expect(completeLogs[0].targetType).toBe('CollectionLayoutRow');
    expect(completeLogs[0].actorId).toBe(adminSession.user.id);

    // `completedAt` is among the SAFE_KEYS of `sanitizeMetadata`: the audit row must receive
    // the value, not `[REDACTED]`. Each row records the *resulting* state, not the previous one.
    expect((completeLogs[0].metadata as { completedAt: string | null }).completedAt).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
    expect((reopenLogs[0].metadata as { completedAt: string | null }).completedAt).toBeNull();
  });

  it('concludere due volte non riscrive la data della prima conclusione', async () => {
    // This is the data point the outcome is measured against: a double click, or two open tabs, must not
    // push forward the moment at which the row closed.
    const row = await createRow();
    const first = await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });
    const second = await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });
    expect(second.completedAt).toEqual(first.completedAt);
  });

  it('la riapertura azzera lo stato di conclusione', async () => {
    const row = await createRow();
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });
    const reopened = await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: false, note: 'motivazione di test' });
    expect(reopened.completedAt).toBeNull();
  });

  it('la motivazione è obbligatoria', async () => {
    const row = await createRow();
    await expect(
      // @ts-expect-error -- the note is required in the schema: the test verifies that it is also
      // required at runtime, for a client that bypasses the types.
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('una motivazione di soli spazi non passa, e i bordi vengono tolti', async () => {
    // `MandatoryReasonSchema` trims before it measures the length. With the two steps in the other
    // order the trim is a no-op on the check, `'   '` passes as `''`, and the form — which shares
    // this schema — accepts a note the server then refuses in a toast.
    const row = await createRow();
    await expect(
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: '   ' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: '  chiusa  ' });
    const log = await prisma.auditLog.findFirst({
      where: { targetId: row.id, action: 'COLLECTION_ROW_COMPLETE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((log!.metadata as { completionNote?: string }).completionNote).toBe('chiusa');
  });

  it('la motivazione ha un tetto di 500 caratteri', async () => {
    // The limit is the one from `phaseChangeNote` in @luke/core: the audit log is not a note field.
    const row = await createRow();
    await expect(
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'x'.repeat(501) })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'x'.repeat(500) })
    ).resolves.toMatchObject({ id: row.id });
  });

  it('la motivazione finisce in chiaro nell\'audit, su conclusione e riapertura', async () => {
    // `completionNote` must be among the SAFE_KEYS of `sanitizeMetadata`, otherwise the only data
    // that explains the reason would arrive as `[REDACTED]`.
    const row = await createRow();
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'sviluppo chiuso' });
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: false, note: 'riaperta per modifica materiali' });

    const logs = await prisma.auditLog.findMany({
      where: { targetId: row.id, action: { in: ['COLLECTION_ROW_COMPLETE', 'COLLECTION_ROW_REOPEN'] } },
      orderBy: { createdAt: 'asc' },
    });
    const notes = logs.map(l => (l.metadata as { completionNote?: string }).completionNote);
    expect(notes).toEqual(['sviluppo chiuso', 'riaperta per modifica materiali']);
  });
});

describe('fasi ritirate — smetti di misurare', () => {
  it('una milestone su fase ritirata non produce più alcuna criticità', async () => {
    // `isActive: false` is a soft delete: the phase drops out of the process, so it stops providing
    // deadlines. Verified end-to-end, not just on the pure function: it's the wiring that matters.
    const row = await createRow(onlyRetiredGroupId);
    await expect(asAdmin().phaseAlert.criticalityForRow({ rowId: row.id })).resolves.toBeNull();
  });

  it('una fase ritirata non entra nemmeno fra le fasi mancanti alla conclusione', async () => {
    // Asking for it before completion would be noise: nothing can bring the row there anymore.
    const row = await createRow(onlyRetiredGroupId);
    await expect(asAdmin().phaseAlert.completionPreview({ rowId: row.id })).resolves.toEqual({
      missingPhases: [],
    });
  });
});

describe('phaseAlert.completionPreview — permessi', () => {
  it('un anonimo non può leggerla', async () => {
    const row = await createRow();
    const anon = await createAnonymousCaller();
    await expectUnauthorized(() => anon.phaseAlert.completionPreview({ rowId: row.id }), 'UNAUTHORIZED');
  });

  it('un viewer non può leggerla: serve il permesso di chi può concludere', async () => {
    // Deliberately aligned with `setCompleted` (collection_layout:update) -- if it followed the
    // alert-read permission instead, the two could diverge via an RBAC override in AppConfig.
    const row = await createRow();
    await expectUnauthorized(
      () => asViewer().phaseAlert.completionPreview({ rowId: row.id }),
      'FORBIDDEN'
    );
  });

  it('un editor può leggerla', async () => {
    const row = await createRow();
    await expect(asEditor().phaseAlert.completionPreview({ rowId: row.id })).resolves.toMatchObject({
      missingPhases: expect.any(Array),
    });
  });
});

describe('rows.setCompleted — fasi saltate', () => {
  it('riga già all\'ultima milestone: nessuna forzatura richiesta, nessuna forzatura registrata', async () => {
    const row = await createRow(futureDeadlineGroupId);
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'ok' });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: row.id, action: 'COLLECTION_ROW_COMPLETE' },
    });
    expect(log.metadata).not.toHaveProperty('completionForced');
  });

  it('con fasi mancanti e senza force → CONFLICT, con le fasi nel messaggio', async () => {
    const row = await createRowAtEarlierPhase();
    await expect(
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'chiudo comunque' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'chiudo comunque' })
    ).rejects.toThrow(/Fase finale/);

    const after = await prisma.collectionLayoutRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.completedAt).toBeNull();
  });

  it('con force → conclude e registra quali fasi sono state saltate', async () => {
    // Forcing is not forbidden (it could be worked around by jumping to the last phase) but it stays legible
    // in retrospect: it's the difference between a report that's all green and one that's true.
    const row = await createRowAtEarlierPhase();
    await asAdmin().collectionLayout.rows.setCompleted({
      rowId: row.id, completed: true, note: 'campionatura annullata', force: true,
    });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: row.id, action: 'COLLECTION_ROW_COMPLETE' },
    });
    const metadata = log.metadata as { completionForced?: boolean; skippedPhases?: string[] };
    expect(metadata.completionForced).toBe(true);
    expect(metadata.skippedPhases).toEqual([finalPhaseValue]);
  });

  it('l\'anteprima elenca le stesse fasi che la mutation pretende di forzare', async () => {
    // Both reads go through the same helper: if they diverged, the user would confirm one
    // list and the server would record a different one.
    const row = await createRowAtEarlierPhase();
    const preview = await asAdmin().phaseAlert.completionPreview({ rowId: row.id });
    expect(preview.missingPhases.map(p => p.value)).toEqual([finalPhaseValue]);

    const atLastPhase = await createRow(futureDeadlineGroupId);
    const empty = await asAdmin().phaseAlert.completionPreview({ rowId: atLastPhase.id });
    expect(empty.missingPhases).toEqual([]);
  });
});

describe('riga conclusa — campi congelati', () => {
  it('cambiare fase su una riga conclusa è rifiutato', async () => {
    // The outcome is measured against the group's phase and milestones: moving them without reopening
    // would change it after the fact.
    const row = await createRow();
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    await expect(
      asAdmin().collectionLayout.rows.update({ rowId: row.id, data: { phaseId: null } })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const after = await prisma.collectionLayoutRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.completedAt).not.toBeNull();
    expect(after.phaseId).toBe(phaseId);
  });

  it('cambiare gruppo di pianificazione su una riga conclusa è rifiutato', async () => {
    const row = await createRow(futureDeadlineGroupId);
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    await expect(
      asAdmin().collectionLayout.rows.update({ rowId: row.id, data: { planningGroupId: pastDeadlineGroupId } })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('gli altri campi restano modificabili: la conclusione riguarda l\'avanzamento, non l\'anagrafica', async () => {
    const row = await createRow();
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    const updated = await asAdmin().collectionLayout.rows.update({ rowId: row.id, data: { line: 'Rinominata' } });
    expect(updated.line).toBe('Rinominata');
  });

  it('dopo la riapertura il cambio fase torna possibile', async () => {
    const row = await createRow();
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: false, note: 'motivazione di test' });

    await expect(
      asAdmin().collectionLayout.rows.update({ rowId: row.id, data: { phaseId: null } })
    ).resolves.toMatchObject({ phaseId: null });
  });

  it('l\'assegnazione bulk del gruppo rifiuta se la selezione contiene righe concluse', async () => {
    // Silently filtering them out would return a partial count that looks like an intended success.
    const open = await createRow(futureDeadlineGroupId);
    const closed = await createRow(futureDeadlineGroupId);
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: closed.id, completed: true, note: 'motivazione di test' });

    await expect(
      asAdmin().collectionLayout.rows.bulkAssignPlanningGroup({
        rowIds: [open.id, closed.id],
        planningGroupId: pastDeadlineGroupId,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const untouched = await prisma.collectionLayoutRow.findUniqueOrThrow({ where: { id: open.id } });
    expect(untouched.planningGroupId).toBe(futureDeadlineGroupId);
  });
});

/** Narrows the result of `criticalityForRow` to the 'completed' branch -- only that one carries the
 * delta -- failing with a readable message if the row is not actually completed. */
function completedOutcome(
  criticality: Awaited<ReturnType<ReturnType<typeof createCallerWithSession>['phaseAlert']['criticalityForRow']>>
) {
  if (!criticality || criticality.state !== 'completed') {
    throw new Error(`atteso stato 'completed', ricevuto ${criticality?.state ?? 'null'}`);
  }
  return criticality;
}

describe('criticità di una riga conclusa', () => {
  it('conclusa prima della scadenza → esito "in tempo" con delta positivo', async () => {
    const row = await createRow(futureDeadlineGroupId);
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    const criticality = await asAdmin().phaseAlert.criticalityForRow({ rowId: row.id });
    expect(criticality).toMatchObject({ state: 'completed', eventTitle: 'Gate futuro' });
    expect(completedOutcome(criticality).daysVsDeadline).toBeGreaterThan(0);
    expect(criticality!.band.label).toBe('Concluso');
  });

  it('conclusa dopo la scadenza → esito "in ritardo" con delta negativo', async () => {
    const row = await createRow(pastDeadlineGroupId);
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    const criticality = await asAdmin().phaseAlert.criticalityForRow({ rowId: row.id });
    expect(criticality).toMatchObject({ state: 'completed', eventTitle: 'Gate passato' });
    expect(completedOutcome(criticality).daysVsDeadline).toBeLessThan(0);
    expect(criticality!.band.label).toBe('Concluso in ritardo');
  });

  it('la scadenza di chiusura è l\'ultima milestone su fase attiva, non la più lontana in assoluto', async () => {
    // The group has a milestone in 2099 attached to a deactivated phase: measuring against
    // that one would say "early" for a row that has actually overrun the last phase in use.
    const row = await createRow(retiredPhaseGroupId);
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    const criticality = await asAdmin().phaseAlert.criticalityForRow({ rowId: row.id });
    expect(criticality).toMatchObject({ state: 'completed', eventTitle: 'Gate attivo' });
    expect(criticality!.band.label).toBe('Concluso in ritardo');
  });

  it('una riga conclusa esce dall\'indice di strozzatura, dove una riga attiva sullo stesso evento resta', async () => {
    // No event holds onto it anymore: counting it would inflate the milestone it stopped at.
    const active = await createRow(pastDeadlineGroupId);
    const completed = await createRow(pastDeadlineGroupId);

    const before = await asAdmin().phaseAlert.bottleneckByEvent({ collectionLayoutId: layoutId });
    const countBefore = before
      .filter(e => e.eventTitle === 'Gate passato')
      .reduce((sum, e) => sum + e.bands.reduce((s, b) => s + b.count, 0), 0);

    await asAdmin().collectionLayout.rows.setCompleted({ rowId: completed.id, completed: true, note: 'motivazione di test' });

    const after = await asAdmin().phaseAlert.bottleneckByEvent({ collectionLayoutId: layoutId });
    const countAfter = after
      .filter(e => e.eventTitle === 'Gate passato')
      .reduce((sum, e) => sum + e.bands.reduce((s, b) => s + b.count, 0), 0);

    expect(countAfter).toBe(countBefore - 1);
    // The row that stayed open keeps counting: the exclusion is about completion, not the event.
    const stillCounted = await asAdmin().phaseAlert.criticalityForRow({ rowId: active.id });
    expect(stillCounted).toMatchObject({ state: 'active' });
  });
});

describe('phaseHistory.completionLeadTime', () => {
  it('un anonimo non può leggerlo', async () => {
    const anon = await createAnonymousCaller();
    await expectUnauthorized(
      () => anon.phaseHistory.completionLeadTime({ collectionLayoutId: layoutId }),
      'UNAUTHORIZED'
    );
  });

  it('un viewer può leggerlo: è una statistica, non una scrittura', async () => {
    await expect(
      asViewer().phaseHistory.completionLeadTime({ collectionLayoutId: layoutId })
    ).resolves.toMatchObject({ sampleCount: expect.any(Number) });
  });

  it('una riga conclusa senza storico di fase non entra nel campione', async () => {
    // Without a first transition there is no point to start the count from: inventing a
    // start (the row's creation) would give a duration that does not measure the process.
    const layout = await createIsolatedLayout();
    const row = await asAdmin().collectionLayout.rows.create({
      groupId: layout.groupId,
      gender: 'UOMO',
      line: 'Senza storico',
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    await expect(
      asAdmin().phaseHistory.completionLeadTime({ collectionLayoutId: layout.layoutId })
    ).resolves.toEqual({ avgDays: null, medianDays: null, sampleCount: 0 });
  });

  it('misura dalla prima transizione di fase alla conclusione', async () => {
    const layout = await createIsolatedLayout();
    const row = await asAdmin().collectionLayout.rows.create({
      groupId: layout.groupId,
      gender: 'UOMO',
      line: 'Con storico',
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });

    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    await prisma.collectionRowPhaseHistory.createMany({
      data: [
        { rowId: row.id, phaseId, reachedAt: tenDaysAgo },
        // An intermediate transition does not move the start: the very first one counts.
        { rowId: row.id, phaseId, reachedAt: new Date(Date.now() - 2 * 86_400_000) },
      ],
    });
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    const stats = await asAdmin().phaseHistory.completionLeadTime({ collectionLayoutId: layout.layoutId });
    expect(stats.sampleCount).toBe(1);
    expect(stats.avgDays).toBeCloseTo(10, 1);
    expect(stats.medianDays).toBeCloseTo(10, 1);
  });

  it('le righe ancora aperte restano fuori dal campione', async () => {
    const layout = await createIsolatedLayout();
    const row = await asAdmin().collectionLayout.rows.create({
      groupId: layout.groupId,
      gender: 'UOMO',
      line: 'Ancora aperta',
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });
    await prisma.collectionRowPhaseHistory.create({
      data: { rowId: row.id, phaseId, reachedAt: new Date(Date.now() - 5 * 86_400_000) },
    });

    await expect(
      asAdmin().phaseHistory.completionLeadTime({ collectionLayoutId: layout.layoutId })
    ).resolves.toMatchObject({ sampleCount: 0 });
  });
});

/**
 * Layout on its own brand/season: statistics are aggregated per layout, so every test
 * that asserts a sample needs a layout that no other test populates.
 */
async function createIsolatedLayout(): Promise<{ layoutId: string; groupId: string }> {
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `LB${uid}`, name: `Lead Brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `LS${uid}`, name: `Lead Season ${uid}`, year: 2035, isActive: true } }),
  ]);
  const layout = await asAdmin().collectionLayout.getOrCreate({
    brandId: brand.id,
    seasonId: season.id,
    availableGenders: ['UOMO'],
  });
  const group = await asAdmin().collectionLayout.groups.create({
    collectionLayoutId: layout.id,
    data: { name: 'Gruppo', order: 0 },
  });
  return { layoutId: layout.id, groupId: group.id };
}
