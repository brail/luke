/**
 * Unit tests for the collection layout's automatic revisions
 * (`collectionLayoutAutoRevision.service.ts`): which events trigger a snapshot,
 * dedup by (event, revision type), the revision comment, and the fact that
 * a failure never propagates to the row save.
 *
 * Mocked: `collectionLayoutRevision.service` — the actual snapshot (transaction, photo
 * copy, numbering) is its own behavior, already covered elsewhere; here we only test
 * *when* and *with which arguments* it's invoked. Prisma is an in-memory fake: the
 * queries are the input of the test, not what's being verified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Prisma } from '@luke/db';

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

/** Event with a phase, already overdue, belonging to the given planning group. */
function reachedEvent(id: string, title: string, groupName: string) {
  return {
    id,
    title,
    planningGroup: { name: groupName },
    calendar: { brandId: 'brand-1', seasonId: 'season-1' },
  };
}

const LAYOUT = { id: 'layout-1', brandId: 'brand-1', seasonId: 'season-1' };

/** Violation of the unique index `(milestoneId, revisionTypeValue)` — a concurrent trigger got there first. */
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
  it('creates a MILESTONE_DATA revision with the event title and the group in the comment', async () => {
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

  it('records an audit log for every automatic revision created', async () => {
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

  it('does not recreate the revision if that event already has one of the same type', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
      existingRevisions: [{ milestoneId: 'ev-1' }],
    });

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('ignores events whose brand+season has no collection layout', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [],
    });

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('queries only active events with a phase and a deadline already past, within the lookback window', async () => {
    const prisma = buildFakePrisma({ events: [] });

    await createRevisionsForReachedEvents(prisma, NOW, fakeLogger);

    const where = prisma.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where.cancelledAt).toBeNull();
    expect(where.phaseId).toEqual({ not: null });
    // endAt when set, otherwise startAt — two mutually exclusive branches
    expect(where.OR).toHaveLength(2);
    for (const branch of where.OR) {
      const range = branch.endAt ?? branch.startAt;
      expect(range.lte).toEqual(NOW);
      expect(NOW.getTime() - range.gte.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it('creates nothing if there is no active admin to attribute the revision to', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
      admin: null,
    });

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('does not count as created a revision lost in a race against a concurrent trigger (P2002)', async () => {
    const prisma = buildFakePrisma({
      events: [reachedEvent('ev-1', 'Consegna prototipi', 'Uomo FW26')],
      layouts: [LAYOUT],
    });
    vi.mocked(createRevision).mockRejectedValue(duplicateRevisionError());

    expect(await createRevisionsForReachedEvents(prisma, NOW, fakeLogger)).toBe(0);
    // Lost race = revision already exists, not an error to report
    expect(fakeLogger.warn).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('one failing event does not block the others', async () => {
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
  it('creates a MILESTONE_FASE revision when every row in the group has passed the phase', async () => {
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

  it('selects only events whose phase is at most the minimum one the group has reached', async () => {
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

  it('creates nothing if even one row in the group has no phase', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 3 } }, { phase: null }],
      events: [{ id: 'ev-1', title: 'Consegna prototipi', planningGroup: { name: 'Uomo FW26' } }],
    });

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(prisma.calendarEvent.findMany).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('creates nothing if the group has no rows', async () => {
    const prisma = buildFakePrisma({ rows: [] });

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('does not recreate the revision if that event already has one of the same type', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 3 } }],
      events: [{ id: 'ev-1', title: 'Consegna prototipi', planningGroup: { name: 'Uomo FW26' } }],
      existingRevisions: [{ milestoneId: 'ev-1' }],
    });

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it('never propagates an error — saving the row must not fail because of a revision', async () => {
    const prisma = buildFakePrisma({
      rows: [{ phase: { order: 3 } }],
      events: [{ id: 'ev-1', title: 'Consegna prototipi', planningGroup: { name: 'Uomo FW26' } }],
    });
    vi.mocked(createRevision).mockRejectedValue(new Error('boom'));

    expect(await createRevisionsForCompletedPhase(prisma, 'layout-1', 'pg-1', fakeLogger)).toBe(0);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
