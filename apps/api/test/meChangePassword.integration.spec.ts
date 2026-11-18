/**
 * The profile offers the password change exactly when `me.changePassword` accepts it (#268): both
 * read the LOCAL identity under the current username that holds a credential, whatever provider
 * the account signs in with — and only while that password can sign in now (#275): the strategy
 * admits the account's role and the email check of local sign-in passes. The change re-checks this
 * under the locks of every writer of what it reads.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { AUTH_UNAVAILABLE_MESSAGE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb, TEST_USER_PASSWORD } from './helpers';
import { holdAppConfigWriteLock, holdLastAdminLock, holdUserRow, whileHeld } from './helpers/heldTransaction';

const NEW_PASSWORD = 'Changed-Passw0rd!';
const STRATEGY_REFUSED = "Con l'accesso solo tramite LDAP la password locale di Luke non si usa e non si può cambiare";
const EMAIL_REFUSED =
  'Verifica prima la tua email: finché non è verificata la password locale di Luke non si usa e non si può cambiare';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

type User = { id: string; username: string };

const addLdap = (user: User) =>
  prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: user.username } });

const setConfig = (key: string, value: string) =>
  prisma.appConfig.upsert({ where: { key }, create: { key, value, isEncrypted: false }, update: { value } });

/** What a refused change must leave as it was: the password and the sessions. */
const written = (userId: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tokenVersion: true, identities: { select: { localCredential: { select: { passwordHash: true } } } } },
  });

const change = (session: Awaited<ReturnType<typeof createTestUser>>['session']) =>
  createCallerWithSession(session).me.changePassword({
    currentPassword: TEST_USER_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmNewPassword: NEW_PASSWORD,
  });

/** The answer when no valid sign-in strategy is stored. */
const UNAVAILABLE = { code: 'SERVICE_UNAVAILABLE', message: AUTH_UNAVAILABLE_MESSAGE } as const;

/**
 * Asserts that the profile flag and the change agree: `refusal` undefined → offered and accepted;
 * otherwise not offered and refused, nothing written: FORBIDDEN with `refusal` (any text when
 * `true`), or the answer `refusal` names.
 */
async function expectAgreement(
  { user, session }: Awaited<ReturnType<typeof createTestUser>>,
  refusal?: string | true | typeof UNAVAILABLE
) {
  expect((await createCallerWithSession(session).me.get()).canChangePassword).toBe(refusal === undefined);
  const before = await written(user.id);
  if (refusal === undefined) {
    await expect(change(session)).resolves.toEqual({ ok: true });
    return;
  }
  await expect(change(session)).rejects.toMatchObject(
    typeof refusal === 'object' ? refusal : refusal === true ? { code: 'FORBIDDEN' } : { code: 'FORBIDDEN', message: refusal }
  );
  expect(await written(user.id)).toEqual(before);
}

/** Each case starts from a local account (a LOCAL identity with a credential under its username). */
const IDENTITY_CASES: [string, (user: User) => Promise<unknown>, boolean][] = [
  ['local only', async () => undefined, true],
  [
    'directory only',
    async user => {
      await prisma.identity.deleteMany({ where: { userId: user.id, provider: 'LOCAL' } });
      await addLdap(user);
    },
    false,
  ],
  ['directory plus a local password', addLdap, true],
  [
    'directory plus a forced local access whose link is unused',
    async user => {
      await addLdap(user);
      await prisma.localCredential.deleteMany({ where: { identity: { userId: user.id } } });
    },
    false,
  ],
  [
    'a local password left under an old username',
    user => prisma.user.update({ where: { id: user.id }, data: { username: `${user.username}-renamed` } }),
    false,
  ],
];

describe('me.get canChangePassword agrees with me.changePassword', () => {
  it.each(IDENTITY_CASES)('%s', async (_name, arrange, changeable) => {
    const account = await createTestUser('editor');
    await arrange(account.user);
    await expectAgreement(account, changeable ? undefined : true);
  });

  // Every account below has a directory identity and a local password.
  it.each([
    ['ldap-only, not an administrator', 'editor', 'ldap-only', STRATEGY_REFUSED],
    ['ldap-only, an administrator (break-glass)', 'admin', 'ldap-only', undefined],
    ['local-only', 'editor', 'local-only', undefined],
    ['ldap-first', 'editor', 'ldap-first', undefined],
    ['an empty stored strategy', 'editor', '', UNAVAILABLE],
    ['an unknown stored strategy', 'editor', 'bogus', UNAVAILABLE],
  ] as const)('%s', async (_name, role, strategy, refusal) => {
    const account = await createTestUser(role);
    await addLdap(account.user);
    await setConfig('auth.strategy', strategy);
    await expectAgreement(account, refusal);
  });

  it.each([
    ['unverified', null, EMAIL_REFUSED],
    ['verified', new Date(), undefined],
  ] as const)('local-first, verification required, email %s', async (_name, emailVerifiedAt, refusal) => {
    const account = await createTestUser('editor');
    await addLdap(account.user);
    await prisma.user.update({ where: { id: account.user.id }, data: { emailVerifiedAt } });
    await setConfig('auth.requireEmailVerification', 'true');
    await expectAgreement(account, refusal);
  });

  it('ldap-only administrator with an unverified email while verification is required', async () => {
    const account = await createTestUser('admin');
    await addLdap(account.user);
    await prisma.user.update({ where: { id: account.user.id }, data: { emailVerifiedAt: null } });
    await setConfig('auth.strategy', 'ldap-only');
    await setConfig('auth.requireEmailVerification', 'true');
    await expectAgreement(account, EMAIL_REFUSED);
  });
});

describe('me.changePassword re-checks under the locks of what it reads', () => {
  it('a strategy turned to ldap-only meanwhile refuses a non-administrator', async () => {
    const { user, session } = await createTestUser('editor');
    await addLdap(user);
    const before = await written(user.id);

    const outcome = await whileHeld(holdLastAdminLock, () => change(session), holder =>
      holder.query(`UPDATE app_configs SET value = 'ldap-only' WHERE key = 'auth.strategy'`)
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'FORBIDDEN', message: STRATEGY_REFUSED } });
    expect(await written(user.id)).toEqual(before);
  });

  it.each([
    ['deleted', `DELETE FROM app_configs WHERE key = 'auth.strategy'`],
    ['made invalid', `UPDATE app_configs SET value = 'bogus' WHERE key = 'auth.strategy'`],
  ])('a strategy %s meanwhile refuses the change as unavailable', async (_name, sql) => {
    const { user, session } = await createTestUser('editor');
    const before = await written(user.id);

    const outcome = await whileHeld(holdLastAdminLock, () => change(session), holder => holder.query(sql));

    expect(outcome).toMatchObject({ status: 'rejected', reason: UNAVAILABLE });
    expect(await written(user.id)).toEqual(before);
  });

  it('an administrator demoted meanwhile under ldap-only is refused', async () => {
    const { user, session } = await createTestUser('admin');
    await addLdap(user);
    await setConfig('auth.strategy', 'ldap-only');
    const before = await written(user.id);

    // The role is read under the user row, which every role writer locks.
    const outcome = await whileHeld(holdUserRow(user.id), () => change(session), holder =>
      holder.query(`UPDATE users SET role = 'editor' WHERE id = $1`, [user.id])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'FORBIDDEN', message: STRATEGY_REFUSED } });
    expect(await written(user.id)).toEqual(before);
  });

  it('an email unverified meanwhile, verification required, is refused', async () => {
    const { user, session } = await createTestUser('editor');
    await addLdap(user);
    await setConfig('auth.requireEmailVerification', 'true');
    const before = await written(user.id);

    const outcome = await whileHeld(holdUserRow(user.id), () => change(session), holder =>
      holder.query(`UPDATE users SET "emailVerifiedAt" = NULL WHERE id = $1`, [user.id])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'FORBIDDEN', message: EMAIL_REFUSED } });
    expect(await written(user.id)).toEqual(before);
  });

  it('verification turned on meanwhile refuses an administrator with an unverified email', async () => {
    const { user, session } = await createTestUser('admin');
    await addLdap(user);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    await setConfig('auth.strategy', 'ldap-only');
    await setConfig('auth.requireEmailVerification', 'false');
    const before = await written(user.id);

    const outcome = await whileHeld(holdAppConfigWriteLock, () => change(session), holder =>
      holder.query(`UPDATE app_configs SET value = 'true' WHERE key = 'auth.requireEmailVerification'`)
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'FORBIDDEN', message: EMAIL_REFUSED } });
    expect(await written(user.id)).toEqual(before);
  });
});
