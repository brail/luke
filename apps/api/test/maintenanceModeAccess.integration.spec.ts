/**
 * Who may change maintenance mode, and what still answers while it is active.
 *
 * The four mode mutations ran on `adminProcedure`, which checked `maintenance:update` and skipped the
 * maintenance guard; `maintenance:mode_manage`, the permission named for this, was required nowhere.
 * They now run on `protectedProcedure` and require `maintenance:mode_manage`: outside maintenance a
 * caller without it is refused FORBIDDEN, naming that permission; during it the guard answers first,
 * and only whoever bypasses maintenance (`maintenance:update`) reaches the mutation — the admin who
 * has to end it.
 *
 * Active maintenance is written straight into the state (`writeMaintenanceState`), not through
 * `activateNow`, which also logs everybody out and mails them; each test leaves it inactive, cache
 * included, so the files after this one are not blocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getMaintenanceState, writeMaintenanceState, type MaintenanceModeState } from '../src/lib/maintenanceMode';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';

import { createTestContext, createTestUser, setupTestDb } from './helpers';

const INACTIVE: MaintenanceModeState = {
  status: 'INACTIVE',
  scheduledAt: null,
  activatedAt: null,
  message: null,
  forceLogout: false,
  warningLeadMinutes: [],
  warningsSent: [],
  activatedByUserId: null,
  notifyByEmail: false,
};

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  await writeMaintenanceState(prisma, INACTIVE);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await writeMaintenanceState(prisma, INACTIVE);
});

async function modeAs(role: 'admin' | 'editor' | 'viewer') {
  const { user, session } = await createTestUser(role);
  const ctx = createTestContext(session);
  const warn = vi.spyOn(ctx.logger, 'warn');
  return { user, warn, mode: appRouter.createCaller(ctx).maintenance.mode };
}

const FUTURE = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

describe('maintenance mode, outside maintenance', () => {
  it.each(['editor', 'viewer'] as const)('refuses %s every mutation, naming maintenance:mode_manage', async role => {
    const { user, warn, mode } = await modeAs(role);

    const calls = [
      () => mode.schedule({ scheduledAt: FUTURE(), forceLogout: false, warningLeadMinutes: [], notifyByEmail: false }),
      () => mode.activateNow({ forceLogout: false }),
      () => mode.cancelScheduled(),
      () => mode.end(),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(warn).toHaveBeenCalledTimes(calls.length);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, deniedPermissions: ['maintenance:mode_manage'] }),
      'Permission denied',
    );
  });
});

describe('maintenance mode, while active', () => {
  beforeEach(async () => {
    await writeMaintenanceState(prisma, { ...INACTIVE, status: 'ACTIVE', activatedAt: new Date().toISOString() });
  });

  it.each(['editor', 'viewer'] as const)('answers %s that the service is unavailable', async role => {
    const { mode } = await modeAs(role);

    await expect(mode.end()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('lets the admin end it', async () => {
    const { mode } = await modeAs('admin');

    await expect(mode.end()).resolves.toMatchObject({ status: 'INACTIVE' });
    expect((await getMaintenanceState(prisma)).status).toBe('INACTIVE');
  });
});
