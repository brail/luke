/**
 * Test unitari per le revisioni automatiche del collection layout
 * (`collectionLayoutAutoRevision.service.ts`): quali eventi fanno scattare uno snapshot,
 * la deduplica per (evento, tipo revisione), il commento della revisione e il fatto che
 * un fallimento non propaghi mai sul salvataggio della riga.
 *
 * Mockato: `collectionLayoutRevision.service` — lo snapshot vero (transazione, copia foto,
 * numerazione) è comportamento suo, già coperto altrove; qui si testa solo *quando* e *con
 * quali argomenti* viene invocato. Prisma è un fake in-memory: le query sono l'input del
 * test, non ciò che si verifica.
 */

import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  AUTO_REVISION_TYPE_DATE,
  AUTO_REVISION_TYPE_PHASE,
  createRevisionsForCompletedPhase,
  createRevisionsForReachedEvents,
} from '../src/services/collectionLayoutAutoRevision.service';
import { createRevision } from '../src/services/collectionLayoutRevision.service';

vi.mock('../src/services/collectionLayoutRevision.service', () => ({
  createRevision: vi.fn(),
}));

const NOW = new Date('2026-08-01T12:00:00.000Z');

type FakePrismaOpts = {
  events?: unknown[];
  layouts?: unknown[];
  existingRevisions?: { milestoneId: string }[];
  rows?: unknown[];
  admin?: { id: string } | null;
};

function buildFakePrisma(opts: FakePrismaOpts = {}) {
  return {
    calendarEvent: { findMany: vi.fn(async () => opts.events ?? []) },
    collectionLayout: { findMany: vi.fn(async () => opts.layouts ?? []) },
    collectionLayoutRevision: { findMany: vi.fn(async () => opts.existingRevisions ?? []) },
    collectionLayoutRow: { findMany: vi.fn(async () => opts.rows ?? []) },
    user: { findFirst: vi.fn(async () => (opts.admin === undefined ? { id: 'admin-1' } : opts.admin)) },
    auditLog: { create: vi.fn(async () => ({})) },
  } as any;
}

const fakeLogger = { warn: vi.fn(), info: vi.fn() };

/** Evento con fase, già scaduto, appartenente al gruppo di pianificazione indicato. */
function reachedEvent(id: string, title: string, groupName: string) {
  return {
    id,
    title,
    planningGroup: { name: groupName },
    calendar: { brandId: 'brand-1', seasonId: 'season-1' },
  };
}

const LAYOUT = { id: 'layout-1', brandId: 'brand-1', seasonId: 'season-1' };

/** Violazione dell'indice unique `(milestoneId, revisionTypeValue)` — trigger concorrente arrivato prima. */
function duplicateRevisionError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: { target: ['milestoneId', 'revisionTypeValue'] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createRevision).mockResolvedValue({ id: 'rev-1', revisionNumber: 3 } as never);
});

describe('createRevisionsForReachedEvents', () => {
  it('crea una revisione MILESTONE_DATA col titolo evento e il gruppo nel commento', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
    });

    const created = await createRevisionsForReachedEvents(prisma, NOW, fakeLogger);

    expect(created).toBe(1);
    expect(createRevision).toHaveBeenCalledTimes(1);
    const [input, userId] = vi.mocked(createRevision).mock.calls[0]!;
    expect(input).toMatchObject({
      collectionLayoutId: 'layout-1',
      revisionTypeValue: AUTO_REVISION_TYPE_DATE,
      cause: 'MILESTONE',
      milestoneId: 'ev-1',
    });
    expect(input.notes).toContain('Consegna prototipi');
    expect(input.notes).toContain('Uomo FW26');
    expect(userId).toBe('admin-1');
  });

  it('registra un audit log per ogni revisione automatica creata', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
    });

    await createRevisionsForReachedEvents(prisma, NOW, fakeLogger);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorId: 'admin-1',
      action: 'COLLECTION_LAYOUT_REVISION_AUTO_CREATE',
      targetType: 'CollectionLayoutRevision',
      targetId: 'rev-1',
    });
  });

  it('non ricrea la revisione se quell’evento ne ha già una dello stesso tipo', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
      existingRevisions: [{ milestoneId: 'ev-1' }],
    });

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('ignora gli eventi il cui brand+stagione non ha un collection layout', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [],
    });

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('interroga solo eventi attivi con fase e scadenza già passata, entro la finestra di lookback', async () => {
    const prisma = buildFakePrisma({ events: [] });

    await createRevisionsForReachedEvents(prisma, NOW, fakeLogger);

    const where = prisma.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where.cancelledAt).toBeNull();
    expect(where.phaseId).toEqual({ not: null });
    // endAt quando valorizzato, altrimenti startAt — due rami mutuamente esclusivi
    expect(where.OR).toHaveLength(2);
    for (const branch of where.OR) {
      const range = branch.endAt ?? branch.startAt;
      expect(range.lte).toEqual(NOW);
      expect(NOW.getTime() - range.gte.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it('non crea nulla se non esiste un admin attivo a cui attribuire la revisione', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
      admin: null,
    });

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('non conta come creata la revisione persa in corsa contro un trigger concorrente (P2002)', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
    });
    vi.mocked(createRevision).mockRejectedValue(duplicateRevisionError());

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    // Corsa persa = revisione già esistente, non un errore da segnalare
    expect(fakeLogger.warn).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('un evento che fallisce non blocca gli altri', async () => {
    const prisma = buildFakePrisma({
      events: [
        reachedEvent('ev-1', 'Primo', 'Uomo FW26'),
        reachedEvent('ev-2', 'Secondo', 'Uomo FW26'),
      ],
      layouts: [LAYOUT],
    });
    vi.mocked(createRevision)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'rev-2', revisionNumber: 4 } as never);

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(1);
    expect(createRevision).toHaveBeenCalledTimes(2);
  });
});

describe('createRevisionsForCompletedPhase', () => {
  it('crea una revisione MILESTONE_FASE quando tutte le righe del gruppo hanno superato la fase', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 3 } }, { phase: { order: 4 } }],
      events: [{ id: 'ev-1', title: 'Consegna prototipi', planningGroup: { name: 'Uomo FW26' } }],
    });

    const created = await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger);

    expect(created).toBe(1);
    const [input] = vi.mocked(createRevision).mock.calls[0]!;
    expect(input).toMatchObject({
      collectionLayoutId: 'layout-1',
      revisionTypeValue: AUTO_REVISION_TYPE_PHASE,
      cause: 'MILESTONE',
      milestoneId: 'ev-1',
    });
    expect(input.notes).toContain('Consegna prototipi');
    expect(input.notes).toContain('Uomo FW26');
  });

  it('seleziona solo gli eventi la cui fase è al più quella minima raggiunta dal gruppo', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 5 } }, { phase: { order: 2 } }, { phase: { order: 4 } }],
      events: [],
    });

    await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger);

    expect(prisma.calendarEvent.findMany.mock.calls[0][0].where).toMatchObject({
      planningGroupId: 'pg-1',
      cancelledAt: null,
      phase: { order: { lte: 2 } },
    });
  });

  it('non crea nulla se anche una sola riga del gruppo è senza fase', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 3 } }, { phase: null }],
      events: [{ id: 'ev-1', title: 'Consegna prototipi', planningGroup: { name: 'Uomo FW26' } }],
    });

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(prisma.calendarEvent.findMany).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('non crea nulla se il gruppo non ha righe', async () => {
    const prisma = buildFakePrisma({ rows: [] });

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('non ricrea la revisione se quell’evento ne ha già una dello stesso tipo', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 3 } }],
      events: [{ id: 'ev-1', title: 'Consegna prototipi', planningGroup: { name: 'Uomo FW26' } }],
      existingRevisions: [{ milestoneId: 'ev-1' }],
    });

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('non propaga mai un errore — il salvataggio della riga non deve fallire per una revisione', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 3 } }],
      events: [{ id: 'ev-1', title: 'Consegna prototipi', planningGroup: { name: 'Uomo FW26' } }],
    });
    vi.mocked(createRevision).mockRejectedValue(new Error('boom'));

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
