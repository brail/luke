/**
 * The NAV, KIMO and portafoglio sync schedulers log a tick or a sync that cannot start — the
 * maintenance check or the scheduler lock failing because the database is down — and keep
 * ticking: an unhandled rejection would stop the process (#87).
 *
 * Mocked: the maintenance guard and the scheduler lock, each with a check the test can fail;
 * configuration; the NAV package (the sync itself).
 */

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';
import { runNavSync, syncKimoNow, syncPortafoglioNow } from '@luke/nav';

import { registerKimoSyncScheduler } from '../src/lib/kimoSyncScheduler';
import { registerNavSyncScheduler } from '../src/lib/navSyncScheduler';
import { registerPortafoglioSyncScheduler } from '../src/lib/portafoglioSyncScheduler';

const { maintenanceCheck, lockCheck } = vi.hoisted(() => ({
  maintenanceCheck: vi.fn(async () => false),
  lockCheck: vi.fn(async () => {}),
}));

vi.mock('../src/lib/maintenanceMode', () => ({
  guardMaintenance: (_prisma: unknown, tick: () => Promise<void>) => async () => {
    if (await maintenanceCheck()) return;
    await tick();
  },
}));
vi.mock('../src/lib/schedulerLock', () => ({
  withSchedulerLock: (_prisma: unknown, _name: string, run: () => Promise<unknown>) => async () => {
    await lockCheck();
    return run();
  },
}));
vi.mock('../src/lib/configManager', () => ({ getConfig: vi.fn(async () => 'nav.example') }));
vi.mock('@luke/nav', () => ({
  closePool: vi.fn(),
  getNavDbConfig: vi.fn(async () => ({ company: 'C' })),
  getPool: vi.fn(async () => ({})),
  runNavSync: vi.fn(async () => ({ results: [], startedAt: new Date(), completedAt: new Date() })),
  syncKimoNow: vi.fn(async () => ({})),
  syncPortafoglioNow: vi.fn(async () => ({})),
}));

const TICK_MS = 60_000;

const SCHEDULERS = [
  { name: 'NAV', register: registerNavSyncScheduler, sync: runNavSync },
  { name: 'KIMO', register: registerKimoSyncScheduler, sync: syncKimoNow },
  { name: 'portafoglio', register: registerPortafoglioSyncScheduler, sync: syncPortafoglioNow },
] as const;

describe.each(SCHEDULERS)('$name sync scheduler', ({ register, sync }) => {
  let fastify: ReturnType<typeof Fastify>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fastify = Fastify();
  });
  afterEach(async () => {
    await fastify.close();
    vi.useRealTimers();
  });

  it('logs a tick and a sync that cannot start, then syncs on the next tick', async () => {
    // Only the calls the schedulers make; `intervalMinutes: 0` makes every tick due.
    const prisma = {
      navSyncFilter: {
        findUnique: async () => ({ autoSyncEnabled: true, intervalMinutes: 0 }),
        update: async () => ({}),
      },
    } as unknown as PrismaClient;
    const logError = vi.spyOn(fastify.log, 'error');
    register(fastify, prisma);

    maintenanceCheck.mockRejectedValueOnce(new Error('database down'));
    await fastify.ready(); // first tick: the maintenance check fails
    await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(1));

    lockCheck.mockRejectedValue(new Error('database down')); // for every sync of the tick (NAV has several)
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await vi.waitFor(() => expect(logError.mock.calls.length).toBeGreaterThan(1));
    expect(sync).not.toHaveBeenCalled();

    lockCheck.mockResolvedValue(undefined); // the database is back
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await vi.waitFor(() => expect(sync).toHaveBeenCalled());
  });
});
