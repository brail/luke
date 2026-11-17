/**
 * A forced local access prepares the LOCAL identity and writes no password: the reset link creates
 * the credential when the user sets one.
 *
 * Every writer of a user's identities and credential takes the user row first (`lockUserEmail`):
 * the link's consume, the revocation, a rename, the self-service change. The races below hold that
 * row from a connection of their own and prove each side waits and then reads the committed state.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { issueUserToken } from '../src/lib/emailHelpers';
import { authenticateLocal, confirmPasswordReset, countBreakGlassAdmins } from '../src/services/auth.service';
import { saveAuthConfig } from '../src/services/authConfig.service';

import { createCallerAs, createCallerWithSession, createTestContext, createTestUser, setupTestDb, TEST_USER_PASSWORD } from './helpers';
import { holdUserRow, whileHeld } from './helpers/heldTransaction';

const NEW_PASSWORD = 'Recovered-Passw0rd!';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

/** An administrator who signs in through the directory: an LDAP identity, no LOCAL one. */
async function directoryAdmin() {
  const uid = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `dir-admin-${uid}@test.com`,
      username: `dir-admin-${uid}`,
      role: 'admin',
      isActive: true,
      timezone: 'Europe/Rome',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: user.username } });
  return user;
}

/** The state a forced local access leaves: a LOCAL identity with no credential. */
async function forcedAdmin() {
  const user = await directoryAdmin();
  const identity = await prisma.identity.create({ data: { userId: user.id, provider: 'LOCAL', providerId: user.username } });
  return { user, identity };
}

/** A reset link for `userId`, as the forced access or the reset request issues it. */
async function resetLink(userId: string) {
  const issued = await prisma.$transaction(tx => issueUserToken(tx, userId, 'RESET', { revokePrevious: false }));
  if (!issued) throw new Error(`no link issued for ${userId}`);
  return issued.token;
}

const consume = (token: string) => confirmPasswordReset(createTestContext(null), { token, newPassword: NEW_PASSWORD });
const credentials = (userId: string) => prisma.localCredential.findMany({ where: { identity: { userId } } });
const tokenVersion = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tokenVersion;

describe('a forced local access has no password until its link sets one', () => {
  it('end to end: no credential and no local sign-in, then the link sets one; the strategy save reads the stored passwords', async () => {
    const admin = await createCallerAs('admin');
    const target = await directoryAdmin();
    // Nobody else holds a local password.
    await prisma.identity.deleteMany({ where: { provider: 'LOCAL' } });
    await saveAuthConfig(prisma, [{ key: 'auth.ldap.enabled', value: 'true' }]);

    // No test SMTP: the send fails after the identity is prepared (see `usersLocalAccess`).
    await expect(admin.users.forceLocalAccess({ id: target.id })).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(await credentials(target.id)).toEqual([]);
    expect(await prisma.$transaction(tx => countBreakGlassAdmins(tx))).toBe(0);
    await expect(saveAuthConfig(prisma, [{ key: 'auth.strategy', value: 'ldap-only' }])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await authenticateLocal(prisma, target.username, NEW_PASSWORD)).toBeNull();

    await consume(await resetLink(target.id));

    expect(await credentials(target.id)).toHaveLength(1);
    expect(await prisma.$transaction(tx => countBreakGlassAdmins(tx))).toBe(1);
    await expect(saveAuthConfig(prisma, [{ key: 'auth.strategy', value: 'ldap-only' }])).resolves.toBeDefined();
    expect(await authenticateLocal(prisma, target.username, NEW_PASSWORD)).toMatchObject({ id: target.id });
  });

  it('the link creates the credential, ends the sessions and audits the change', async () => {
    const { user, identity } = await forcedAdmin();
    const before = await tokenVersion(user.id);

    await consume(await resetLink(user.id));

    expect(await credentials(user.id)).toMatchObject([{ identityId: identity.id }]);
    expect(await tokenVersion(user.id)).toBe(before + 1);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_CHANGED', targetId: user.id, result: 'SUCCESS' } })).toBe(1);
  });

  it('a link for an account with no LOCAL identity is an invalid link', async () => {
    const user = await directoryAdmin();

    await expect(consume(await resetLink(user.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await credentials(user.id)).toEqual([]);
  });
});

describe('the link waits for the user row, then reads what committed', () => {
  it('a revocation meanwhile: an invalid link, nothing written, no server error', async () => {
    const { user } = await forcedAdmin();
    const token = await resetLink(user.id);
    const before = await tokenVersion(user.id);

    const outcome = await whileHeld(holdUserRow(user.id), () => consume(token), holder =>
      holder.query(`DELETE FROM identities WHERE "userId" = $1 AND provider = 'LOCAL'`, [user.id])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    expect(await credentials(user.id)).toEqual([]);
    expect(await tokenVersion(user.id)).toBe(before);
  });

  it('a deletion of the account meanwhile: an invalid link', async () => {
    const { user } = await forcedAdmin();
    const token = await resetLink(user.id);

    const outcome = await whileHeld(holdUserRow(user.id), () => consume(token), holder =>
      holder.query('DELETE FROM users WHERE id = $1', [user.id])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
  });

  it('a rename that moves the identity meanwhile: the credential lands on the moved identity', async () => {
    const { user, identity } = await forcedAdmin();
    const token = await resetLink(user.id);
    const renamed = `${user.username}-renamed`;

    const outcome = await whileHeld(holdUserRow(user.id), () => consume(token), async holder => {
      await holder.query('UPDATE users SET username = $1 WHERE id = $2', [renamed, user.id]);
      await holder.query(`UPDATE identities SET "providerId" = $1 WHERE id = $2`, [renamed, identity.id]);
    });

    expect(outcome.status).toBe('fulfilled');
    expect(await credentials(user.id)).toMatchObject([{ identityId: identity.id }]);
    expect(await authenticateLocal(prisma, renamed, NEW_PASSWORD)).toMatchObject({ id: user.id });
  });

  it('two links of a password-less account: both apply in turn, one credential, no server error', async () => {
    const { user } = await forcedAdmin();
    const [first, second] = [await resetLink(user.id), await resetLink(user.id)];
    const before = await tokenVersion(user.id);

    const outcomes = await Promise.allSettled([consume(first), consume(second)]);

    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await credentials(user.id)).toHaveLength(1);
    expect(await tokenVersion(user.id)).toBe(before + 2);
  });

  it('the same link twice: one sets the password, the other is an invalid link', async () => {
    const { user } = await forcedAdmin();
    const token = await resetLink(user.id);
    const before = await tokenVersion(user.id);

    const outcomes = await Promise.allSettled([consume(token), consume(token)]);

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({ reason: { code: 'NOT_FOUND' } });
    expect(await credentials(user.id)).toHaveLength(1);
    expect(await tokenVersion(user.id)).toBe(before + 1);
  });
});

describe('the other writers take the user row first too', () => {
  it('a revocation waits for the user row before it touches the identity', async () => {
    const admin = await createCallerAs('admin');
    const { user } = await forcedAdmin();

    // While it waits, the identity is still unlocked: NOWAIT would fail on a row it had deleted.
    const outcome = await whileHeld(holdUserRow(user.id), () => admin.users.revokeLocalAccess({ id: user.id }), holder =>
      holder.query(`SELECT 1 FROM identities WHERE "userId" = $1 AND provider = 'LOCAL' FOR UPDATE NOWAIT`, [user.id])
    );

    expect(outcome.status).toBe('fulfilled');
    expect(await prisma.identity.count({ where: { userId: user.id, provider: 'LOCAL' } })).toBe(0);
  });

  it('a self-service change waits for the user row, and refuses a password a link set meanwhile', async () => {
    const { user, session } = await createTestUser('editor');
    const self = createCallerWithSession(session);

    const outcome = await whileHeld(
      holdUserRow(user.id),
      () => self.me.changePassword({ currentPassword: TEST_USER_PASSWORD, newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD }),
      holder => holder.query(
        `UPDATE local_credentials SET "passwordHash" = 'set-by-a-link' WHERE "identityId" IN (SELECT id FROM identities WHERE "userId" = $1)`,
        [user.id]
      )
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    expect(await credentials(user.id)).toMatchObject([{ passwordHash: 'set-by-a-link' }]);
  });

  it('a self-service change whose local access was revoked meanwhile: refused as without one, not as a conflict', async () => {
    const { user, session } = await createTestUser('editor');
    const self = createCallerWithSession(session);

    const outcome = await whileHeld(
      holdUserRow(user.id),
      () => self.me.changePassword({ currentPassword: TEST_USER_PASSWORD, newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD }),
      holder => holder.query(`DELETE FROM identities WHERE "userId" = $1 AND provider = 'LOCAL'`, [user.id])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'FORBIDDEN' } });
  });
});
