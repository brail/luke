/**
 * The directory decides an LDAP user's synced fields (#230). A user can hold an LDAP and a LOCAL
 * identity at once (`forceLocalAccess`); the profile used to read the first identity row, so the
 * row order decided whether the names were locked. It now takes the directory's identity first
 * (`resolveEffectiveProvider`) and its locked fields (`getLockedFields`). The address is the
 * directory's too: `me.changeEmail` refuses an LDAP account before any proof, since the next sign-in
 * would write the directory's back (`ldapAuth.integration.spec.ts`, the realignment).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as ldapAuth from '../src/lib/ldapAuth';
import { rateLimitStore } from '../src/lib/ratelimit';

import { TEST_USER_PASSWORD, createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A user with a LOCAL identity and credential, then an LDAP identity: the LOCAL row comes first. */
async function hybridUser() {
  const { user, session } = await createTestUser('editor');
  await prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: user.username } });
  return { user, caller: createCallerWithSession(session) };
}

describe('an LDAP user with a LOCAL identity too', () => {
  it('me.get reports the directory as the provider, whatever the row order', async () => {
    const { caller } = await hybridUser();

    await expect(caller.me.get()).resolves.toMatchObject({ provider: 'LDAP' });
  });

  it('me.updateProfile refuses a change to the names the directory syncs, and saves the rest', async () => {
    const { user, caller } = await hybridUser();
    const profile = { firstName: user.firstName, lastName: user.lastName, locale: 'it-IT', timezone: 'Europe/Rome' };

    await expect(caller.me.updateProfile({ ...profile, firstName: 'Altro' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await caller.me.updateProfile({ ...profile, timezone: 'Asia/Shanghai' });

    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      firstName: user.firstName,
      timezone: 'Asia/Shanghai',
    });
  });

  it('me.changeEmail refuses it before any proof, and leaves the address', async () => {
    const { user, caller } = await hybridUser();
    const ldapLogin = vi.spyOn(ldapAuth, 'authenticateViaLdap');

    await expect(
      caller.me.changeEmail({ newEmail: 'moved@example.com', currentPassword: TEST_USER_PASSWORD })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(ldapLogin).not.toHaveBeenCalled();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });
});
