/**
 * Integration tests for `withSchedulerLock` (apps/api/src/lib/schedulerLock.ts).
 *
 * A real Prisma table is needed (`scheduler_locks`, conditional upsert via raw SQL):
 * mocking `prisma.$queryRaw` would only test that the query gets called, not that
 * mutual exclusion actually works — hence the integration tier, not unit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { withSchedulerLock } from '../src/lib/schedulerLock';

import { setupTestDb } from './helpers';

describe('withSchedulerLock', () => {
  let testPrisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    testPrisma = await setupTestDb();
  });

  it('esegue il tick quando nessun altro lock è presente', async () => {
    const tick = vi.fn(async () => 'done');

    const result = await withSchedulerLock(testPrisma, 'backup', tick)();

    expect(result).toBe('done');
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("salta il tick se un'altra istanza detiene già il lock (non scaduto)", async () => {
    await testPrisma.schedulerLock.create({
      data: { name: 'backup', heldBy: 'other-instance', expiresAt: new Date(Date.now() + 60_000) },
    });

    const tick = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick)();

    // undefined distinguishes "skipped" from "the tick returned undefined" — here the only
    // way this can happen is if lock acquisition failed.
    expect(result).toBeUndefined();
    expect(tick).not.toHaveBeenCalled();

    // Also verify against the DB, not just the result: the lock held by 'other-instance'
    // must not have been overwritten by the failed attempt.
    const row = await testPrisma.schedulerLock.findUniqueOrThrow({ where: { name: 'backup' } });
    expect(row.heldBy).toBe('other-instance');
  });

  it("riacquisisce il lock se quello esistente è scaduto (crash di un'altra istanza)", async () => {
    await testPrisma.schedulerLock.create({
      data: { name: 'backup', heldBy: 'crashed-instance', expiresAt: new Date(Date.now() - 1000) },
    });

    const tick = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick)();

    expect(result).toBe('done');
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('rilascia il lock subito dopo un tick riuscito, non aspettando il TTL', async () => {
    await withSchedulerLock(testPrisma, 'backup', vi.fn(async () => 'done'))();

    // If release weren't explicit, this second call would find
    // expiresAt still in the future (TTL 15 min) and would be skipped.
    const tick2 = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick2)();

    expect(result).toBe('done');
    expect(tick2).toHaveBeenCalledTimes(1);
  });

  it('rilascia il lock anche se il tick lancia un errore', async () => {
    const failingTick = vi.fn(async () => { throw new Error('boom'); });
    await expect(withSchedulerLock(testPrisma, 'backup', failingTick)()).rejects.toThrow('boom');

    const tick2 = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'backup', tick2)();

    expect(result).toBe('done');
    expect(tick2).toHaveBeenCalledTimes(1);
  });

  it('lock su nomi diversi sono indipendenti (nav-sync per-entità non si serializzano a vicenda)', async () => {
    await testPrisma.schedulerLock.create({
      data: { name: 'nav-sync:vendor', heldBy: 'other-instance', expiresAt: new Date(Date.now() + 60_000) },
    });

    // A plausible bug: using a single 'nav-sync' key shared across entities
    // instead of the per-entity name — this test would fail in that case, because
    // 'nav-sync:brand' would be blocked by the lock held on 'nav-sync:vendor'.
    const tick = vi.fn(async () => 'done');
    const result = await withSchedulerLock(testPrisma, 'nav-sync:brand', tick)();

    expect(result).toBe('done');
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
