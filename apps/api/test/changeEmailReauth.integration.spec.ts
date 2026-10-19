/**
 * `me.changeEmail` asks for the account's password (sec-14). A session alone — a hijacked one, or
 * an unlocked screen — used to be enough to move the address, and a password reset to the new one
 * then took the account. The password is proven as a login proves it (`verifyCredentials`: the
 * strategy, the per-account bucket shared with login, the failure audit), behind the login's per-IP
 * bucket (rule 12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient, User } from '@luke/db';

import * as ldapAuth from '../src/lib/ldapAuth';
import * as mailer from '../src/lib/mailer';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';

import { TEST_USER_PASSWORD, createTestContext, createTestUser, setupTestDb } from './helpers';

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
  it('refuses a wrong password and leaves the address', async () => {
    const { user, session } = await createTestUser('editor');

    await expect(
      as(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: WRONG_PASSWORD })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await expect(emailOf(user.id)).resolves.toBe(user.email);
  });

  it('changes the address with the right password', async () => {
    const { user, session } = await createTestUser('editor');

    await expect(
      as(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: TEST_USER_PASSWORD })
    ).resolves.toMatchObject({ success: true });

    await expect(emailOf(user.id)).resolves.toBe('moved@example.com');
  });

  describe('for an LDAP account', () => {
    let ldapUser: User;
    let session: UserSession;

    beforeEach(async () => {
      ldapUser = await prisma.user.create({
        data: { email: 'dana@example.com', username: 'dana', role: 'editor', isActive: true, timezone: 'Europe/Rome' },
      });
      await prisma.identity.create({ data: { userId: ldapUser.id, provider: 'LDAP', providerId: 'dana' } });
      session = { user: { id: ldapUser.id, email: ldapUser.email, username: ldapUser.username, role: 'editor', tokenVersion: 0 } };
      vi.spyOn(ldapAuth, 'authenticateViaLdap').mockImplementation(async (_prisma, username, password) =>
        username === 'dana' && password === DIRECTORY_PASSWORD
          ? { user: ldapUser }
          : { user: null, reason: 'invalid_credentials' }
      );
    });

    it('proves the directory password', async () => {
      await expect(
        as(session).me.changeEmail({ newEmail: 'dana@new.example.com', currentPassword: WRONG_PASSWORD })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(emailOf(ldapUser.id)).resolves.toBe('dana@example.com');

      await expect(
        as(session).me.changeEmail({ newEmail: 'dana@new.example.com', currentPassword: DIRECTORY_PASSWORD })
      ).resolves.toMatchObject({ success: true });
      await expect(emailOf(ldapUser.id)).resolves.toBe('dana@new.example.com');
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

    const ctx = createTestContext(null);
    Object.assign(ctx.req, { ip: `10.23.1.${++ip}` });
    await expect(
      appRouter.createCaller(ctx).auth.login({ username: user.username, password: TEST_USER_PASSWORD })
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
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
