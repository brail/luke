/**
 * The manual portafoglio and KIMO syncs start a NAV replica, so they take `sales:sync`, which only
 * admin holds: they used to take `sales:read`, and any viewer could start one. A refusal must come
 * before the scheduler is called, so the spies prove no sync started; admin's call reaches it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as kimoScheduler from '../src/lib/kimoSyncScheduler';
import * as portafoglioScheduler from '../src/lib/portafoglioSyncScheduler';

import { createCallerAs, expectUnauthorized, setupTestDb } from './helpers';

type Caller = Awaited<ReturnType<typeof createCallerAs>>;

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TRIGGERS = [
  {
    name: 'portafoglio',
    spy: () => vi.spyOn(portafoglioScheduler, 'triggerPortafoglioSyncNow').mockResolvedValue(null),
    trigger: (c: Caller) => c.sales.statistics.portafoglio.triggerSync(),
  },
  {
    name: 'kimo',
    spy: () => vi.spyOn(kimoScheduler, 'triggerKimoSyncNow').mockResolvedValue(null),
    trigger: (c: Caller) => c.sales.statistics.kimo.triggerSync(),
  },
];

describe.each(TRIGGERS)('sales.statistics.$name.triggerSync', t => {
  it.each(['editor', 'viewer'] as const)('refuses %s and starts no sync', async role => {
    const sync = t.spy();

    await expectUnauthorized(async () => t.trigger(await createCallerAs(role)));

    expect(sync).not.toHaveBeenCalled();
  });

  it('lets admin start one', async () => {
    const sync = t.spy();

    // The stub reports NAV as unconfigured: past the permission check, the router answers that.
    await expect(t.trigger(await createCallerAs('admin'))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

// The statistics page shows when the next automatic sync is due. Its schedule comes with the sync
// state (`sales:read`), not from the NAV sync configuration (`config:read`), which editors and
// viewers do not hold.
describe('getSyncState carries the replica schedule', () => {
  it.each(['editor', 'viewer'] as const)('to %s, each replica its own', async role => {
    await prisma.navSyncFilter.create({
      data: { entity: 'portafoglio', mode: 'all', navNos: [], autoSyncEnabled: true, intervalMinutes: 45 },
    });
    const caller = await createCallerAs(role);

    const portafoglio = await caller.sales.statistics.portafoglio.getSyncState();
    const kimo = await caller.sales.statistics.kimo.getSyncState();

    expect(portafoglio.schedule).toEqual({ autoSyncEnabled: true, intervalMinutes: 45 });
    expect(kimo.schedule).toBeNull();
    await expectUnauthorized(() => caller.integrations.nav.sync.getFilter({ entity: 'portafoglio' }));
  });
});
