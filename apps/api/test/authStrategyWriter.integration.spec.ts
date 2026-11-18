/**
 * The sign-in strategy and the LDAP switch have one writer (#246, `saveAuthConfig`), which refuses
 * `ldap-only` without LDAP on or without a break-glass administrator.
 *
 * The generic config router used to write both keys with no such check: `config.set` could turn on
 * `ldap-only` with nobody able to fall back, and the LDAP settings save rewrote the strategy with
 * every connection edit. Now the generic writes refuse both keys and `config.delete` refuses the
 * switch.
 *
 * The count is valid at the strategy's commit (owner decision 4): the writer reads and writes under
 * the last-admin lock, then the AppConfig write lock, and every change that can lower the count takes
 * one of them first — so each waits for the strategy save, and the strategy save for it. None refuses.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getConfig, saveConfig } from '../src/lib/configManager';
import { rateLimitStore } from '../src/lib/ratelimit';
import { saveAuthConfig } from '../src/services/authConfig.service';

import { TEST_USER_PASSWORD, createCallerAs, createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { holdAppConfigWriteLock, holdLastAdminLock, whileHeld } from './helpers/heldTransaction';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  await saveAuthConfig(prisma, [{ key: 'auth.ldap.enabled', value: 'true' }]);
});

describe('the generic config writes refuse both keys', () => {
  it.each(['auth.strategy', 'auth.ldap.enabled'] as const)('config.set and config.update refuse %s', async key => {
    const admin = await createCallerAs('admin');
    const before = await getConfig(prisma, key);
    const value = key === 'auth.strategy' ? 'ldap-only' : 'false';

    await expect(admin.config.set({ key, value })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(admin.config.update({ key, value })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(await getConfig(prisma, key)).toBe(before);
  });

  it('config.delete refuses the LDAP switch', async () => {
    const admin = await createCallerAs('admin');

    await expect(admin.config.delete({ key: 'auth.ldap.enabled' })).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await getConfig(prisma, 'auth.ldap.enabled')).toBe('true');
  });

  it('config.importJson reports them per item and applies the other items', async () => {
    const admin = await createCallerAs('admin');

    const result = await admin.config.importJson({
      items: [
        { key: 'auth.strategy', value: 'ldap-only' },
        { key: 'app.name', value: 'Imported' },
        { key: 'auth.ldap.enabled', value: 'false' },
      ],
    });

    expect(result.successCount).toBe(1);
    expect(result.errors.map(e => e.key)).toEqual(['auth.strategy', 'auth.ldap.enabled']);
    expect(await getConfig(prisma, 'app.name')).toBe('Imported');
    // Refused: the value the instance started from stays.
    expect(await getConfig(prisma, 'auth.strategy')).toBe('local-first');
    expect(await getConfig(prisma, 'auth.ldap.enabled')).toBe('true');
  });
});

describe('the strategy save and the changes that lower the break-glass count wait for each other', () => {
  it('the strategy save reads the count after a change holding the last-admin lock commits', async () => {
    await saveConfig(prisma, 'auth.requireEmailVerification', 'true');
    const admin = await createCallerAs('admin');
    const { user: breakGlass } = await createTestUser('admin');
    // The caller's own admin has no LOCAL identity: the other is the only break-glass administrator.
    await prisma.identity.deleteMany({ where: { provider: 'LOCAL', userId: { not: breakGlass.id } } });

    const outcome = await whileHeld(
      holdLastAdminLock,
      () => admin.integrations.auth.saveStrategy({ strategy: 'ldap-only' }),
      // What an address change does under that lock: the only break-glass address is unverified.
      holder => holder.query('UPDATE users SET "emailVerifiedAt" = NULL WHERE id = $1', [breakGlass.id])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'BAD_REQUEST' } });
    // Refused: the value the instance started from stays.
    expect(await getConfig(prisma, 'auth.strategy')).toBe('local-first');
  });

  // A verification-policy change is a `saveConfigs` write, which holds this lock
  // (`configEncryptionChoice.integration.spec.ts`).
  it('the strategy save waits for the AppConfig write lock, which a verification-policy change holds', async () => {
    const admin = await createCallerAs('admin');
    await createTestUser('admin');

    const outcome = await whileHeld(holdAppConfigWriteLock, () => admin.integrations.auth.saveStrategy({ strategy: 'ldap-first' }));

    expect(outcome.status).toBe('fulfilled');
  });

  describe('each change that can lower the count waits for the last-admin lock, and none refuses', () => {
    it('turning LDAP off', async () => {
      const admin = await createCallerAs('admin');
      const settings = {
        enabled: false,
        url: 'ldap://dc.example.com',
        searchBase: 'dc=example,dc=com',
        searchFilter: '(uid=${username})',
      };

      const outcome = await whileHeld(holdLastAdminLock, () => admin.integrations.auth.saveLdapConfig(settings));

      expect(outcome.status).toBe('fulfilled');
      expect(await getConfig(prisma, 'auth.ldap.enabled')).toBe('false');
    });

    it('revoking local access', async () => {
      const admin = await createCallerAs('admin');
      const { user } = await createTestUser('admin');
      await prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: user.username } });

      const outcome = await whileHeld(holdLastAdminLock, () => admin.users.revokeLocalAccess({ id: user.id }));

      expect(outcome.status).toBe('fulfilled');
    });

    it.each([
      ['a rename', { username: 'renamed-admin' }],
      ['an address change', { email: 'moved-admin@example.com' }],
    ])('users.update: %s', async (_case, change) => {
      const admin = await createCallerAs('admin');
      const { user } = await createTestUser('admin');

      const outcome = await whileHeld(holdLastAdminLock, () => admin.users.update({ id: user.id, ...change }));

      expect(outcome.status).toBe('fulfilled');
    });

    it('users.forceVerifyEmail removing a verification', async () => {
      const admin = await createCallerAs('admin');
      const { user } = await createTestUser('admin');

      const outcome = await whileHeld(holdLastAdminLock, () => admin.users.forceVerifyEmail({ userId: user.id, verified: false }));

      expect(outcome.status).toBe('fulfilled');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
    });

    it('me.changeEmail', async () => {
      const { user, session } = await createTestUser('admin');
      const self = createCallerWithSession(session);

      const outcome = await whileHeld(holdLastAdminLock, () =>
        self.me.changeEmail({ newEmail: 'moved-self@example.com', currentPassword: TEST_USER_PASSWORD })
      );

      expect(outcome.status).toBe('fulfilled');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe('moved-self@example.com');
    });
  });
});
