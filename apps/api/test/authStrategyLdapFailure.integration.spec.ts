/**
 * An LDAP that cannot complete a login does not lock local users out.
 *
 * `authenticateViaLdap` answers `null` for a wrong user password; what it throws is LDAP failing
 * (incomplete configuration, a wrong service-account bind, an invalid filter, the network).
 * Under ldap-first every such error that was not a 502/503 used to be rethrown, so the local
 * fallback never ran and a single wrong service-account password locked out every user, local
 * admin included. It now counts as no LDAP login: each strategy's local fallback applies, and the
 * checks after authentication (active user, local credential, pending approval, email
 * verification) still decide.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as ldapAuth from '../src/lib/ldapAuth';
import { appRouter } from '../src/routers/index';

import { TEST_USER_PASSWORD, createTestContext, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let ip = 0;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function useStrategy(strategy: 'ldap-first' | 'local-first' | 'ldap-only') {
  await prisma.appConfig.create({ data: { key: 'auth.strategy', value: strategy, isEncrypted: false } });
}

/** LDAP throws `code`, as a wrong service-account bind (`UNAUTHORIZED`) or a broken config does. */
function ldapFailsWith(code: TRPCError['code']) {
  // Spied on the module namespace: `appRouter` is loaded by the setup file before any `vi.mock`.
  vi.spyOn(ldapAuth, 'authenticateViaLdap').mockRejectedValue(
    new TRPCError({ code, message: `LDAP failure ${code}` }),
  );
}

/** A login from its own IP, so the per-IP `login` bucket never fills across the file. */
function login(username: string, password = TEST_USER_PASSWORD) {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.19.0.${++ip}` });
  const warn = vi.spyOn(ctx.logger, 'warn');
  return { warn, result: appRouter.createCaller(ctx).auth.login({ username, password }) };
}

async function lastAudit(action: 'AUTH_LOGIN' | 'AUTH_LOGIN_FAILED') {
  return prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } });
}

describe('ldap-first, LDAP failing', () => {
  beforeEach(async () => {
    await useStrategy('ldap-first');
  });

  it.each(['UNAUTHORIZED', 'BAD_REQUEST', 'INTERNAL_SERVER_ERROR', 'SERVICE_UNAVAILABLE'] as const)(
    'LDAP %s → the local user logs in, audited as local',
    async code => {
      ldapFailsWith(code);
      const { user } = await createTestUser('admin');

      const { warn, result } = login(user.username);

      await expect(result).resolves.toMatchObject({ user: { id: user.id } });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ code }),
        'LDAP authentication could not complete',
      );
      expect((await lastAudit('AUTH_LOGIN'))?.metadata).toMatchObject({ provider: 'local' });
    },
  );

  it('an incomplete LDAP configuration, unmocked, still lets the local user in', async () => {
    // Enabled with no url/searchBase/searchFilter: fails before any network call.
    await prisma.appConfig.create({ data: { key: 'auth.ldap.enabled', value: 'true', isEncrypted: false } });
    const { user } = await createTestUser('admin');

    await expect(login(user.username).result).resolves.toMatchObject({ user: { id: user.id } });
  });

  describe('the local fallback still refuses', () => {
    beforeEach(() => {
      ldapFailsWith('UNAUTHORIZED');
    });

    it('a wrong password', async () => {
      const { user } = await createTestUser('editor');

      await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({
        reason: 'invalid_credentials',
      });
    });

    it('a user with no local credential', async () => {
      const { user } = await createTestUser('editor');
      await prisma.identity.deleteMany({ where: { userId: user.id } });

      await expect(login(user.username).result).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('an inactive user', async () => {
      const { user } = await createTestUser('editor');
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      await expect(login(user.username).result).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('a user pending approval', async () => {
      const { user } = await createTestUser('editor');
      await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });

      await expect(login(user.username).result).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringMatching(/^ACCOUNT_PENDING_APPROVAL/),
      });
    });

    it('an unverified email when verification is required', async () => {
      // Email verification applies to local logins only (`authMethod === 'local'`): this is what
      // proves the fallback login is recorded as local, not as LDAP.
      await prisma.appConfig.create({
        data: { key: 'auth.requireEmailVerification', value: 'true', isEncrypted: false },
      });
      const { user } = await createTestUser('editor');
      await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

      await expect(login(user.username).result).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({
        reason: 'email_not_verified',
      });
    });
  });
});

describe('local-first, LDAP failing', () => {
  it('a wrong local password is invalid credentials, not a server error', async () => {
    await useStrategy('local-first');
    ldapFailsWith('INTERNAL_SERVER_ERROR');
    const { user } = await createTestUser('editor');

    await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('ldap-only, LDAP failing', () => {
  it('refuses the local admin: ldap-only has no local path', async () => {
    // Recovery is outside the application: set the `auth.strategy` row back to a strategy with
    // a local path, and log in as a user with a local credential.
    await useStrategy('ldap-only');
    ldapFailsWith('INTERNAL_SERVER_ERROR');
    const { user } = await createTestUser('admin');

    await expect(login(user.username).result).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
