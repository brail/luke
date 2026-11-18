/**
 * An LDAP that cannot complete a login does not lock local users out, and is not reported as a
 * wrong password.
 *
 * `authenticateViaLdap` returns a refusal for a login the directory did not accept; what it throws
 * is LDAP failing before the username was ever sent (incomplete configuration, the service-account
 * bind, the circuit breaker). Under ldap-first every such error that was not a 502/503 used to be
 * rethrown, so the local fallback never ran and a single wrong service-account password locked out
 * every user, local admin included. It now counts as no LDAP login: each strategy's local fallback
 * applies, and the checks after authentication (active user, local credential, pending approval,
 * email verification) still decide.
 *
 * When the fallback does not authenticate either, the audit row says `ldap_unavailable` — the
 * directory never judged the credentials — and the administrators are told, once per window. The
 * public answer is the one every refusal before proof gets (`SIGN_IN_REFUSED_MESSAGE`): nothing
 * before sign-in tells the app's state. Only a directory that verified the password and a user
 * record that could not be written is answered `SERVICE_UNAVAILABLE`.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SIGN_IN_REFUSED_MESSAGE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import * as ldapAuth from '../src/lib/ldapAuth';
import { appRouter } from '../src/routers/index';

import {
  TEST_USER_PASSWORD,
  createCallerWithSession,
  createTestContext,
  createTestUser,
  lastAudit,
  setupTestDb,
  setAuthStrategy,
} from './helpers';

let prisma: PrismaClient;
let ip = 0;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function useStrategy(strategy: 'ldap-first' | 'local-first' | 'ldap-only' | 'local-only') {
  await setAuthStrategy(prisma, strategy);
}

/** What a login is answered for every refusal before the password is proven. */
const REFUSED = { code: 'UNAUTHORIZED', message: SIGN_IN_REFUSED_MESSAGE };

/** The administrators' notice of an LDAP check that could not complete. */
const outageNotices = () => prisma.notification.count({ where: { title: 'Verifica LDAP non riuscita' } });

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

    // Nobody was authenticated and the directory never judged the credentials: audited as an
    // outage, answered as every refusal before proof.
    it('a wrong password', async () => {
      const { user } = await createTestUser('editor');

      await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject(REFUSED);
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({
        reason: 'ldap_unavailable',
        errorCode: 'UNAUTHORIZED',
      });
    });

    it('a user with no local credential', async () => {
      const { user } = await createTestUser('editor');
      await prisma.identity.deleteMany({ where: { userId: user.id } });

      await expect(login(user.username).result).rejects.toMatchObject(REFUSED);
    });

    it('an inactive user', async () => {
      const { user } = await createTestUser('editor');
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      await expect(login(user.username).result).rejects.toMatchObject(REFUSED);
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

      // A marker, not a sentence: the web reads it to tell the user why (`loginAuthorize.ts`).
      await expect(login(user.username).result).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'EMAIL_NOT_VERIFIED',
      });
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({
        reason: 'email_not_verified',
      });
    });
  });
});

describe('local-first, LDAP failing', () => {
  it('a wrong local password is refused as before proof, not as a server error', async () => {
    await useStrategy('local-first');
    ldapFailsWith('INTERNAL_SERVER_ERROR');
    const { user } = await createTestUser('editor');

    await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject(REFUSED);
  });
});

describe('an outage met after the username was sent to the directory', () => {
  // `authenticateViaLdap` returns it as a refusal: a 503 there would tell a caller with no password
  // which usernames the directory knows. The public answer stays generic; the audit row is exact.
  it.each(['ldap-first', 'local-first', 'ldap-only'] as const)(
    '%s: refused as before proof, audited as an outage',
    async strategy => {
      await useStrategy(strategy);
      vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({
        user: null,
        reason: 'ldap_unavailable',
        errorCode: 'SERVICE_UNAVAILABLE',
      });
      const { user } = await createTestUser('editor');

      await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject(REFUSED);
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({
        reason: 'ldap_unavailable',
        errorCode: 'SERVICE_UNAVAILABLE',
      });
    },
  );

  it('a login the directory refused stays invalid credentials in both places', async () => {
    await useStrategy('ldap-first');
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user: null, reason: 'invalid_credentials' });
    const { user } = await createTestUser('editor');

    await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const metadata = (await lastAudit('AUTH_LOGIN_FAILED'))?.metadata;
    expect(metadata).toMatchObject({ reason: 'invalid_credentials' });
    expect(metadata).not.toHaveProperty('errorCode');
  });
});

describe('a stored LDAP row this instance cannot decrypt', () => {
  // A backup restored under another master key. Nothing is mocked: the row has to reach the decryption.
  beforeEach(async () => {
    await prisma.appConfig.create({
      data: { key: 'auth.ldap.bindPassword', value: 'not-a-ciphertext', isEncrypted: true },
    });
  });

  it.each(['ldap-first', 'local-first', 'ldap-only'] as const)(
    '%s, LDAP off: a wrong password is answered and audited as one',
    async strategy => {
      await useStrategy(strategy);
      await prisma.appConfig.create({ data: { key: 'auth.ldap.enabled', value: 'false', isEncrypted: false } });
      const { user } = await createTestUser('editor');

      await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject(REFUSED);
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'invalid_credentials' });
    },
  );

  it.each(['ldap-first', 'local-first', 'ldap-only'] as const)(
    '%s, the LDAP flag itself is the row: off, and a wrong password is answered as one',
    async strategy => {
      await useStrategy(strategy);
      await prisma.appConfig.create({
        data: { key: 'auth.ldap.enabled', value: 'not-a-ciphertext', isEncrypted: true },
      });
      const { user } = await createTestUser('editor');

      await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject(REFUSED);
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'invalid_credentials' });
    },
  );

  it.each(['ldap-first', 'local-first', 'ldap-only'] as const)(
    '%s, LDAP on: the configuration is broken, audited as an outage',
    async strategy => {
      await useStrategy(strategy);
      await prisma.appConfig.create({ data: { key: 'auth.ldap.enabled', value: 'true', isEncrypted: false } });
      const { user } = await createTestUser('editor');

      await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject(REFUSED);
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'ldap_unavailable' });
    },
  );
});

describe('a directory that verified the password, and a user record that could not be written', () => {
  function recordNotWritten() {
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockRejectedValue(
      new ldapAuth.LdapUserNotWrittenError(new Error('write failed')),
    );
  }

  it.each(['ldap-first', 'local-first', 'ldap-only'] as const)(
    '%s: answered SERVICE_UNAVAILABLE once the local fallback has failed',
    async strategy => {
      await useStrategy(strategy);
      recordNotWritten();
      const { user } = await createTestUser('editor');

      await expect(login(user.username, 'Wrong-password-1!').result).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'ldap_unavailable' });
    },
  );

  it('a local fallback that authenticates still logs in', async () => {
    await useStrategy('ldap-first');
    recordNotWritten();
    const { user } = await createTestUser('editor');

    await expect(login(user.username).result).resolves.toMatchObject({ user: { id: user.id } });
  });
});

// #266: a first sign-in whose directory mail another account holds. The directory proved the
// password, so the refusal is told as such, in either mode, and it is no outage.
describe('a directory mail another account holds, at first sign-in', () => {
  const HOLDER_ID = '00000000-0000-4000-8000-000000000266';
  const EMAIL_IN_USE = { code: 'FORBIDDEN', message: 'LDAP_EMAIL_IN_USE' };

  function mailHeld() {
    return vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user: null, reason: 'email_in_use', emailHolderId: HOLDER_ID });
  }

  it.each(['ldap-first', 'local-first', 'ldap-only'] as const)('%s: FORBIDDEN with its text, audited with the holder, no outage notice', async strategy => {
    await createTestUser('admin');
    await useStrategy(strategy);
    mailHeld();

    await expect(login('newcomer', 'directory-password').result).rejects.toMatchObject(EMAIL_IN_USE);
    expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'email_in_use', emailHolderId: HOLDER_ID, strategy });
    expect(await outageNotices()).toBe(0);
  });

  it('local-only never asks the directory', async () => {
    await useStrategy('local-only');
    const ldap = mailHeld();

    await expect(login('newcomer', 'directory-password').result).rejects.toMatchObject(REFUSED);
    expect(ldap).not.toHaveBeenCalled();
  });

  it('a local fallback that authenticates still logs in', async () => {
    await useStrategy('ldap-first');
    mailHeld();
    const { user } = await createTestUser('editor');

    await expect(login(user.username).result).resolves.toMatchObject({ user: { id: user.id } });
  });

  it('ldap-only: an administrator with a local credential still signs in', async () => {
    await useStrategy('ldap-only');
    mailHeld();
    const { user } = await createTestUser('admin');

    await expect(login(user.username).result).resolves.toMatchObject({ user: { id: user.id } });
  });

  it('a signed-in password check is answered the same', async () => {
    await useStrategy('ldap-first');
    const { session } = await createTestUser('editor');
    mailHeld();

    await expect(
      createCallerWithSession(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: 'Wrong-password-1!' })
    ).rejects.toMatchObject(EMAIL_IN_USE);
  });
});

describe('the administrators hear of an LDAP check that could not complete', () => {
  beforeEach(async () => {
    await createTestUser('admin');
  });

  it.each([
    ['thrown before the username was sent', () => ldapFailsWith('UNAUTHORIZED')],
    [
      'returned from the search or the user bind',
      () =>
        vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({
          user: null,
          reason: 'ldap_unavailable',
          errorCode: 'SERVICE_UNAVAILABLE',
        }),
    ],
    [
      'thrown once the password was verified',
      () =>
        vi.spyOn(ldapAuth, 'authenticateViaLdap').mockRejectedValue(
          new ldapAuth.LdapUserNotWrittenError(new Error('write failed')),
        ),
    ],
  ])('%s: once per window', async (_name, failLdap) => {
    await useStrategy('ldap-first');
    failLdap();
    const { user } = await createTestUser('editor');

    await login(user.username, 'Wrong-password-1!').result.catch(() => null);
    await login(user.username, 'Wrong-password-1!').result.catch(() => null);

    // The one administrator, from the first refusal only.
    expect(await outageNotices()).toBe(1);
  });

  it('never for a refusal', async () => {
    await useStrategy('ldap-first');
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user: null, reason: 'invalid_credentials' });
    const { user } = await createTestUser('editor');

    await login(user.username, 'Wrong-password-1!').result.catch(() => null);

    expect(await outageNotices()).toBe(0);
  });

  it('never when a local fallback authenticates', async () => {
    await useStrategy('ldap-first');
    ldapFailsWith('UNAUTHORIZED');
    const { user } = await createTestUser('editor');

    await login(user.username).result;

    expect(await outageNotices()).toBe(0);
  });

  it('never with LDAP disabled', async () => {
    await useStrategy('ldap-first');
    await prisma.appConfig.create({ data: { key: 'auth.ldap.enabled', value: 'false', isEncrypted: false } });
    const { user } = await createTestUser('editor');

    await login(user.username, 'Wrong-password-1!').result.catch(() => null);

    expect(await outageNotices()).toBe(0);
  });

  it('under ldap-only, an outage then a correct local password of a non-admin', async () => {
    await useStrategy('ldap-only');
    ldapFailsWith('UNAUTHORIZED');
    const { user } = await createTestUser('editor');

    await expect(login(user.username).result).rejects.toMatchObject(REFUSED);

    expect(await outageNotices()).toBe(1);
    expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'local_login_not_allowed' });
  });
});
