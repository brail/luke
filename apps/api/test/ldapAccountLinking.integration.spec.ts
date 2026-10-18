/**
 * An LDAP login signs in the account that already carries that directory identity, or creates a new
 * account. It never links a directory entry to an existing account without it (#144): an entry named
 * like a local account used to become that account. A deactivated account is refused like a wrong
 * password, not reported as an outage.
 *
 * The directory is ldapts's real `Client` with its network methods stubbed, as in
 * `ldapAuth.integration.spec.ts`; `authenticateViaLdap` and `auth.login` run for real. The local and
 * the directory passwords differ, so each answer shows which path signed the user in.
 */

import { Client, InvalidCredentialsError } from 'ldapts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigKey } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { saveConfig } from '../src/lib/configManager';
import * as emailHelpers from '../src/lib/emailHelpers';
import { resetLdapBreakers } from '../src/lib/ldapClient';
import { appRouter } from '../src/routers/index';

import { TEST_USER_PASSWORD, createTestContext, createTestUser, setupTestDb } from './helpers';

const SERVICE_DN = 'cn=svc,dc=test';
const DIRECTORY_PASSWORD = 'Directory-password-1!';
const INVALID = { code: 'UNAUTHORIZED', message: 'Credenziali non valide' };

type Strategy = 'local-first' | 'ldap-first' | 'ldap-only';

let prisma: PrismaClient;
let ip = 0;

async function configure(strategy: Strategy) {
  const values: Partial<Record<AppConfigKey, string>> = {
    'auth.strategy': strategy,
    'auth.ldap.enabled': 'true',
    'auth.ldap.url': 'ldap://dc.test:389',
    'auth.ldap.bindDN': SERVICE_DN,
    'auth.ldap.bindPassword': 'service-password',
    'auth.ldap.searchBase': 'dc=test',
    'auth.ldap.searchFilter': '(uid=${username})',
    // One attempt per operation: the retries are the resilience suite's subject, not this one's.
    'auth.ldap.resilience.maxRetries': '0',
  };
  for (const [key, value] of Object.entries(values)) {
    // `Object.entries` widens the keys to `string`; they are the registry keys listed above.
    if (value !== undefined) await saveConfig(prisma, key as AppConfigKey, value);
  }
}

/** The directory holds an entry for every username searched, and accepts `DIRECTORY_PASSWORD` only. */
function stubDirectory() {
  vi.spyOn(Client.prototype, 'search').mockImplementation(async () =>
    // The stub stands for ldapts's `SearchResult`, whose entries are its own `Entry` class.
    ({
      searchEntries: [{ dn: 'uid=entry,ou=people,dc=test', givenName: 'Directory', sn: 'Name', mail: 'entry@directory.example' }],
      searchReferences: [],
    }) as unknown as Awaited<ReturnType<Client['search']>>,
  );
  vi.spyOn(Client.prototype, 'bind').mockImplementation(async (dn, password) => {
    if (dn !== SERVICE_DN && password !== DIRECTORY_PASSWORD) throw new InvalidCredentialsError();
  });
  vi.spyOn(Client.prototype, 'unbind').mockResolvedValue(undefined);
}

/** A login from its own IP, so the per-IP `login` bucket never fills across the file. */
function login(username: string, password: string) {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.30.0.${++ip}` });
  return appRouter.createCaller(ctx).auth.login({ username, password });
}

async function lastRefusalReason() {
  const row = await prisma.auditLog.findFirst({ where: { action: 'AUTH_LOGIN_FAILED' }, orderBy: { createdAt: 'desc' } });
  // `metadata` is JSON; the failed-login audit always writes `reason` (`auth.service.ts`).
  return (row?.metadata as { reason?: string } | null)?.reason;
}

async function lastLoginProvider() {
  const row = await prisma.auditLog.findFirst({ where: { action: 'AUTH_LOGIN' }, orderBy: { createdAt: 'desc' } });
  // `metadata` is JSON; the login audit always writes `provider` (`auth.service.ts`).
  return (row?.metadata as { provider?: string } | null)?.provider;
}

const ldapIdentities = (userId: string) => prisma.identity.count({ where: { userId, provider: 'LDAP' } });

async function withLdapIdentity(userId: string, providerId: string) {
  await prisma.identity.create({ data: { userId, provider: 'LDAP', providerId } });
}

beforeEach(async () => {
  prisma = await setupTestDb();
  resetLdapBreakers();
  stubDirectory();
  // Provisioning sends the verification email without awaiting it: left real, its writes outlive
  // the test and deadlock with the next test's TRUNCATE (as in `ldapAuth.integration.spec.ts`).
  vi.spyOn(emailHelpers, 'sendVerificationEmail').mockResolvedValue({ success: true, message: 'stubbed' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a LOCAL-only account named like a directory entry', () => {
  // The directory password never signs it in; its local password does wherever the strategy lets a
  // local login through — under ldap-only only for an administrator (the break-glass path).
  it.each<[Strategy, 'admin' | 'editor', string, 'local' | 'refused']>([
    ['local-first', 'editor', DIRECTORY_PASSWORD, 'refused'],
    ['ldap-first', 'editor', DIRECTORY_PASSWORD, 'refused'],
    ['ldap-only', 'editor', DIRECTORY_PASSWORD, 'refused'],
    ['ldap-only', 'admin', DIRECTORY_PASSWORD, 'refused'],
    ['local-first', 'editor', TEST_USER_PASSWORD, 'local'],
    ['ldap-first', 'editor', TEST_USER_PASSWORD, 'local'],
    ['ldap-only', 'editor', TEST_USER_PASSWORD, 'refused'],
    ['ldap-only', 'admin', TEST_USER_PASSWORD, 'local'],
  ])('%s, %s, %s → %s, and gets no LDAP identity', async (strategy, role, password, outcome) => {
    await configure(strategy);
    const { user } = await createTestUser(role);

    if (outcome === 'local') {
      await expect(login(user.username, password)).resolves.toMatchObject({ user: { id: user.id } });
      expect(await lastLoginProvider()).toBe('local');
    } else {
      await expect(login(user.username, password)).rejects.toMatchObject(INVALID);
    }

    expect(await ldapIdentities(user.id)).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ firstName: user.firstName, lastName: user.lastName });
  });
});

describe('an account that carries the LDAP identity', () => {
  it('signs in through the directory and syncs the names from it', async () => {
    await configure('ldap-first');
    const { user } = await createTestUser('editor');
    await withLdapIdentity(user.id, user.username);

    await expect(login(user.username, DIRECTORY_PASSWORD)).resolves.toMatchObject({ user: { id: user.id } });

    expect(await lastLoginProvider()).toBe('ldap');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ firstName: 'Directory', lastName: 'Name' });
  });

  it('with a LOCAL identity as well (forced local access) signs in both ways', async () => {
    await configure('local-first');
    const { user } = await createTestUser('editor');
    await withLdapIdentity(user.id, user.username);

    await expect(login(user.username, TEST_USER_PASSWORD)).resolves.toMatchObject({ user: { id: user.id } });
    expect(await lastLoginProvider()).toBe('local');
    await expect(login(user.username, DIRECTORY_PASSWORD)).resolves.toMatchObject({ user: { id: user.id } });
    expect(await lastLoginProvider()).toBe('ldap');
  });

  it('is still refused while pending approval', async () => {
    await configure('ldap-first');
    const { user } = await createTestUser('editor');
    await withLdapIdentity(user.id, user.username);
    await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });

    await expect(login(user.username, DIRECTORY_PASSWORD)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('refused as a wrong password, with nothing written, and audited as a refused account', () => {
  it('an LDAP identity under another directory name', async () => {
    await configure('ldap-first');
    const { user } = await createTestUser('editor');
    await withLdapIdentity(user.id, `other-${user.username}`);

    await expect(login(user.username, DIRECTORY_PASSWORD)).rejects.toMatchObject(INVALID);

    expect(await lastRefusalReason()).toBe('account_refused');
    expect(await ldapIdentities(user.id)).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ firstName: user.firstName, lastName: user.lastName });
  });

  it('a deactivated LDAP account, rather than "LDAP unavailable"', async () => {
    await configure('ldap-first');
    const { user } = await createTestUser('editor');
    await withLdapIdentity(user.id, user.username);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(login(user.username, DIRECTORY_PASSWORD)).rejects.toMatchObject(INVALID);

    expect(await lastRefusalReason()).toBe('account_refused');
    expect(await prisma.user.count({ where: { username: user.username } })).toBe(1);
  });
});
