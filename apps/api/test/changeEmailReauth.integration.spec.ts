/**
 * `me.changeEmail` asks for the account's password (sec-14). A session alone — a hijacked one, or
 * an unlocked screen — used to be enough to move the address, and a password reset to the new one
 * then took the account. The password is proven as a login proves it (`verifyCredentials`: the
 * strategy, the per-account bucket shared with login, the failure audit), behind the login's per-IP
 * bucket (rule 12). Signed in, its answers say what went wrong (`signedIn` mode); a login, with no
 * session, gets the one refusal of every failure before proof.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGN_IN_REFUSED_MESSAGE } from '@luke/core';
import type { PrismaClient, User } from '@luke/db';

import * as ldapAuth from '../src/lib/ldapAuth';
import * as mailer from '../src/lib/mailer';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';
import { WRONG_CURRENT_PASSWORD } from '../src/services/auth.service';

import { TEST_USER_PASSWORD, createTestContext, createTestUser, lastAudit, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

const WRONG_PASSWORD = 'Wrong-password-1!';
const DIRECTORY_PASSWORD = 'directory-password';

let prisma: PrismaClient;
let ip = 0;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  vi.spyOn(mailer, 'sendEmailVerificationEmail').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A caller for `session` from `fromIp`, or from a fresh IP so the per-IP bucket never fills. */
function as(session: UserSession, fromIp = `10.23.0.${++ip}`) {
  const ctx = createTestContext(session);
  Object.assign(ctx.req, { ip: fromIp });
  return appRouter.createCaller(ctx);
}

const emailOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).email;

describe('me.changeEmail asks for the password', () => {
  it('refuses a wrong password, says so, and leaves the address', async () => {
    const { user, session } = await createTestUser('editor');

    await expect(
      as(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: WRONG_PASSWORD })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: WRONG_CURRENT_PASSWORD });

    await expect(emailOf(user.id)).resolves.toBe(user.email);
  });

  it('changes the address with the right password', async () => {
    const { user, session } = await createTestUser('editor');

    await expect(
      as(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: TEST_USER_PASSWORD })
    ).resolves.toMatchObject({ success: true });

    await expect(emailOf(user.id)).resolves.toBe('moved@example.com');
  });

  // An LDAP account is refused before any proof (#230, `ldapProfileSync.integration.spec.ts`). A
  // password still reaches the directory for an account without that identity, through the
  // local-first fallback; what the directory answers there is what `signedIn` mode reports.
  describe('when the password reaches the directory (the local-first fallback)', () => {
    let dana: User;
    let session: UserSession;

    beforeEach(async () => {
      dana = await prisma.user.create({
        data: { email: 'dana@example.com', username: 'dana', role: 'editor', isActive: true, timezone: 'Europe/Rome' },
      });
      session = { user: { id: dana.id, email: dana.email, username: dana.username, role: 'editor', tokenVersion: 0 } };
    });

    it('a password that proves another account reads as a wrong one', async () => {
      const other = await prisma.user.create({
        data: { email: 'erin@example.com', username: 'erin', role: 'editor', isActive: true, timezone: 'Europe/Rome' },
      });
      vi.spyOn(ldapAuth, 'authenticateViaLdap').mockResolvedValue({ user: other });

      await expect(
        as(session).me.changeEmail({ newEmail: 'dana@new.example.com', currentPassword: DIRECTORY_PASSWORD })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: WRONG_CURRENT_PASSWORD });
      await expect(emailOf(dana.id)).resolves.toBe('dana@example.com');
    });

    it.each([
      ['thrown before the username was sent', () => Promise.reject(new Error('service bind failed'))],
      ['returned from the search', () => Promise.resolve({ user: null, reason: 'ldap_unavailable' as const })],
      ['thrown once the password was verified', () => Promise.reject(new ldapAuth.LdapUserNotWrittenError(new Error('x')))],
    ])('a check LDAP could not complete (%s) is said to be unavailable, and the admins are told', async (_name, outcome) => {
      await createTestUser('admin');
      vi.spyOn(ldapAuth, 'authenticateViaLdap').mockImplementation(outcome);

      await expect(
        as(session).me.changeEmail({ newEmail: 'dana@new.example.com', currentPassword: DIRECTORY_PASSWORD })
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      await expect(prisma.notification.count({ where: { title: 'Verifica LDAP non riuscita' } })).resolves.toBe(1);
    });
  });
});

describe('me.changeEmail guesses are rate limited', () => {
  it('spends the per-account bucket that login reads', async () => {
    const { user, session } = await createTestUser('editor');

    // `loginByUsername`: 10 checks per account in 15 minutes, whatever the endpoint.
    for (let i = 0; i < 10; i++) {
      await expect(
        as(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: WRONG_PASSWORD })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    }

    // A login reads the same bucket, and answers it like a wrong password: only the right password
    // proves it tripped — refused, with no token, and the audit row.
    const ctx = createTestContext(null);
    Object.assign(ctx.req, { ip: `10.23.1.${++ip}` });
    await expect(
      appRouter.createCaller(ctx).auth.login({ username: user.username, password: TEST_USER_PASSWORD })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: SIGN_IN_REFUSED_MESSAGE });
    const row = await lastAudit('AUTH_LOGIN_FAILED');
    expect(row?.metadata).toMatchObject({ reason: 'rate_limited_username' });
  });

  it('signed in, a full account bucket is said so, even with the right password', async () => {
    const { user, session } = await createTestUser('editor');
    for (let i = 0; i < 10; i++) {
      const ctx = createTestContext(null);
      Object.assign(ctx.req, { ip: `10.23.3.${++ip}` });
      await appRouter.createCaller(ctx).auth.login({ username: user.username, password: WRONG_PASSWORD }).catch(() => null);
    }

    await expect(
      as(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: TEST_USER_PASSWORD })
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: 'Troppi tentativi: riprova tra qualche minuto' });
  });

  it('counts each IP on its own, as login does', async () => {
    const { session } = await createTestUser('editor');
    const guess = (fromIp: string) =>
      as(session, fromIp).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: WRONG_PASSWORD });

    // `login`: 5 calls per IP per minute.
    for (let i = 0; i < 5; i++) {
      await expect(guess('10.23.2.1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    }
    await expect(guess('10.23.2.1')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await expect(guess('10.23.2.2')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
