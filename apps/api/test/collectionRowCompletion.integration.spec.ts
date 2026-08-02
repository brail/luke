/**
 * Conclusione esplicita di una riga di collection layout (`rows.setCompleted`) e ciò che ne
 * dipende: l'esito congelato calcolato dal motore di alert e il tempo totale al completamento.
 *
 * Perché serve uno stato esplicito: il calendario non può dedurlo. Una riga ferma sull'ultima
 * fase l'ha *raggiunta*, non completata (`getActivePhaseFromEvents` la misura ancora contro la
 * scadenza di quella fase), quindi senza un segnale dichiarato non esiste alcun momento in cui
 * una riga "finisce".
 *
 * Copre: RBAC delle due procedure nuove, riga di audit, idempotenza della conclusione (la data
 * originale non va riscritta), riapertura, esito in tempo/in ritardo scelto contro l'ultima
 * milestone legata a una fase **attiva**, esclusione delle righe concluse dall'indice di
 * strozzatura, e il lead time con le sue esclusioni.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';

import {
  createAnonymousCaller,
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
let adminSession: UserSession;
let editorSession: UserSession;
let viewerSession: UserSession;
let layoutId: string;
let groupId: string;
let phaseId: string;
/** Gruppo di pianificazione con una milestone che scade nel 2099: chiudere oggi è in anticipo. */
let futureDeadlineGroupId: string;
/** Gruppo con una milestone scaduta nel 2020: chiudere oggi è in ritardo. */
let pastDeadlineGroupId: string;
/** Gruppo la cui unica milestone è agganciata a una fase disattivata. */
let retiredPhaseGroupId: string;
/** Gruppo con milestone su due fasi attive: una riga sulla prima ne salta una concludendo. */
let skipGroupId: string;
/** Gruppo le cui uniche milestone stanno su una fase ritirata: non misura più nulla. */
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

  // Editor e viewer devono vedere il brand, altrimenti `assertBrandAccess` risponderebbe
  // FORBIDDEN prima ancora del controllo sui permessi — e i test sui ruoli passerebbero per la
  // ragione sbagliata.
  const fn = await prisma.companyFunction.create({
    data: { slug: `compl_fn_${uid.toLowerCase()}`, name: `Compl Fn ${uid}`, order: 93, isActive: true },
  });
  const team = await prisma.companyTeam.create({
    data: { functionId: fn.id, name: `Compl Team ${uid}`, isActive: true },
  });
  await Promise.all([
    prisma.companyTeamMembership.create({ data: { teamId: team.id, userId: editor.user.id } }),
    prisma.companyTeamMembership.create({ data: { teamId: team.id, userId: viewer.user.id } }),
    prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId: brand.id } }),
  ]);

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

  // Il calendario di stagione è quello che il motore risolve dal layout (brand + stagione).
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
    // Stesso gruppo, due milestone: una su fase attiva (2020), una su fase ritirata e più
    // lontana nel tempo (2099). Serve a verificare quale delle due fa da scadenza di chiusura.
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: retired.id, phaseId: phase.id, title: 'Gate attivo', startAt: new Date('2020-06-30') },
    }),
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: retired.id, phaseId: retiredPhase.id, title: 'Gate ritirato', startAt: new Date('2099-06-30') },
    }),
    // Due milestone su fasi attive: una riga ferma sulla prima ne salta una concludendo.
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: skip.id, phaseId: phase.id, title: 'Gate intermedio', startAt: new Date('2099-06-30') },
    }),
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: skip.id, phaseId: finalPhase.id, title: 'Gate finale', startAt: new Date('2099-09-30') },
    }),
    // Unica milestone del gruppo, su una fase ritirata: non deve più fornire una scadenza.
    prisma.calendarEvent.create({
      data: { calendarId: calendar.id, planningGroupId: onlyRetired.id, phaseId: retiredPhase.id, title: 'Gate solo ritirato', startAt: new Date('2020-06-30') },
    }),
  ]);
});

/** Riga nel gruppo che ha una milestone successiva: concludere qui salta "Fase finale". */
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

    // `completedAt` è fra le SAFE_KEYS di `sanitizeMetadata`: nella riga di audit deve arrivare
    // il valore, non `[REDACTED]`. Ogni riga registra lo stato *risultante*, non il precedente.
    expect((completeLogs[0].metadata as { completedAt: string | null }).completedAt).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
    expect((reopenLogs[0].metadata as { completedAt: string | null }).completedAt).toBeNull();
  });

  it('concludere due volte non riscrive la data della prima conclusione', async () => {
    // È il dato su cui si misura l'esito: un doppio click, o due tab aperte, non devono
    // spostare in avanti il momento in cui la riga ha chiuso.
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
      // @ts-expect-error — la nota è obbligatoria nello schema: il test verifica che lo sia anche
      // a runtime, per un client che non passa dai tipi.
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('la motivazione ha un tetto di 500 caratteri', async () => {
    // Il limite è quello di `phaseChangeNote` in @luke/core: l'audit log non è un campo note.
    const row = await createRow();
    await expect(
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'x'.repeat(501) })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'x'.repeat(500) })
    ).resolves.toMatchObject({ id: row.id });
  });

  it('la motivazione finisce in chiaro nell\'audit, su conclusione e riapertura', async () => {
    // `completionNote` deve stare fra le SAFE_KEYS di `sanitizeMetadata`, altrimenti l'unico dato
    // che spiega il perché arriverebbe `[REDACTED]`.
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
    // `isActive: false` è un soft delete: la fase esce dal processo, quindi smette di fornire
    // scadenze. Verificato end-to-end, non solo sulla funzione pura: è il cablaggio che conta.
    const row = await createRow(onlyRetiredGroupId);
    await expect(asAdmin().phaseAlert.criticalityForRow({ rowId: row.id })).resolves.toBeNull();
  });

  it('una fase ritirata non entra nemmeno fra le fasi mancanti alla conclusione', async () => {
    // Chiederla prima di concludere sarebbe rumore: nessuno può più portarci la riga.
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
    // Allineata a `setCompleted` (collection_layout:update) di proposito — se seguisse il permesso
    // di lettura degli alert, i due potrebbero divergere via override RBAC in AppConfig.
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
    // La forzatura non è vietata (sarebbe aggirabile saltando all'ultima fase) ma resta leggibile
    // a consuntivo: è la differenza fra un consuntivo tutto verde e uno vero.
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
    // Le due letture passano dallo stesso helper: se divergessero, l'utente confermerebbe un
    // elenco e il server ne registrerebbe un altro.
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
    // L'esito è misurato contro la fase e le milestone del gruppo: spostarli senza riaprire lo
    // cambierebbe a posteriori.
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
    // Filtrarle in silenzio restituirebbe un conteggio parziale che sembra un successo voluto.
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

/** Restringe il risultato di `criticalityForRow` all'arma 'completed' — solo quella porta il
 * delta — fallendo con un messaggio leggibile se la riga non risulta conclusa. */
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
    // Il gruppo ha una milestone al 2099 agganciata a una fase disattivata: misurare contro
    // quella direbbe "in anticipo" per una riga che ha invece sforato l'ultima fase in uso.
    const row = await createRow(retiredPhaseGroupId);
    await asAdmin().collectionLayout.rows.setCompleted({ rowId: row.id, completed: true, note: 'motivazione di test' });

    const criticality = await asAdmin().phaseAlert.criticalityForRow({ rowId: row.id });
    expect(criticality).toMatchObject({ state: 'completed', eventTitle: 'Gate attivo' });
    expect(criticality!.band.label).toBe('Concluso in ritardo');
  });

  it('una riga conclusa esce dall\'indice di strozzatura, dove una riga attiva sullo stesso evento resta', async () => {
    // Nessun evento la trattiene: contarla gonfierebbe la milestone su cui si è fermata.
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
    // La riga rimasta aperta continua a contare: l'esclusione riguarda la conclusione, non l'evento.
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
    // Senza una prima transizione non c'è da dove far partire il conteggio: inventare un
    // inizio (la creazione della riga) darebbe una durata che non misura il processo.
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
        // Una transizione intermedia non sposta l'inizio: conta la prima in assoluto.
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
 * Layout su brand/stagione propri: le statistiche sono aggregate per layout, quindi ogni test
 * che asserisce un campione ha bisogno di un layout che nessun altro test popola.
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
