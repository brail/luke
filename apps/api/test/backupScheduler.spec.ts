/**
 * Which scheduled slot a backup tick answers for (`latestBackupSlot`): today's `dailyTime` in the
 * business zone, or yesterday's while today's is still ahead — so a slot crossed between two hourly
 * ticks, or around midnight, still gets its run, attributed to its own date.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { latestBackupSlot, runTick } from '../src/lib/backupScheduler';

import type { FastifyInstance } from 'fastify';

const m = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  notifyAdmins: vi.fn(async () => undefined),
  notifyDeduped: vi.fn((_prisma: unknown, _key: string, _ms: number, send: () => Promise<unknown>) => send()),
  createPendingBackupRecord: vi.fn(async () => ({ id: 'backup-1' })),
}));

vi.mock('../src/lib/configManager', () => ({
  getBackupScheduleSettings: async () => m.settings,
  getConfigOrDefault: async () => 'Europe/Rome',
}));
vi.mock('../src/lib/notifications', () => ({
  notifyAdmins: m.notifyAdmins,
  notifyDeduped: m.notifyDeduped,
  SYSTEM_FAILURE_DEDUP_MS: 0,
}));
vi.mock('../src/lib/backup/dumpPipeline', () => ({
  createPendingBackupRecord: m.createPendingBackupRecord,
  runBackupJob: vi.fn(async () => undefined),
  deleteBackupBlob: vi.fn(),
}));
vi.mock('../src/storage', () => ({ getStorageProvider: vi.fn() }));

const ROME = 'Europe/Rome';
const slot = (now: string, dailyTime: string) => latestBackupSlot(new Date(now), dailyTime, ROME).toISOString();

describe('latestBackupSlot', () => {
  it("is today's slot once it has come", () => {
    // 23:30 in Rome, slot at 23:00.
    expect(slot('2026-10-02T21:30:00.000Z', '23:00')).toBe('2026-10-02T21:00:00.000Z');
    expect(slot('2026-10-02T21:00:00.000Z', '23:00')).toBe('2026-10-02T21:00:00.000Z');
  });

  it("is yesterday's slot while today's is still ahead", () => {
    // 22:30 in Rome, slot at 23:00: the one that counts is yesterday's.
    expect(slot('2026-10-02T20:30:00.000Z', '23:00')).toBe('2026-10-01T21:00:00.000Z');
  });

  it("a 23:30 slot crossed by ticks at :15 runs after midnight, as the previous day's", () => {
    // 00:15 in Rome on the 3rd.
    expect(slot('2026-10-02T22:15:00.000Z', '23:30')).toBe('2026-10-02T21:30:00.000Z');
  });

  it('is read in the business zone, whatever the process zone', () => {
    // 03:00 in Rome is 01:00Z in summer and 02:00Z in winter.
    expect(slot('2026-07-01T05:00:00.000Z', '03:00')).toBe('2026-07-01T01:00:00.000Z');
    expect(slot('2026-12-01T05:00:00.000Z', '03:00')).toBe('2026-12-01T02:00:00.000Z');
  });

  it('a slot the spring-forward jump skips starts right after it', () => {
    expect(slot('2026-03-29T01:30:00.000Z', '02:00')).toBe('2026-03-29T01:00:00.000Z');
  });
});

/**
 * A stored backup scope the registry refuses (a hand edit, an older version) used to fall back to
 * `DB`, so scheduled backups silently stopped including the files. Now only the backup due is
 * skipped, with an error and, if asked, a notice; reaping and pruning go on.
 */
describe('runTick with an invalid stored scope', () => {
  const backupRecord = {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => ({ status: 'COMPLETED', errorMessage: null })),
    updateMany: vi.fn(async () => ({ count: 0 })),
    findMany: vi.fn(async () => []),
  };
  // Only the table the tick touches: the scheduler's other reads are mocked above.
  const prisma = { backupRecord } as unknown as PrismaClient;
  // A logger whose calls the test can read.
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyInstance['log'];
  const settings = (scope: string | null, notifyOnFailure = true) => ({
    enabled: true, dailyTime: '03:00', retentionDays: 30, retentionMinCount: 3, notifyOnFailure,
    scope, storedScope: scope === null ? 'EVERYTHING' : undefined,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the scheduled backup, warns the admins, and still reaps and prunes', async () => {
    m.settings = settings(null);
    await runTick(prisma, log);

    expect(m.createPendingBackupRecord).not.toHaveBeenCalled();
    expect(m.notifyAdmins).toHaveBeenCalledWith(prisma, expect.objectContaining({ title: 'Backup pianificato non eseguito' }));
    // Not the failure's key: a real failure right after the fix must still be reported.
    expect(m.notifyDeduped).toHaveBeenCalledWith(prisma, 'backup-schedule:invalid-scope', expect.any(Number), expect.any(Function));
    expect(backupRecord.updateMany).toHaveBeenCalled();
    expect(backupRecord.findMany).toHaveBeenCalled();
  });

  it('only logs when failure notices are off', async () => {
    m.settings = settings(null, false);
    await runTick(prisma, log);

    expect(m.notifyAdmins).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('runs the backup with a valid scope', async () => {
    m.settings = settings('DB_AND_FILES');
    await runTick(prisma, log);

    expect(m.createPendingBackupRecord).toHaveBeenCalledWith(prisma, { scope: 'DB_AND_FILES', trigger: 'SCHEDULED' });
  });
});
