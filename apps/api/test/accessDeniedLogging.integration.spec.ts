/**
 * Every Resource:Action and section-access refusal writes the same `Permission denied` line.
 *
 * Only `requirePermission` logged one. A manual guard (`can()`/`hasPermission()` where the check
 * needs an AND, a field-level rule or a mode), `withSectionAccess`, `adminMiddleware` and the raw
 * Fastify routes refused with nothing in the log, so a 403 seen by a user could not be traced to the
 * permission or section behind it. The client's message stays as it was; the line names what was
 * missing. Brand scope, ownership and data rules (the last admin) are other refusals, not logged here.
 */

import { randomUUID } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createToken, requireSessionWithPermission } from '../src/lib/auth';
import * as permissions from '../src/lib/permissions';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';

import { createTestContext, createTestUser, setupTestDb } from './helpers';

import type { FastifyReply, FastifyRequest } from 'fastify';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A caller for `role`, with its logger's `warn` spied. */
async function callerAs(role: 'admin' | 'editor' | 'viewer') {
  const { user, session } = await createTestUser(role);
  const ctx = createTestContext(session);
  const warn = vi.spyOn(ctx.logger, 'warn');
  return { user, warn, caller: appRouter.createCaller(ctx) };
}

/** The one denial line, for `user`, naming what was missing. */
function denial(user: { id: string; role: string }, missing: object) {
  return [expect.objectContaining({ userId: user.id, userRole: user.role, ...missing }), 'Permission denied'];
}

describe('a manual permission guard logs the denial', () => {
  it('users.update: a password reset by someone without *:*', async () => {
    const { user, warn, caller } = await callerAs('editor');
    const { user: target } = await createTestUser('viewer');

    await expect(caller.users.update({ id: target.id, password: 'Another-passw0rd!' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(warn).toHaveBeenCalledWith(...denial(user, { deniedPermissions: ['*:*'] }));
  });

  it('users.update: a privileged field changed by someone without *:*', async () => {
    const { user, warn, caller } = await callerAs('editor');
    const { user: target } = await createTestUser('viewer');

    await expect(caller.users.update({ id: target.id, email: 'elsewhere@example.com' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(warn).toHaveBeenCalledWith(...denial(user, { deniedPermissions: ['*:*'] }));
  });

  it('editLock.acquireMany: every permission is required, and the missing ones are named', async () => {
    const { user, warn, caller } = await callerAs('viewer');

    await expect(
      caller.editLock.acquireMany({ entities: [{ entityType: 'SEASON_CALENDAR', entityId: randomUUID() }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(warn).toHaveBeenCalledWith(...denial(user, { deniedPermissions: ['season_calendar:update'] }));
  });

  // No role holds `config:read` without `config:update` today: `can` is narrowed to make one.
  describe('config, a raw value without config:update', () => {
    beforeEach(() => {
      const real = permissions.can;
      vi.spyOn(permissions, 'can').mockImplementation((ctx, permission) =>
        permission === 'config:update' ? false : real(ctx, permission),
      );
    });

    it('viewValue in raw mode', async () => {
      const { user, warn, caller } = await callerAs('admin');

      await expect(caller.config.viewValue({ key: 'app.baseUrl', mode: 'raw' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(warn).toHaveBeenCalledWith(...denial(user, { deniedPermissions: ['config:update'] }));
    });
  });
});

describe('nothing is logged as a denial when nothing was denied', () => {
  it('an editor updating a field editors may change', async () => {
    const { warn, caller } = await callerAs('editor');
    const { user: target } = await createTestUser('viewer');

    await caller.users.update({ id: target.id, firstName: 'Renamed' });
    expect(warn).not.toHaveBeenCalledWith(expect.anything(), 'Permission denied');
  });
});

describe('a section refusal logs the denial', () => {
  it('withSectionAccess names the section', async () => {
    const { user, warn, caller } = await callerAs('admin');
    await prisma.userSectionAccess.create({ data: { userId: user.id, section: 'settings.storage', enabled: false } });

    await expect(caller.storage.getConfig()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(warn).toHaveBeenCalledWith(...denial(user, { section: 'settings.storage' }));
  });
});

describe('a raw Fastify route logs the denial on its own request logger', () => {
  it('requireSessionWithPermission keeps its 403 and names the permission', async () => {
    const { user } = await createTestUser('viewer');
    const token = createToken({ id: user.id, email: user.email, username: user.username, role: user.role, tokenVersion: 0 });
    const warn = vi.fn();
    // The fields the function reads, standing for Fastify's request and reply.
    const request = {
      headers: { authorization: `Bearer ${token}`, 'x-luke-trace-id': 'trace-raw' },
      cookies: {},
      log: { warn },
    } as unknown as FastifyRequest;
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis(), clearCookie: vi.fn() };

    await expect(
      requireSessionWithPermission(request, reply as unknown as FastifyReply, 'brands:update', prisma),
    ).resolves.toBeNull();
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(warn).toHaveBeenCalledWith(
      ...denial(user, { deniedPermissions: ['brands:update'], traceId: 'trace-raw' }),
    );
  });
});
