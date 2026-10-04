/**
 * `authenticateLocal` runs argon2 whether or not there is a credential to check.
 *
 * It used to return at once for an unknown username, an inactive user or an identity without a
 * password, and run argon2 (~tens of ms at the production cost) only for a real one: the response
 * time told an existing active account from a missing one. It now verifies against a hash of a
 * random secret (`dummyPasswordHash`) when there is nothing stored. That removes the argon2 skip;
 * it does not make the login constant-time (the lookup, the LDAP path and older hash costs differ).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as password from '../src/lib/password';
import { authenticateLocal } from '../src/services/auth.service';

import { TEST_USER_PASSWORD, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authenticateLocal runs argon2 exactly once', () => {
  it('for a real credential, and returns the user', async () => {
    const { user } = await createTestUser('viewer');
    const verify = vi.spyOn(password, 'verifyPassword');

    await expect(authenticateLocal(prisma, user.username, TEST_USER_PASSWORD)).resolves.toMatchObject({ id: user.id });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('for an unknown username', async () => {
    const verify = vi.spyOn(password, 'verifyPassword');

    await expect(authenticateLocal(prisma, 'nobody-here', TEST_USER_PASSWORD)).resolves.toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('for an inactive user', async () => {
    const { user } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const verify = vi.spyOn(password, 'verifyPassword');

    await expect(authenticateLocal(prisma, user.username, TEST_USER_PASSWORD)).resolves.toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('for an identity without a password, and never accepts one', async () => {
    const { user } = await createTestUser('viewer');
    await prisma.localCredential.deleteMany({ where: { identity: { userId: user.id } } });
    const verify = vi.spyOn(password, 'verifyPassword');

    await expect(authenticateLocal(prisma, user.username, TEST_USER_PASSWORD)).resolves.toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
