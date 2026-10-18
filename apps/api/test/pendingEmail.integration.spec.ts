/**
 * `auth.submitPendingEmail`: an LDAP user awaiting approval, whose directory entry has no `mail`,
 * gives Luke a real address — and only after proving the password.
 *
 * It used to take a username alone. Anyone who knew one could overwrite the address of a pending
 * account, and the approval mail and a later forced local access would go there. It now verifies
 * the credentials exactly as `auth.login` does (strategy, per-account bucket shared with login,
 * failure audit), writes only while the account is still the one that was checked (active, pending,
 * LDAP, the synthetic address that was read), and answers every refusal before that point the way a
 * wrong password is answered.
 *
 * The directory is ldapts's real `Client` with its network methods stubbed, as in
 * `ldapAuth.integration.spec.ts`: provisioning and the LDAP identity are Luke's own code.
 */

import { Client, InvalidCredentialsError } from 'ldapts';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { AppConfigKey } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { saveConfig } from '../src/lib/configManager';
import * as emailHelpers from '../src/lib/emailHelpers';
import * as ldapAuth from '../src/lib/ldapAuth';
import { resetLdapBreakers } from '../src/lib/ldapClient';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';

import { TEST_USER_PASSWORD, createTestContext, createTestUser, setupTestDb } from './helpers';

const SERVICE_DN = 'cn=svc,dc=test';
const ALICE_DN = 'uid=alice,ou=people,dc=test';
const ALICE_PASSWORD = 'her-password';
/** No `mail`: provisioning gives her the synthetic `alice@ldap.local`. */
const ALICE = { dn: ALICE_DN, cn: 'Alice Rossi' };

/** What every refusal before the password is proven reads like: a wrong password. */
const REFUSED = { code: 'UNAUTHORIZED', message: 'Credenziali non valide' };
/** After it: the account is not one whose address can be set here, said plainly. */
const NOT_SETTABLE = { code: 'PRECONDITION_FAILED' };

let prisma: PrismaClient;
let ip = 0;
let sendVerification: MockInstance<typeof emailHelpers.sendVerificationEmail>;

async function configure(strategy: 'ldap-first' | 'local-first') {
  const values: Partial<Record<AppConfigKey, string>> = {
    'auth.strategy': strategy,
    'auth.ldap.enabled': 'true',
    'auth.ldap.url': 'ldap://dc.test:389',
    'auth.ldap.bindDN': SERVICE_DN,
    'auth.ldap.bindPassword': 'service-password',
    'auth.ldap.searchBase': 'dc=test',
    'auth.ldap.searchFilter': '(uid=${username})',
    'auth.ldap.resilience.maxRetries': '0',
  };
  for (const [key, value] of Object.entries(values)) {
    // `Object.entries` widens the keys to `string`; they are the registry keys listed above.
    await saveConfig(prisma, key as AppConfigKey, value);
  }
}

/** Each call from its own IP, so the per-IP buckets never fill across the file. */
function caller() {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.21.0.${++ip}` });
  return appRouter.createCaller(ctx).auth;
}

const submit = (email: string, password = ALICE_PASSWORD, username = 'alice') =>
  caller().submitPendingEmail({ username, password, email });

/** Alice as the first LDAP login leaves her: active, pending, LDAP identity, synthetic address. */
async function provisionAlice() {
  await expect(caller().login({ username: 'alice', password: ALICE_PASSWORD })).rejects.toMatchObject({
    code: 'FORBIDDEN',
    message: 'ACCOUNT_PENDING_APPROVAL:NEEDS_EMAIL',
  });
  return prisma.user.findUniqueOrThrow({ where: { username: 'alice' } });
}

/**
 * Runs `change` after the directory has authenticated Alice and before the endpoint writes: the
 * endpoint holds a user it read as eligible while the database has already moved on.
 */
function afterAuthentication(change: () => Promise<unknown>) {
  const real = ldapAuth.authenticateViaLdap;
  vi.spyOn(ldapAuth, 'authenticateViaLdap').mockImplementation(async (...args) => {
    const login = await real(...args);
    await change();
    return login;
  });
}

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  resetLdapBreakers();
  vi.spyOn(Client.prototype, 'bind').mockImplementation(async (dn, password) => {
    if (dn === ALICE_DN && password !== ALICE_PASSWORD) throw new InvalidCredentialsError();
  });
  vi.spyOn(Client.prototype, 'search').mockImplementation(async (_base, options) => {
    // The one user the directory knows; anything else is not found.
    const entries = String(options?.filter) === '(uid=alice)' ? [ALICE] : [];
    // The stub stands for ldapts's `SearchResult`, whose entries are its own `Entry` class.
    return { searchEntries: entries, searchReferences: [] } as unknown as Awaited<ReturnType<Client['search']>>;
  });
  vi.spyOn(Client.prototype, 'unbind').mockResolvedValue(undefined);
  sendVerification = vi
    .spyOn(emailHelpers, 'sendVerificationEmail')
    .mockResolvedValue({ success: true, message: 'stubbed' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth.submitPendingEmail', () => {
  beforeEach(async () => {
    await configure('ldap-first');
  });

  it('saves the address of a pending LDAP user who proves the password, and asks to verify it', async () => {
    const alice = await provisionAlice();
    expect(alice.email).toBe('alice@ldap.local');

    await expect(submit('Alice@Example.COM')).resolves.toEqual({ success: true });

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(saved).toMatchObject({ email: 'alice@example.com', emailVerifiedAt: null, pendingApproval: true });
    expect(sendVerification).toHaveBeenCalledWith(
      expect.anything(),
      { userId: alice.id, reason: 'user_requested' },
      expect.anything(),
    );
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PENDING_USER_EMAIL_SUBMITTED' } });
    expect(audit).toMatchObject({ targetId: alice.id, result: 'SUCCESS' });
  });

  it('refuses a wrong password as login does, and changes nothing', async () => {
    const alice = await provisionAlice();

    await expect(submit('alice@example.com', 'not-her-password')).rejects.toMatchObject(REFUSED);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe('alice@ldap.local');
    expect(sendVerification).not.toHaveBeenCalled();
    const failed = await prisma.auditLog.findFirst({ where: { action: 'AUTH_LOGIN_FAILED' }, orderBy: { createdAt: 'desc' } });
    expect(failed?.metadata).toMatchObject({ username: 'alice', reason: 'invalid_credentials' });
  });

  it('answers an unknown username exactly as a wrong password', async () => {
    const unknown = await submit('x@example.com', 'whatever', 'nobody').catch(e => e);
    const wrong = await submit('x@example.com', 'not-her-password').catch(e => e);

    expect(unknown).toMatchObject(REFUSED);
    expect({ code: unknown.code, message: unknown.message }).toEqual({ code: wrong.code, message: wrong.message });
  });

  it('counts against the per-account bucket login uses', async () => {
    await provisionAlice();
    // `loginByUsername` allows 10 per account; the provisioning login above was the first.
    for (let attempt = 0; attempt < 9; attempt++) {
      await expect(caller().login({ username: 'alice', password: 'wrong' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    }

    await expect(submit('alice@example.com')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('refuses an account whose address is already real', async () => {
    const alice = await provisionAlice();
    await prisma.user.update({ where: { id: alice.id }, data: { email: 'alice@directory.example' } });

    await expect(submit('elsewhere@example.com')).rejects.toMatchObject({
      ...NOT_SETTABLE,
      message: expect.stringMatching(/contatta un amministratore/),
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe('alice@directory.example');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PENDING_USER_EMAIL_SUBMITTED', targetId: alice.id } });
    expect(audit).toMatchObject({ result: 'FAILURE' });
  });

  it.each(['alice@ldap.local', 'someone@ldap.local'])('refuses a synthetic address as the new one (%s)', async address => {
    const alice = await provisionAlice();

    await expect(submit(address)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Refused before the credentials are checked: a wrong password gets the same answer.
    await expect(submit(address, 'not-her-password')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(sendVerification).not.toHaveBeenCalled();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe('alice@ldap.local');
  });

  it('refuses an account no longer pending', async () => {
    const alice = await provisionAlice();
    await prisma.user.update({ where: { id: alice.id }, data: { pendingApproval: false } });

    await expect(submit('alice@example.com')).rejects.toMatchObject(NOT_SETTABLE);
  });

  it('answers an address another account holds with CONFLICT, from the write itself', async () => {
    const alice = await provisionAlice();
    const { user: other } = await createTestUser('viewer');

    await expect(submit(other.email.toUpperCase())).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe('alice@ldap.local');
  });

  describe('the write holds only for the account that was checked', () => {
    it('an approval landing after the check: nothing is written', async () => {
      const alice = await provisionAlice();
      afterAuthentication(() => prisma.user.update({ where: { id: alice.id }, data: { pendingApproval: false } }));

      await expect(submit('alice@example.com')).rejects.toMatchObject(NOT_SETTABLE);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe('alice@ldap.local');
    });

    it('a deactivation landing after the check: nothing is written', async () => {
      const alice = await provisionAlice();
      afterAuthentication(() => prisma.user.update({ where: { id: alice.id }, data: { isActive: false } }));

      await expect(submit('alice@example.com')).rejects.toMatchObject(NOT_SETTABLE);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe('alice@ldap.local');
    });

    it('an address saved after the check: it is not overwritten', async () => {
      const alice = await provisionAlice();
      afterAuthentication(() => prisma.user.update({ where: { id: alice.id }, data: { email: 'first@example.com' } }));

      await expect(submit('second@example.com')).rejects.toMatchObject(NOT_SETTABLE);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe('first@example.com');
    });

    it('two submits that both passed the check: exactly one is written', async () => {
      const alice = await provisionAlice();
      // Neither proceeds to the write until both have been authenticated.
      let arrived = 0;
      let release!: () => void;
      const bothAuthenticated = new Promise<void>(resolve => { release = resolve; });
      afterAuthentication(async () => {
        if (++arrived === 2) release();
        await bothAuthenticated;
      });

      const results = await Promise.allSettled([submit('one@example.com'), submit('two@example.com')]);

      expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const loser = results.find(r => r.status === 'rejected');
      expect(loser?.status === 'rejected' && loser.reason).toMatchObject(NOT_SETTABLE);
      const winner = results[0].status === 'fulfilled' ? 'one@example.com' : 'two@example.com';
      expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).email).toBe(winner);
      expect(await prisma.auditLog.count({ where: { action: 'PENDING_USER_EMAIL_SUBMITTED', result: 'SUCCESS' } })).toBe(1);
      expect(sendVerification).toHaveBeenCalledTimes(1);
    });
  });
});

describe('auth.submitPendingEmail, a pending account without an LDAP identity', () => {
  it('is refused even with the right password and a synthetic-looking address', async () => {
    await configure('local-first');
    const { user } = await createTestUser('viewer');
    await prisma.user.update({
      where: { id: user.id },
      data: { pendingApproval: true, email: `${user.username}@ldap.local` },
    });

    await expect(submit('local@example.com', TEST_USER_PASSWORD, user.username)).rejects.toMatchObject(NOT_SETTABLE);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(`${user.username}@ldap.local`);
  });
});

describe('auth.getPendingStatus', () => {
  it('no longer exists: the pending state is learnt from a login that proved the password', () => {
    expect(Object.keys(appRouter._def.procedures)).not.toContain('auth.getPendingStatus');
  });
});
