/**
 * `authenticateViaLdap` against a scripted directory and a real database.
 *
 * What it does with a failure depends on whether the username has been sent to the directory yet.
 * Before that — incomplete configuration, the service-account bind, the circuit breaker in front of
 * it — it throws: the failure says nothing about the person logging in. From the search on it
 * returns a refusal, whatever went wrong, with the reason kept for the audit trail. Answering
 * differently there would tell a caller with no password which usernames the directory knows.
 *
 * The directory is ldapts's real `Client` with its three network methods stubbed: the error
 * classes, the filter parser and the SASL mechanism list are the library's own.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';
import {
  BusyError,
  Client,
  InvalidCredentialsError,
  NoSuchObjectError,
  SizeLimitExceededError,
  UnwillingToPerformError,
} from 'ldapts';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { AppConfigKey } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { encryptValue, saveConfig } from '../src/lib/configManager';
import * as emailHelpers from '../src/lib/emailHelpers';
import { authenticateViaLdap, LdapUserNotWrittenError } from '../src/lib/ldapAuth';
import { LdapUnavailableError, resetLdapBreakers } from '../src/lib/ldapClient';
import { saveAuthConfig, type AuthConfigWrite } from '../src/services/authConfig.service';

import { createCallerAs, createTestUser, setupTestDb } from './helpers';
import { holdLastAdminLock, whileHeld } from './helpers/heldTransaction';
import { prismaKnownError } from './helpers/prismaError';

const SERVICE_DN = 'cn=svc,dc=test';
const ALICE_DN = 'uid=alice,ou=people,dc=test';
const ALICE = { dn: ALICE_DN, cn: 'Alice Rossi', mail: 'alice@directory.example' };
const BREAKER_THRESHOLD = 5;

const REFUSED = { user: null, reason: 'invalid_credentials' };
const UNVERIFIED = { user: null, reason: 'ldap_unavailable' };

let prisma: PrismaClient;
let bind: MockInstance<Client['bind']>;
let search: MockInstance<Client['search']>;

/** An operation the directory never answers. */
const unanswered = () => new Error('BindRequest: Operation timed out');

/** A search result as ldapts returns it; only the entries matter here. */
function found(...entries: object[]) {
  // The stub stands for ldapts's `SearchResult`, whose entries are its own `Entry` class.
  return { searchEntries: entries, searchReferences: [] } as unknown as Awaited<ReturnType<Client['search']>>;
}

/** Binds answered per DN: the service account always, the rest as the test scripts them. */
function binds(byDn: Record<string, () => Promise<void>> = {}) {
  bind.mockImplementation(async dn => {
    // `bind` also takes a `DN` object; Luke only ever passes it a string.
    if (dn !== SERVICE_DN) await (byDn[dn as string] ?? (async () => {}))();
  });
}

const bindsAs = (dn: string) => bind.mock.calls.filter(([boundDn]) => boundDn === dn).length;

async function configureLdap(overrides: Partial<Record<AppConfigKey, string | null>> = {}) {
  const values: Partial<Record<AppConfigKey, string | null>> = {
    'auth.ldap.enabled': 'true',
    'auth.ldap.url': 'ldap://dc.test:389',
    'auth.ldap.bindDN': SERVICE_DN,
    'auth.ldap.bindPassword': 'service-password',
    'auth.ldap.searchBase': 'dc=test',
    'auth.ldap.searchFilter': '(uid=${username})',
    // One attempt per operation: the retries are the resilience suite's subject, not this one's.
    'auth.ldap.resilience.maxRetries': '0',
    ...overrides,
  };
  await saveAuthConfig(
    prisma,
    // `Object.entries` widens the keys to `string`; they are the registry keys listed above.
    Object.entries(values).flatMap(([key, value]) => (value === null ? [] : [{ key: key as AuthConfigWrite['key'], value }]))
  );
}

beforeEach(async () => {
  prisma = await setupTestDb();
  resetLdapBreakers();
  bind = vi.spyOn(Client.prototype, 'bind');
  search = vi.spyOn(Client.prototype, 'search').mockResolvedValue(found(ALICE));
  vi.spyOn(Client.prototype, 'unbind').mockResolvedValue(undefined);
  // Provisioning sends the verification email without awaiting it: left real, its writes outlive
  // the test and deadlock with the next test's TRUNCATE. Its own behaviour is tested elsewhere
  // (`auditLogWithoutRequest.integration.spec.ts`).
  vi.spyOn(emailHelpers, 'sendVerificationEmail').mockResolvedValue({ success: true, message: 'stubbed' });
  binds();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authenticateViaLdap', () => {
  it('authenticates a user the directory verifies, creating the local record at first login', async () => {
    await configureLdap();
    // A new user reads dates in the business zone (ADR-035 §New users).
    await saveConfig(prisma, 'app.defaultTimezone', 'Asia/Shanghai');

    const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(login.user).toMatchObject({ username: 'alice', email: ALICE.mail, pendingApproval: true, timezone: 'Asia/Shanghai' });
    expect(bind.mock.calls).toEqual([
      [SERVICE_DN, 'service-password'],
      [ALICE_DN, 'her-password'],
    ]);
  });

  // #228: the address stored at first login is in the one form `EmailSchema` writes.
  describe('the address it stores', () => {
    it.each([
      ['a directory mail, trimmed and lowercased', ' Alice.Rossi@Directory.EXAMPLE ', 'alice.rossi@directory.example'],
      ['the synthetic address, lowercased, when the directory has no mail', undefined, 'alice@ldap.local'],
      ['the synthetic address for a blank mail', '   ', 'alice@ldap.local'],
      ['the synthetic address for a malformed mail', 'not-an-address', 'alice@ldap.local'],
    ])('%s', async (_case, mail, stored) => {
      await configureLdap();
      search.mockResolvedValue(found({ dn: ALICE_DN, cn: 'Alice Rossi', ...(mail === undefined ? {} : { mail }) }));

      const login = await authenticateViaLdap(prisma, 'Alice', 'her-password');

      expect(login.user).toMatchObject({ email: stored });
    });
  });

  it('a synthetic address of its own when the username cannot carry one', async () => {
    await configureLdap();
    search.mockResolvedValue(found({ dn: ALICE_DN, cn: 'Józef' }));

    const login = await authenticateViaLdap(prisma, 'józef', 'his-password');

    expect(login.user?.email).toMatch(/^ldap-[0-9a-f-]{36}@ldap\.local$/);
  });

  describe('before the username is sent: it throws', () => {
    it('an incomplete configuration', async () => {
      await configureLdap({ 'auth.ldap.url': null });

      await expect(authenticateViaLdap(prisma, 'alice', 'pw')).rejects.toBeInstanceOf(TRPCError);
      expect(bind).not.toHaveBeenCalled();
    });

    it('a stored key this instance cannot decrypt, the configuration otherwise complete', async () => {
      await configureLdap();
      await prisma.appConfig.update({
        where: { key: 'auth.ldap.bindPassword' },
        data: { value: 'not-a-ciphertext', isEncrypted: true },
      });

      await expect(authenticateViaLdap(prisma, 'alice', 'pw')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
      });
      expect(bind).not.toHaveBeenCalled();
    });

    it('a service-account bind the directory refuses', async () => {
      await configureLdap();
      bind.mockRejectedValue(new InvalidCredentialsError());

      await expect(authenticateViaLdap(prisma, 'alice', 'pw')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(search).not.toHaveBeenCalled();
    });

    it('a service-account bind left without an answer', async () => {
      await configureLdap();
      bind.mockRejectedValue(unanswered());

      await expect(authenticateViaLdap(prisma, 'alice', 'pw')).rejects.toBeInstanceOf(LdapUnavailableError);
      expect(search).not.toHaveBeenCalled();
    });

    it('an open breaker, with nothing sent at all', async () => {
      await configureLdap();
      bind.mockRejectedValue(unanswered());
      for (let i = 0; i < BREAKER_THRESHOLD; i++) {
        await authenticateViaLdap(prisma, 'alice', 'pw').catch(() => {});
      }
      bind.mockClear();

      await expect(authenticateViaLdap(prisma, 'alice', 'pw')).rejects.toBeInstanceOf(LdapUnavailableError);
      expect(bind).not.toHaveBeenCalled();
    });
  });

  describe('from the search on: it returns a refusal', () => {
    beforeEach(async () => {
      await configureLdap();
    });

    it('LDAP disabled', async () => {
      await saveAuthConfig(prisma, [{ key: 'auth.ldap.enabled', value: 'false' }]);

      expect(await authenticateViaLdap(prisma, 'alice', 'pw')).toEqual(REFUSED);
      expect(bind).not.toHaveBeenCalled();
    });

    it('its flag stored encrypted: off', async () => {
      // The flag is read as stored: ciphertext is not `true`. No writer stores it encrypted any more
      // (`PLAINTEXT_CONFIG_KEYS`, #214), so the row an earlier release could leave is written directly.
      await prisma.appConfig.upsert({
        where: { key: 'auth.ldap.enabled' },
        update: { value: encryptValue('true'), isEncrypted: true },
        create: { key: 'auth.ldap.enabled', value: encryptValue('true'), isEncrypted: true },
      });

      expect(await authenticateViaLdap(prisma, 'alice', 'pw')).toEqual(REFUSED);
      expect(bind).not.toHaveBeenCalled();
    });

    it('no entry for the username', async () => {
      search.mockResolvedValue(found());

      expect(await authenticateViaLdap(prisma, 'nobody', 'pw')).toEqual(REFUSED);
      expect(bind).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no such object', () => new NoSuchObjectError()],
      ['size limit exceeded', () => new SizeLimitExceededError()],
    ])('a search the directory answers with an error (%s)', async (_name, answer) => {
      search.mockRejectedValue(answer());

      expect(await authenticateViaLdap(prisma, 'alice', 'pw')).toEqual(REFUSED);
    });

    it.each([
      ['a wrong password', () => new InvalidCredentialsError()],
      ['another refusal', () => new UnwillingToPerformError()],
    ])('a user bind the directory refuses (%s)', async (_name, answer) => {
      binds({ [ALICE_DN]: async () => { throw answer(); } });

      expect(await authenticateViaLdap(prisma, 'alice', 'wrong')).toEqual(REFUSED);
      expect(await prisma.user.findFirst({ where: { username: 'alice' } })).toBeNull();
    });

    it.each([
      ['no answer', unanswered],
      ['a directory that stays busy', () => new BusyError()],
    ])('a search left without a usable answer (%s), recorded as an outage', async (_name, failure) => {
      search.mockRejectedValue(failure());

      expect(await authenticateViaLdap(prisma, 'alice', 'pw')).toEqual({
        ...UNVERIFIED,
        errorCode: 'SERVICE_UNAVAILABLE',
      });
    });

    it('a user bind left without an answer, recorded as an outage', async () => {
      binds({ [ALICE_DN]: async () => { throw unanswered(); } });

      expect(await authenticateViaLdap(prisma, 'alice', 'her-password')).toEqual({
        ...UNVERIFIED,
        errorCode: 'SERVICE_UNAVAILABLE',
      });
    });

    it('a search filter that does not parse', async () => {
      await saveConfig(prisma, 'auth.ldap.searchFilter', '(uid=${username}');

      expect(await authenticateViaLdap(prisma, 'alice', 'pw')).toEqual({ ...UNVERIFIED, errorCode: 'BAD_REQUEST' });
      expect(search).not.toHaveBeenCalled();
    });

    it('an unexpected error while reading the search result', async () => {
      search.mockResolvedValue(found(null as unknown as object)); // a result no directory should return

      expect(await authenticateViaLdap(prisma, 'alice', 'pw')).toEqual({ ...UNVERIFIED, errorCode: 'UNKNOWN' });
    });
  });

  describe('a bind proves a password only if it is a simple bind of a named entry', () => {
    beforeEach(async () => {
      await configureLdap();
    });

    it('an empty password is refused before anything is sent', async () => {
      expect(await authenticateViaLdap(prisma, 'alice', '')).toEqual(REFUSED);
      expect(bind).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
    });

    // ldapts reads a DN that is exactly a SASL mechanism name as a request for that mechanism.
    it.each(['', 'PLAIN', 'EXTERNAL'])('an entry whose DN is "%s" is never bound as', async dn => {
      search.mockResolvedValue(found({ ...ALICE, dn }));

      expect(await authenticateViaLdap(prisma, 'alice', 'pw')).toEqual(REFUSED);
      expect(bind.mock.calls).toEqual([[SERVICE_DN, 'service-password']]);
    });
  });

  describe('the group lookup is optional', () => {
    const groups = {
      'auth.ldap.groupSearchBase': 'ou=groups,dc=test',
      'auth.ldap.groupSearchFilter': '(member=${userDN})',
    } as const;

    it('a group search that fails does not fail the login', async () => {
      await configureLdap(groups);
      search.mockResolvedValueOnce(found(ALICE)).mockRejectedValueOnce(unanswered());

      const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

      expect(login.user).toMatchObject({ username: 'alice' });
    });

    it('a failed rebind as the service account skips the search instead of running it as the user', async () => {
      await configureLdap(groups);
      bind
        .mockResolvedValueOnce(undefined) // service account
        .mockResolvedValueOnce(undefined) // alice
        .mockRejectedValueOnce(unanswered()); // service account again

      const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

      expect(login.user).toMatchObject({ username: 'alice' });
      expect(search).toHaveBeenCalledTimes(1);
    });
  });

  it('records the access a new user is created with, in the creating transaction', async () => {
    await configureLdap();

    const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(login.user).not.toBeNull();
    const rows = await prisma.auditLog.findMany({ where: { action: 'USER_ACCESS_CHANGED', targetId: login.user?.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, targetType: 'User' });
    expect(rows[0].metadata).toEqual({ newRole: 'viewer', newIsActive: true, newPendingApproval: true });
  });

  it('throws when the user record cannot be written after the directory verified the password', async () => {
    await configureLdap();
    // A write failure that is no unique violation (a held address is a refusal since #266).
    vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('connection reset'));

    // Its own type: the one LDAP failure the caller may answer as such before a session.
    await expect(authenticateViaLdap(prisma, 'alice', 'her-password')).rejects.toBeInstanceOf(LdapUserNotWrittenError);
  });

  // The property the whole arrangement exists for. With the service bind answered and the user
  // bind hanging, a username the directory knows and one it does not must look the same from
  // outside: the same refusal for each login, and the same breaker afterwards.
  it('an existing username and an absent one are refused alike, and leave the breaker alike', async () => {
    await configureLdap();
    binds({ [ALICE_DN]: async () => { throw unanswered(); } });
    search.mockImplementation(async (_base, options) =>
      String(options?.filter).includes('alice') ? found(ALICE) : found(),
    );

    for (const username of ['alice', 'nobody']) {
      resetLdapBreakers();
      bind.mockClear();

      for (let i = 0; i < BREAKER_THRESHOLD + 1; i++) {
        expect((await authenticateViaLdap(prisma, username, 'pw')).user).toBeNull();
      }

      // Never opened: every one of those logins reached the directory with its service bind.
      expect(bindsAs(SERVICE_DN)).toBe(BREAKER_THRESHOLD + 1);
    }
  });
});

// `$&`, `` $` `` and `$'` mean something to `String.prototype.replace` when the replacement is a
// string: a value carrying them must still reach the directory as itself, escaped (#94).
describe('a filter template takes the value literally', () => {
  const HOSTILE = "a$&b$'c";

  it('the user search fills every ${username}', async () => {
    await configureLdap({ 'auth.ldap.searchFilter': '(|(uid=${username})(mail=${username}))' });
    search.mockResolvedValue(found());

    await authenticateViaLdap(prisma, HOSTILE, 'pw');

    expect(String(search.mock.calls[0]?.[1]?.filter)).toBe(`(|(uid=${HOSTILE})(mail=${HOSTILE}))`);
  });

  it('the group search fills every ${userDN}', async () => {
    const dn = 'uid=a$&b,ou=people,dc=test';
    await configureLdap({
      'auth.ldap.groupSearchBase': 'ou=groups,dc=test',
      'auth.ldap.groupSearchFilter': '(|(member=${userDN})(uniqueMember=${userDN}))',
    });
    search.mockResolvedValueOnce(found({ ...ALICE, dn }));

    await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(String(search.mock.calls[1]?.[1]?.filter)).toBe(`(|(member=${dn})(uniqueMember=${dn}))`);
  });

  it('the settings page search test fills ${username}', async () => {
    await configureLdap();
    const caller = await createCallerAs('admin');

    await caller.integrations.auth.testLdapSearch({ username: 'a$&b' });

    expect(search.mock.calls[0]?.[1]?.filter).toBe('(uid=a$&b)');
  });
});

describe('the role mapping at first login (#112)', () => {
  const GROUPS_BASE = 'ou=groups,dc=test';
  const ADMINS_DN = 'cn=admins,dc=test';

  async function signInWithMapping(mapping: string) {
    await configureLdap({ 'auth.ldap.groupSearchBase': GROUPS_BASE, 'auth.ldap.groupSearchFilter': '(member=${userDN})' });
    // Written straight to the table: a save refuses an invalid mapping, an earlier release did not.
    await prisma.appConfig.upsert({
      where: { key: 'auth.ldap.roleMapping' },
      update: { value: mapping, isEncrypted: false },
      create: { key: 'auth.ldap.roleMapping', value: mapping, isEncrypted: false },
    });
    search.mockImplementation(async base => (base === GROUPS_BASE ? found({ dn: ADMINS_DN }) : found(ALICE)));
    return authenticateViaLdap(prisma, 'alice', 'her-password');
  }

  it("gives a new user the role mapped to the user's group", async () => {
    const login = await signInWithMapping(JSON.stringify({ [ADMINS_DN]: 'admin' }));

    expect(login.user).toMatchObject({ role: 'admin' });
  });

  it('drops a mapping with an unknown role whole: the new user is a viewer, not a partial match', async () => {
    const login = await signInWithMapping(JSON.stringify({ [ADMINS_DN]: 'admin', 'cn=others,dc=test': 'admn' }));

    expect(login.user).toMatchObject({ role: 'viewer' });
  });
});

// #230: the directory owns an LDAP user's address as it owns the names. A sign-in writes a changed
// directory mail back, unverified, with the links mailed to the old address revoked.
describe('an existing user signing in takes the directory mail', () => {
  const OLD = 'alice@old.example';

  /** Alice as an earlier sign-in left her: names as the directory gives them, a verified address, a link of each kind. */
  async function alice(email = OLD) {
    const user = await prisma.user.create({
      data: { email, username: 'alice', firstName: 'Alice', lastName: 'Rossi', role: 'editor', isActive: true, timezone: 'Europe/Rome', emailVerifiedAt: new Date() },
    });
    await prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: 'alice' } });
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.userToken.createMany({
      data: [
        { userId: user.id, type: 'RESET', tokenHash: 'reset-hash', expiresAt },
        { userId: user.id, type: 'VERIFY', tokenHash: 'verify-hash', expiresAt },
      ],
    });
    return user;
  }

  const stored = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
  const links = (userId: string) => prisma.userToken.count({ where: { userId } });
  const changes = (targetId: string) => prisma.auditLog.findMany({ where: { action: 'EMAIL_CHANGED', targetId } });

  beforeEach(() => configureLdap());

  it('a changed mail is written unverified, the old links revoked, the change audited and mailed', async () => {
    const user = await alice();

    const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(login.user).toMatchObject({ id: user.id, email: ALICE.mail, emailVerifiedAt: null });
    expect(await stored(user.id)).toMatchObject({ email: ALICE.mail, emailVerifiedAt: null });
    expect(await links(user.id)).toBe(0);
    const [row, ...more] = await changes(user.id);
    expect(more).toEqual([]);
    expect(row).toMatchObject({ actorId: null, result: 'SUCCESS', metadata: { reason: 'ldap_sync', resetTokensRevoked: 1 } });
    expect(emailHelpers.sendVerificationEmail).toHaveBeenCalledWith(prisma, { userId: user.id, reason: 'email_changed' });
  });

  it('the same mail, in another case, writes nothing', async () => {
    const user = await alice(ALICE.mail);
    search.mockResolvedValue(found({ ...ALICE, mail: ALICE.mail.toUpperCase() }));

    await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(await stored(user.id)).toMatchObject({ email: ALICE.mail, emailVerifiedAt: user.emailVerifiedAt });
    expect(await links(user.id)).toBe(2);
    expect(await changes(user.id)).toEqual([]);
    expect(emailHelpers.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('no directory mail leaves the stored address, one the user gave included', async () => {
    const user = await alice('alice@given.example');
    search.mockResolvedValue(found({ dn: ALICE_DN, cn: ALICE.cn }));

    await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(await stored(user.id)).toMatchObject({ email: 'alice@given.example', emailVerifiedAt: user.emailVerifiedAt });
    expect(await links(user.id)).toBe(2);
  });

  it.each([
    ['seen by the read before the write', false],
    // The holder appears between the read and the write: the unique constraint refuses it.
    ['refused by the constraint, in a race', true],
  ])('a mail another account holds keeps everything, audits the refusal and signs in (%s)', async (_case, race) => {
    const user = await alice();
    const { user: other } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: other.id }, data: { email: ALICE.mail } });
    if (race) {
      const findUnique = prisma.user.findUnique.bind(prisma.user);
      // The read before the write misses the holder; every other read is the real one. Prisma's
      // delegate is generic over its arguments, which a stub cannot spell: hence the cast.
      vi.spyOn(prisma.user, 'findUnique').mockImplementation(
        (args => (args.where.email === ALICE.mail ? Promise.resolve(null) : findUnique(args))) as typeof findUnique
      );
    }

    const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(login.user).toMatchObject({ id: user.id, email: OLD });
    expect(await stored(user.id)).toMatchObject({ email: OLD, emailVerifiedAt: user.emailVerifiedAt });
    expect(await links(user.id)).toBe(2);
    expect(await changes(user.id)).toMatchObject([{ actorId: null, result: 'FAILURE', metadata: { reason: 'ldap_sync_email_in_use' } }]);
  });

  it('a verification mail that fails keeps the change and the sign-in', async () => {
    const user = await alice();
    vi.mocked(emailHelpers.sendVerificationEmail).mockRejectedValue(new Error('SMTP down'));

    const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(login.user).toMatchObject({ email: ALICE.mail });
    expect(await stored(user.id)).toMatchObject({ email: ALICE.mail });
  });

  // #246: an unverified address can lower the break-glass count a strategy change reads under this lock.
  it('waits for the last-admin lock before it writes', async () => {
    const user = await alice();

    const outcome = await whileHeld(holdLastAdminLock, () => authenticateViaLdap(prisma, 'alice', 'her-password'));

    expect(outcome.status).toBe('fulfilled');
    expect(await stored(user.id)).toMatchObject({ email: ALICE.mail });
  });

  it('a link issued while it waits for the user row does not survive it', async () => {
    const user = await alice();

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]),
      () => authenticateViaLdap(prisma, 'alice', 'her-password'),
      holder => holder.query(
        `INSERT INTO user_tokens (id, "userId", type, "tokenHash", "expiresAt") VALUES (gen_random_uuid(), $1, 'VERIFY', 'late-hash', now() + interval '1 day')`,
        [user.id]
      )
    );

    expect(outcome.status).toBe('fulfilled');
    expect(await stored(user.id)).toMatchObject({ email: ALICE.mail });
    expect(await links(user.id)).toBe(0);
  });
});

// #266: a first sign-in finds the account by its LDAP identity, compared without case, and never
// lands on, or beside, an account it does not carry the identity of. A unique constraint met on the
// way is a refusal or the account a race left, never an outage.
describe('the account an LDAP sign-in lands on', () => {
  /** An account carrying the LDAP identity `providerId`, as an earlier sign-in left it. */
  async function ldapAccount(username: string, { providerId = username, isActive = true } = {}) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@old.example`, username, firstName: 'Alice', lastName: 'Rossi', role: 'viewer', isActive, timezone: 'Europe/Rome' },
    });
    await prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId } });
    return user;
  }

  const counts = async () => ({ users: await prisma.user.count(), identities: await prisma.identity.count() });

  beforeEach(() => configureLdap());

  it('a second sign-in in another case reaches the account of the first', async () => {
    const first = await authenticateViaLdap(prisma, 'Alice', 'her-password');
    const before = await counts();

    const second = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(second.user?.id).toBe(first.user?.id);
    expect(await counts()).toEqual(before);
  });

  it('a non-ASCII username is compared without case too', async () => {
    const account = await ldapAccount('Àlice');

    expect((await authenticateViaLdap(prisma, 'àlice', 'her-password')).user?.id).toBe(account.id);
  });

  // Prisma's `equals` + `insensitive` is an unescaped ILIKE (prisma/orm#20318): each of these would
  // reach the other account through it.
  it.each([
    ['an underscore', 'a_b', 'axb'],
    ['a percent sign', '%', 'alice'],
    ['a backslash', 'a\\b', 'ab'],
  ])('a username with %s is compared literally', async (_case, username, other) => {
    const account = await ldapAccount(other);

    const login = await authenticateViaLdap(prisma, username, 'her-password');

    expect(login.user).toMatchObject({ username });
    expect(login.user?.id).not.toBe(account.id);
  });

  describe('accounts left by pre-#228 sign-ins in different cases', () => {
    it('the exact one wins', async () => {
      await ldapAccount('Alice');
      const exact = await ldapAccount('alice');

      expect((await authenticateViaLdap(prisma, 'alice', 'her-password')).user?.id).toBe(exact.id);
    });

    it('no exact one: refused, nothing created', async () => {
      await ldapAccount('Alice');
      await ldapAccount('alice');
      const before = await counts();

      expect(await authenticateViaLdap(prisma, 'ALICE', 'her-password')).toEqual({ user: null, reason: 'account_refused' });
      expect(await counts()).toEqual(before);
    });

    it('the exact one deactivated: refused, never the other', async () => {
      await ldapAccount('Alice');
      await ldapAccount('alice', { isActive: false });

      expect(await authenticateViaLdap(prisma, 'alice', 'her-password')).toEqual({ user: null, reason: 'account_refused' });
    });
  });

  it('the identity is the link: its account, whatever its username', async () => {
    const account = await ldapAccount('bob', { providerId: 'alice' });

    expect((await authenticateViaLdap(prisma, 'alice', 'her-password')).user?.id).toBe(account.id);
  });

  it('an account named like the username in another case, without the identity, is refused and never linked', async () => {
    const local = await prisma.user.create({
      data: { email: 'alice@local.example', username: 'Alice', firstName: 'A', lastName: 'R', role: 'viewer', isActive: true, timezone: 'Europe/Rome' },
    });
    await prisma.identity.create({ data: { userId: local.id, provider: 'LOCAL', providerId: 'Alice' } });
    const before = await counts();

    expect(await authenticateViaLdap(prisma, 'alice', 'her-password')).toEqual({ user: null, reason: 'account_refused' });
    expect(await counts()).toEqual(before);
  });

  it('a directory mail another account holds refuses the first sign-in, naming the holder, and creates nothing', async () => {
    const { user: holder } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: holder.id }, data: { email: ALICE.mail } });
    const before = await counts();

    expect(await authenticateViaLdap(prisma, 'alice', 'her-password')).toEqual({
      user: null,
      reason: 'email_in_use',
      emailHolderId: holder.id,
    });
    expect(await counts()).toEqual(before);
  });

  it('a synthetic address another account holds gives the new one a synthetic address of its own', async () => {
    const { user: other } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: other.id }, data: { email: 'alice@ldap.local' } });
    search.mockResolvedValue(found({ dn: ALICE_DN, cn: ALICE.cn }));

    const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(login.user?.email).toMatch(/^ldap-[0-9a-f-]{36}@ldap\.local$/);
  });

  describe('races', () => {
    it('a first sign-in in another case that holds the provisioning lock: this one waits, then lands on its account, synced after it commits', async () => {
      const outcome = await whileHeld(
        holder => holder.query(`SELECT pg_advisory_xact_lock(hashtext('ldap.provision:' || lower($1)))`, ['Alice']),
        () => authenticateViaLdap(prisma, 'alice', 'her-password'),
        async holder => {
          const { rows: [user] } = await holder.query<{ id: string }>(
            `INSERT INTO users (id, email, username, "firstName", "lastName", role, "isActive", "pendingApproval", timezone, "updatedAt")
             VALUES (gen_random_uuid(), 'alice@old.example', 'Alice', 'Old', 'Name', 'viewer', true, true, 'Europe/Rome', now()) RETURNING id`
          );
          await holder.query(
            `INSERT INTO identities (id, "userId", provider, "providerId", "updatedAt") VALUES (gen_random_uuid(), $1, 'LDAP', 'Alice', now())`,
            [user!.id]
          );
        }
      );

      expect(outcome.status).toBe('fulfilled');
      const login = outcome.status === 'fulfilled' ? outcome.value : null;
      // Names and the directory mail synced by the existing-user path, after the provisioning commit.
      expect(login?.user).toMatchObject({ username: 'Alice', firstName: 'Alice', lastName: 'Rossi', email: ALICE.mail });
      expect(await prisma.user.count({ where: { username: { in: ['alice'], mode: 'insensitive' } } })).toBe(1);
    });

    it('a mail another writer takes while this one creates: the constraint refuses it, and the retry answers email_in_use', async () => {
      const { user: holder } = await createTestUser('viewer');

      const outcome = await whileHeld(
        held => held.query('UPDATE users SET email = $1 WHERE id = $2', [ALICE.mail, holder.id]),
        () => authenticateViaLdap(prisma, 'alice', 'her-password')
      );

      expect(outcome).toEqual({ status: 'fulfilled', value: { user: null, reason: 'email_in_use', emailHolderId: holder.id } });
      expect(await prisma.user.count({ where: { username: 'alice' } })).toBe(0);
    });

    describe('a second conflict in a row is classified by a read, never a third write', () => {
      const conflict = () => prismaKnownError('P2002', 'users_email_key');

      it('the mail now held: email_in_use', async () => {
        const { user: holder } = await createTestUser('viewer');
        await prisma.user.update({ where: { id: holder.id }, data: { email: ALICE.mail } });
        // Both attempts meet a constraint whatever their reads saw.
        const transaction = vi.spyOn(prisma, '$transaction').mockRejectedValue(conflict());

        expect(await authenticateViaLdap(prisma, 'alice', 'her-password')).toEqual({ user: null, reason: 'email_in_use', emailHolderId: holder.id });
        expect(transaction).toHaveBeenCalledTimes(2);
      });

      it('nothing that explains it: account_refused, not an outage', async () => {
        const transaction = vi.spyOn(prisma, '$transaction').mockRejectedValue(conflict());

        expect(await authenticateViaLdap(prisma, 'alice', 'her-password')).toEqual({ user: null, reason: 'account_refused' });
        expect(transaction).toHaveBeenCalledTimes(2);
      });

      it('a unique violation on another constraint is a write failure', async () => {
        vi.spyOn(prisma, '$transaction').mockRejectedValue(prismaKnownError('P2002', 'brands_code_key'));

        await expect(authenticateViaLdap(prisma, 'alice', 'her-password')).rejects.toBeInstanceOf(LdapUserNotWrittenError);
      });
    });
  });
});
