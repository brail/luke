/**
 * A manual NAV sync (`integrations.nav.sync.run`) takes the scheduled sync's lock for its entity.
 *
 * The scheduler wraps each entity's sync in `withSchedulerLock('nav-sync:<entity>')`; the manual
 * run did not, so a click during a scheduled run started a second, concurrent sync of the same
 * entity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';
import * as nav from '@luke/nav';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `runNavSync` spied on the package namespace: `appRouter` is loaded before any `vi.mock`. */
function spyRunNavSync() {
  const now = new Date();
  return vi.spyOn(nav, 'runNavSync').mockResolvedValue({ startedAt: now, completedAt: now, results: [] } as never);
}

describe('integrations.nav.sync.run', () => {
  it('refuses with CONFLICT while the scheduled sync of that entity holds the lock', async () => {
    const runNavSync = spyRunNavSync();
    await prisma.schedulerLock.create({
      data: { name: 'nav-sync:vendor', heldBy: 'another-instance', expiresAt: new Date(Date.now() + 60_000) },
    });
    const caller = await createCallerAs('admin');

    await expect(caller.integrations.nav.sync.run({ entity: 'vendor' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(runNavSync).not.toHaveBeenCalled();
  });

  it('runs and releases the lock when it is free', async () => {
    const runNavSync = spyRunNavSync();
    const caller = await createCallerAs('admin');

    await expect(caller.integrations.nav.sync.run({ entity: 'vendor' })).resolves.toEqual({ results: [] });
    expect(runNavSync).toHaveBeenCalledOnce();
    expect(await prisma.schedulerLock.count()).toBe(0);
  });
});
