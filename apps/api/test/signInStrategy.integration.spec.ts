/**
 * Sign-in reads the stored strategy with no default: when none valid is stored, nobody signs in.
 * The answer is the fixed unavailable text, for every account alike; no password is checked and
 * the directory is not asked; the administrators are told once per window. The per-account bucket
 * still answers first, and the LDAP page reads no strategy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_UNAVAILABLE_MESSAGE, SIGN_IN_REFUSED_MESSAGE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { encryptValue } from '../src/lib/configManager';
import * as ldapAuth from '../src/lib/ldapAuth';

import {
  TEST_USER_PASSWORD,
  createCallerAs,
  createCallerWithIP,
  createCallerWithSession,
  createTestUser,
  lastAudit,
  setAuthStrategy,
  setupTestDb,
} from './helpers';

let prisma: PrismaClient;
let ip = 0;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const UNAVAILABLE = { code: 'SERVICE_UNAVAILABLE', message: AUTH_UNAVAILABLE_MESSAGE };
const notices = () => prisma.notification.count({ where: { title: 'Strategia di accesso non disponibile' } });

/** A login from a fresh address, so the per-IP bucket never answers for the account's. */
async function login(username: string, password = TEST_USER_PASSWORD) {
  return (await createCallerWithIP(`10.29.0.${++ip}`)).auth.login({ username, password });
}

const STATES: [string, () => Promise<unknown>][] = [
  ['absent', () => prisma.appConfig.deleteMany({ where: { key: 'auth.strategy' } })],
  ['invalid', () => setAuthStrategy(prisma, 'bogus')],
];

describe.each(STATES)('with the strategy %s', (_state, arrange) => {
  it('refuses every sign-in with the fixed text, audited, without asking the directory', async () => {
    const ldap = vi.spyOn(ldapAuth, 'authenticateViaLdap');
    const { user: editor } = await createTestUser('editor');
    const { user: admin } = await createTestUser('admin');
    await arrange();

    for (const username of [editor.username, admin.username]) {
      await expect(login(username)).rejects.toMatchObject(UNAVAILABLE);
      expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ username, reason: 'strategy_unavailable' });
    }
    // An unknown account is answered the same: nothing tells one account from another.
    await expect(login('nobody-here')).rejects.toMatchObject(UNAVAILABLE);
    expect(ldap).not.toHaveBeenCalled();
  });

  it('tells the administrators once for repeated refusals', async () => {
    const { user } = await createTestUser('editor');
    await createTestUser('admin'); // someone to tell
    await arrange();

    await expect(login(user.username)).rejects.toMatchObject(UNAVAILABLE);
    await expect(login(user.username)).rejects.toMatchObject(UNAVAILABLE);

    expect(await notices()).toBe(1);
  });

  it('answers a signed-in password proof the same way', async () => {
    const { session } = await createTestUser('editor');
    await arrange();

    await expect(
      createCallerWithSession(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: TEST_USER_PASSWORD })
    ).rejects.toMatchObject(UNAVAILABLE);
  });

  it('a full per-account bucket still answers first', async () => {
    const { user } = await createTestUser('editor');
    // `loginByUsername`: 10 checks per account in 15 minutes.
    for (let i = 0; i < 10; i++) {
      await expect(login(user.username, 'Wrong-Passw0rd!')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    }
    await arrange();

    await expect(login(user.username)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: SIGN_IN_REFUSED_MESSAGE });
    expect((await lastAudit('AUTH_LOGIN_FAILED'))?.metadata).toMatchObject({ reason: 'rate_limited_username' });
  });

  it('the LDAP page reads no strategy', async () => {
    await arrange();
    expect((await (await createCallerAs('admin')).integrations.auth.getLdapConfig()).strategy).toBeNull();
  });
});

it('a strategy an earlier release stored encrypted is read, as the boot check reads it', async () => {
  const { user } = await createTestUser('editor');
  await prisma.appConfig.update({
    where: { key: 'auth.strategy' },
    data: { value: encryptValue('local-first'), isEncrypted: true },
  });

  await expect(login(user.username)).resolves.toMatchObject({ user: { id: user.id } });
});
