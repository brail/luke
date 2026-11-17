/**
 * The profile offers the password change exactly when `me.changePassword` accepts it (#268): both
 * read the LOCAL identity under the current username that holds a credential, whatever provider
 * the account signs in with.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb, TEST_USER_PASSWORD } from './helpers';

const NEW_PASSWORD = 'Changed-Passw0rd!';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

type User = { id: string; username: string };

const addLdap = (user: User) =>
  prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: user.username } });

/** Each case starts from a local account (a LOCAL identity with a credential under its username). */
const CASES: [string, (user: User) => Promise<unknown>, boolean][] = [
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
  it.each(CASES)('%s', async (_name, arrange, changeable) => {
    const { user, session } = await createTestUser('editor');
    await arrange(user);
    const self = createCallerWithSession(session);

    expect((await self.me.get()).canChangePassword).toBe(changeable);

    const change = self.me.changePassword({
      currentPassword: TEST_USER_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmNewPassword: NEW_PASSWORD,
    });
    if (changeable) {
      await expect(change).resolves.toEqual({ ok: true });
    } else {
      await expect(change).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
