/**
 * Under `ldap-only` the directory decides every login, except that an administrator with a LOCAL
 * credential can always use it once LDAP did not authenticate them.
 *
 * Without that exception a directory that cannot authenticate anyone locked every administrator out
 * too, and the only way back in was an edit of the database. Luke cannot tell every such directory
 * apart from a wrong password — a search base pointing at the wrong subtree returns no entry, exactly
 * as for an unknown user — so the exception has no condition on why LDAP refused.
 *
 * Nobody else gets a local path. A non-administrator whose local password is right is refused with
 * the answer a wrong password gets, before any check that would answer differently.
 */

import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as ldapAuth from '../src/lib/ldapAuth';
import * as notifications from '../src/lib/notifications';
import { appRouter } from '../src/routers/index';

import { TEST_USER_PASSWORD, createTestContext, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let ip = 0;

const WRONG_PASSWORD = 'Wrong-password-1!';
const UNAVAILABLE = { code: 'SERVICE_UNAVAILABLE' };
const INVALID = { code: 'UNAUTHORIZED', message: 'Credenziali non valide' };

beforeEach(async () => {
  prisma = await setupTestDb();
  await prisma.appConfig.create({ data: { key: 'auth.strategy', value: 'ldap-only', isEncrypted: false } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spied on the module namespace: `appRouter` is loaded by the setup file before any `vi.mock`. */
const ldap = {
  /** LDAP failed before the username was sent: R1c answers 503. */
  throws: () =>
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockRejectedValue(
      new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'LDAP service unavailable' }),
    ),
  /** LDAP returned no entry — an unknown user, or a search base on the wrong subtree. */
  refuses: () =>
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user: null, reason: 'invalid_credentials' }),
  /** No LDAP configuration at all: `authenticateViaLdap` runs for real and refuses. */
  disabled: () => undefined,
};

/** A login from its own IP, so the per-IP `login` bucket never fills across the file. */
function login(username: string, password = TEST_USER_PASSWORD) {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.20.0.${++ip}` });
  return appRouter.createCaller(ctx).auth.login({ username, password });
}

async function lastAudit(action: 'AUTH_LOGIN' | 'AUTH_LOGIN_FAILED') {
  return prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } });
}

async function emergencyNotifications() {
  return prisma.notification.count({ where: { category: 'SYSTEM', title: { contains: 'emergenza' } } });
}

async function requireEmailVerification() {
  await prisma.appConfig.create({ data: { key: 'auth.requireEmailVerification', value: 'true', isEncrypted: false } });
}

describe('ldap-only: an administrator with a LOCAL credential', () => {
  describe.each([
    ['LDAP failed before the username was sent', 'throws', UNAVAILABLE],
    ['LDAP found no entry', 'refuses', INVALID],
    ['LDAP is not configured', 'disabled', INVALID],
  ] as const)('%s', (_name, outcome, wrongPasswordAnswer) => {
    beforeEach(() => {
      ldap[outcome]();
    });

    it('logs in with the local password, audited as such, and the administrators are told', async () => {
      const { user } = await createTestUser('admin');

      await expect(login(user.username)).resolves.toMatchObject({ user: { id: user.id } });

      expect((await lastAudit('AUTH_LOGIN'))?.metadata).toMatchObject({ provider: 'local', strategy: 'ldap-only' });
      expect(await emergencyNotifications()).toBeGreaterThan(0);
    });

    it('with a wrong password gets the answer LDAP alone would have given', async () => {
      const { user } = await createTestUser('admin');

      await expect(login(user.username, WRONG_PASSWORD)).rejects.toMatchObject(wrongPasswordAnswer);
      expect(await emergencyNotifications()).toBe(0);
    });
  });

  it('is still refused while pending approval, and nobody is told', async () => {
    ldap.refuses();
    const { user } = await createTestUser('admin');
    await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });

    await expect(login(user.username)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await emergencyNotifications()).toBe(0);
  });

  it('is still refused with an unverified email when verification is required', async () => {
    ldap.refuses();
    await requireEmailVerification();
    const { user } = await createTestUser('admin');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

    await expect(login(user.username)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await emergencyNotifications()).toBe(0);
  });

  it('logs in through LDAP when LDAP authenticates, and nobody is told', async () => {
    const { user } = await createTestUser('admin');
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user });

    await expect(login(user.username)).resolves.toMatchObject({ user: { id: user.id } });

    expect((await lastAudit('AUTH_LOGIN'))?.metadata).toMatchObject({ provider: 'ldap', strategy: 'ldap-only' });
    expect(await emergencyNotifications()).toBe(0);
  });

  it('still logs in when the notification fails', async () => {
    ldap.refuses();
    vi.spyOn(notifications, 'notifyAdmins').mockRejectedValue(new Error('notification store down'));
    const { user } = await createTestUser('admin');

    await expect(login(user.username)).resolves.toMatchObject({ user: { id: user.id } });
  });
});

describe('ldap-only: anybody else with a correct local password', () => {
  it.each([
    ['LDAP failed before the username was sent', 'throws', UNAVAILABLE],
    ['LDAP found no entry', 'refuses', INVALID],
  ] as const)('%s: refused as a wrong password would be, with nothing done', async (_name, outcome, answer) => {
    ldap[outcome]();
    const { user } = await createTestUser('editor');

    await expect(login(user.username)).rejects.toMatchObject(answer);

    expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'local_login_not_allowed' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).loginCount).toBe(0);
    expect(await emergencyNotifications()).toBe(0);
  });

  // The checks after authentication answer 403. Reached with a correct password they would tell it
  // apart from a wrong one, so the refusal comes first.
  it('pending approval: refused as a wrong password, never with a 403', async () => {
    ldap.refuses();
    const { user } = await createTestUser('editor');
    await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });

    await expect(login(user.username)).rejects.toMatchObject(INVALID);
  });

  it('an unverified email under required verification: refused as a wrong password, never with a 403', async () => {
    ldap.refuses();
    await requireEmailVerification();
    const { user } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

    await expect(login(user.username)).rejects.toMatchObject(INVALID);
  });
});
