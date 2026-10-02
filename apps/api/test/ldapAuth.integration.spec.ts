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

import { saveConfig } from '../src/lib/configManager';
import * as emailHelpers from '../src/lib/emailHelpers';
import { authenticateViaLdap } from '../src/lib/ldapAuth';
import { LdapUnavailableError, resetLdapBreakers } from '../src/lib/ldapClient';

import { createTestUser, setupTestDb } from './helpers';

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
  for (const [key, value] of Object.entries(values)) {
    // `Object.entries` widens the keys to `string`; they are the registry keys listed above.
    if (value !== null) await saveConfig(prisma, key as AppConfigKey, value);
  }
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

    const login = await authenticateViaLdap(prisma, 'alice', 'her-password');

    expect(login.user).toMatchObject({ username: 'alice', email: ALICE.mail, pendingApproval: true });
    expect(bind.mock.calls).toEqual([
      [SERVICE_DN, 'service-password'],
      [ALICE_DN, 'her-password'],
    ]);
  });

  describe('before the username is sent: it throws', () => {
    it('an incomplete configuration', async () => {
      await configureLdap({ 'auth.ldap.url': null });

      await expect(authenticateViaLdap(prisma, 'alice', 'pw')).rejects.toBeInstanceOf(TRPCError);
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
      await saveConfig(prisma, 'auth.ldap.enabled', 'false');

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

  it('throws when the user record cannot be written after the directory verified the password', async () => {
    await configureLdap();
    // The directory's email already belongs to another local account: the insert is refused.
    const { user: other } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: other.id }, data: { email: ALICE.mail } });

    await expect(authenticateViaLdap(prisma, 'alice', 'her-password')).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
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
