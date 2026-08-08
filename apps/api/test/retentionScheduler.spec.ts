/**
 * Unit tests for the orchestration of `retentionScheduler.ts`: which tier uses which
 * retention window, that archiving happens before delete (never after, never
 * on error), and that unread notifications are never touched.
 *
 * Mocked: `configManager` (the retention windows are an input, not what's being
 * tested here), `../storage`/`auditLogArchive` (isolate the orchestration from the
 * archive's content, already covered in `auditLogArchive.spec.ts`), `schedulerLock`
 * (cross-instance mutual exclusion requires real Postgres and is covered by
 * `schedulerLock.integration.spec.ts` — here it's bypassed to test only the sweep).
 * Real: `CRITICAL_AUDIT_ACTIONS`, for a realistic normal/critical partition.
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CRITICAL_AUDIT_ACTIONS } from '../src/lib/auditLog';
import { archiveAuditLogRows } from '../src/lib/auditLogArchive';
import {
  getAuditLogCriticalRetentionDays,
  getAuditLogRetentionDays,
  getNotificationDedupRetentionDays,
  getNotificationRetentionDays,
} from '../src/lib/configManager';
import { registerRetentionScheduler } from '../src/lib/retentionScheduler';
import { getStorageProvider } from '../src/storage';

vi.mock('../src/lib/configManager', () => ({
  getAuditLogRetentionDays: vi.fn(),
  getAuditLogCriticalRetentionDays: vi.fn(),
  getNotificationRetentionDays: vi.fn(),
  getNotificationDedupRetentionDays: vi.fn(),
}));

vi.mock('../src/storage', () => ({
  getStorageProvider: vi.fn(),
}));

vi.mock('../src/lib/auditLogArchive', () => ({
  archiveAuditLogRows: vi.fn(),
}));

vi.mock('../src/lib/schedulerLock', () => ({
  withSchedulerLock: (_prisma: unknown, _name: unknown, tick: () => Promise<unknown>) => tick,
}));

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildFakePrisma() {
  return {
    auditLog: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    notification: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    notificationDedupKey: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  } as any;
}

describe('retentionScheduler', () => {
  let fastify: ReturnType<typeof Fastify>;
  const startTime = new Date('2026-01-01T00:00:00.000Z');
  /** Moment when the first tick fires: the timer starts from zero at `onReady`. */
  const tickTime = startTime.getTime() + TICK_INTERVAL_MS;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(startTime);

    vi.mocked(getAuditLogRetentionDays).mockResolvedValue(10);
    vi.mocked(getAuditLogCriticalRetentionDays).mockResolvedValue(100);
    vi.mocked(getNotificationRetentionDays).mockResolvedValue(90);
    vi.mocked(getNotificationDedupRetentionDays).mockResolvedValue(30);
    vi.mocked(getStorageProvider).mockResolvedValue({ put: vi.fn() } as any);
    vi.mocked(archiveAuditLogRows).mockResolvedValue({ key: 'fake-archive-key' });
  });

  afterEach(async () => {
    await fastify?.close();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function runOneTick(prisma: ReturnType<typeof buildFakePrisma>) {
    fastify = Fastify({ logger: false });
    registerRetentionScheduler(fastify, prisma);
    await fastify.ready();
    await vi.advanceTimersByTimeAsync(TICK_INTERVAL_MS);
  }

  it('usa retentionDays per le righe normali e criticalRetentionDays per quelle in CRITICAL_AUDIT_ACTIONS, senza scambiarli', async () => {
    const normalIds = ['n1', 'n2'];
    const criticalIds = ['c1'];
    const criticalActions = [...CRITICAL_AUDIT_ACTIONS];

    const prisma = buildFakePrisma();
    prisma.auditLog.findMany.mockImplementation(async ({ where, skip }: any) => {
      if (skip > 0) return [];
      if (where.action?.notIn) return normalIds.map(id => ({ id }));
      if (where.action?.in) return criticalIds.map(id => ({ id }));
      return [];
    });

    await runOneTick(prisma);

    const calls = prisma.auditLog.findMany.mock.calls.map((c: any[]) => c[0]);
    const normalCall = calls.find((c: any) => c.where.action?.notIn);
    const criticalCall = calls.find((c: any) => c.where.action?.in);

    // Plausible bug: swapping notIn/in would archive critical rows as
    // "normal" (retention too short for a compliance requirement).
    expect(normalCall.where.action.notIn).toEqual(criticalActions);
    expect(criticalCall.where.action.in).toEqual(criticalActions);

    // Plausible bug: using the same retentionDays for both tiers — the critical
    // floor would stop being longer.
    expect(normalCall.where.createdAt.lt.getTime()).toBe(tickTime - 10 * DAY_MS);
    expect(criticalCall.where.createdAt.lt.getTime()).toBe(tickTime - 100 * DAY_MS);

    const archiveCalls = vi.mocked(archiveAuditLogRows).mock.calls;
    const normalArchive = archiveCalls.find(c => c[4] === 'normal');
    const criticalArchive = archiveCalls.find(c => c[4] === 'critical');
    expect(normalArchive?.[2]).toEqual(normalIds);
    expect(criticalArchive?.[2]).toEqual(criticalIds);
    // Same tickId for both tiers of the same run (fixed id, only one `randomUUID()` per tick).
    expect(normalArchive?.[3]).toBe(criticalArchive?.[3]);

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: normalIds } } });
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: criticalIds } } });
  });

  it('non cancella le righe di un tier se la sua archiviazione fallisce, ma l\'altro tier procede comunque', async () => {
    const normalIds = ['n1'];
    const criticalIds = ['c1'];

    const prisma = buildFakePrisma();
    prisma.auditLog.findMany.mockImplementation(async ({ where, skip }: any) => {
      if (skip > 0) return [];
      if (where.action?.notIn) return normalIds.map(id => ({ id }));
      if (where.action?.in) return criticalIds.map(id => ({ id }));
      return [];
    });
    vi.mocked(archiveAuditLogRows).mockImplementation(async (_p, _prisma, _ids, _tickId, tier) => {
      if (tier === 'critical') throw new Error('upload storage fallito');
      return { key: 'ok-key' };
    });

    await runOneTick(prisma);

    // Durability: unarchived critical rows stay in the DB for the next tick.
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: normalIds } } });
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalledWith({ where: { id: { in: criticalIds } } });
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('filtra le notifiche su isRead=true e sulla finestra notificationRetentionDays, mai le non lette', async () => {
    const readIds = ['read-1', 'read-2'];
    const prisma = buildFakePrisma();
    prisma.notification.findMany.mockImplementation(async ({ skip }: any) => {
      if (skip > 0) return [];
      return readIds.map(id => ({ id }));
    });

    await runOneTick(prisma);

    const call = prisma.notification.findMany.mock.calls[0][0];
    // Plausible bug: removing/inverting `isRead` would sweep unread notifications too.
    expect(call.where.isRead).toBe(true);
    expect(call.where.readAt.lt.getTime()).toBe(tickTime - 90 * DAY_MS);

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { id: { in: readIds } } });
  });

  it('cancella le dedup key scadute con un unico deleteMany per data, senza passare da collect/batch per id', async () => {
    const prisma = buildFakePrisma();

    await runOneTick(prisma);

    expect(prisma.notificationDedupKey.deleteMany).toHaveBeenCalledTimes(1);
    const call = prisma.notificationDedupKey.deleteMany.mock.calls[0][0];
    expect(call.where.lastSentAt.lt.getTime()).toBe(tickTime - 30 * DAY_MS);
  });

  it('non archivia né cancella nulla quando non ci sono righe scadute (nessun file vuoto, nessuna deleteMany a vuoto)', async () => {
    const prisma = buildFakePrisma(); // all findMany calls resolve to [] by default

    await runOneTick(prisma);

    expect(archiveAuditLogRows).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    // Dedup keys don't go through an id collect: the delete-by-date fires regardless,
    // count 0 is a legitimate outcome (no expired keys), not a case to avoid.
    expect(prisma.notificationDedupKey.deleteMany).toHaveBeenCalledTimes(1);
  });
});
