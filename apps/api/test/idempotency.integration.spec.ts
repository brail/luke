/**
 * Integration Tests for Idempotency
 * Verifies idempotency end-to-end with real tRPC calls
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach } from 'vitest';

import { idempotencyStore } from '../src/lib/idempotency';

import {
  setupTestDb,
  createTestUser,
  TEST_USER_PASSWORD,
  createCallerWithIdempotency,
  createCallerAs,
  expectToThrow,
} from './helpers';


describe('Idempotency Integration', () => {
  let testPrisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    testPrisma = await setupTestDb();
  });

  describe('users.create idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = await createCallerWithIdempotency(idempotencyKey, 'admin');

      const userData = {
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer' as const,
      };

      // First call: creates user
      const result1 = await adminCaller.users.create(userData);
      expect(result1.id).toBeDefined();
      expect(result1.username).toBe('testuser');

      // Second call: should return the same result without creating a duplicate
      const result2 = await adminCaller.users.create(userData);
      expect(result2.id).toBe(result1.id);
      expect(result2.username).toBe(result1.username);

      // Verify against the database, not via `users.list`: `users.create` marks the
      // new user `pendingApproval: true` and the list excludes pending users, so
      // a just-created user would never show up there — the assertion would measure
      // the approval workflow, not idempotency.
      const testUsers = await testPrisma.user.findMany({
        where: { username: 'testuser' },
      });
      expect(testUsers).toHaveLength(1);
    });

    it('dovrebbe fallire con 409 Conflict per stessa key con body diverso', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = await createCallerWithIdempotency(idempotencyKey, 'admin');

      const userData1 = {
        username: 'testuser1',
        email: 'testuser1@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer' as const,
      };

      const userData2 = {
        username: 'testuser2',
        email: 'testuser2@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer' as const,
      };

      // First call: creates user
      await adminCaller.users.create(userData1);

      // Second call with a different body → must fail with CONFLICT
      await expectToThrow(adminCaller.users.create(userData2), {
        code: 'CONFLICT',
      });
    });

    it('dovrebbe permettere richieste con key diverse', async () => {
      const key1 = randomUUID();
      const key2 = randomUUID();
      const adminCaller1 = await createCallerWithIdempotency(key1, 'admin');
      const adminCaller2 = await createCallerWithIdempotency(key2, 'admin');

      const userData1 = {
        username: 'testuser1',
        email: 'testuser1@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer' as const,
      };

      const userData2 = {
        username: 'testuser2',
        email: 'testuser2@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer' as const,
      };

      // Both calls should succeed
      const result1 = await adminCaller1.users.create(userData1);
      const result2 = await adminCaller2.users.create(userData2);

      expect(result1.id).not.toBe(result2.id);
      expect(result1.username).toBe('testuser1');
      expect(result2.username).toBe('testuser2');
    });
  });

  describe('users.update idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      // The setup uses a caller WITHOUT an idempotency-key: reusing the same key
      // for create and update is exactly the case the middleware rejects
      // (same key, different body → CONFLICT), and it would make the test fail during
      // setup instead of verifying the update replay.
      const setupCaller = await createCallerAs('admin');
      const user = await setupCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer',
      });

      const idempotencyKey = randomUUID();
      const adminCaller = await createCallerWithIdempotency(idempotencyKey, 'admin');

      const updateData = {
        id: user.id,
        firstName: 'Updated',
        lastName: 'User',
      };

      // First call: updates user
      const result1 = await adminCaller.users.update(updateData);
      expect(result1.firstName).toBe('Updated');

      // Second call: should return the same result
      const result2 = await adminCaller.users.update(updateData);
      expect(result2.id).toBe(result1.id);
      expect(result2.firstName).toBe(result1.firstName);
    });
  });

  describe('config.set idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = await createCallerWithIdempotency(idempotencyKey, 'admin');

      const configData = {
        key: 'app.name',
        value: 'test-value',
        encrypt: false,
      };

      // First call: sets config
      const result1 = await adminCaller.config.set(configData);
      expect(result1.key).toBe('app.name');

      // Second call: should return the same result
      const result2 = await adminCaller.config.set(configData);
      expect(result2.key).toBe(result1.key);
      expect(result2.value).toBe(result1.value);
    });

    it('dovrebbe fallire con 409 Conflict per stessa key con body diverso', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = await createCallerWithIdempotency(idempotencyKey, 'admin');

      const configData1 = {
        key: 'app.name',
        value: 'test-value-1',
        encrypt: false,
      };

      const configData2 = {
        key: 'app.locale',
        value: 'test-value-2',
        encrypt: false,
      };

      // First call: sets config
      await adminCaller.config.set(configData1);

      // Second call with a different body → must fail with CONFLICT
      await expectToThrow(adminCaller.config.set(configData2), {
        code: 'CONFLICT',
      });
    });
  });

  describe('auth.login idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const caller = await createCallerWithIdempotency(idempotencyKey, null);

      // `users.create` marks the user `pendingApproval: true` and login
      // rejects it with ACCOUNT_PENDING_APPROVAL. The fixture instead creates a user
      // that's already approved — here we're testing login idempotency, not the
      // approval workflow.
      const { user } = await createTestUser('viewer');

      const loginData = {
        username: user.username,
        password: TEST_USER_PASSWORD,
      };

      // First call: login
      const result1 = await caller.auth.login(loginData);
      expect(result1.user).toBeDefined();
      expect(result1.token).toBeDefined();

      // Second call: should return the same result
      const result2 = await caller.auth.login(loginData);
      expect(result2.user.id).toBe(result1.user.id);
      expect(result2.token).toBe(result1.token);
    });
  });

  describe('me.changePassword idempotency', () => {
    it('il secondo submit viene respinto: il cambio password revoca la sessione', async () => {
      const idempotencyKey = randomUUID();
      const userCaller = await createCallerWithIdempotency(idempotencyKey, 'viewer');

      const passwordData = {
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'NewPassw0rd!2345',
        confirmNewPassword: 'NewPassw0rd!2345',
      };

      const result1 = await userCaller.me.changePassword(passwordData);
      expect(result1.ok).toBe(true);

      // `changePassword` increments `tokenVersion` to invalidate all previous
      // sessions. The second submit uses the same, now revoked, session, and
      // `authMiddleware` blocks it BEFORE idempotency can
      // return the cached response: the middleware order is
      // auth → idempotency, and that's the right choice here. The previous test
      // expected a replay, i.e. that a revoked session would keep
      // working.
      await expectToThrow(userCaller.me.changePassword(passwordData), {
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('idempotency TTL expiration', () => {
    it('dovrebbe permettere nuove richieste dopo TTL scaduto', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = await createCallerWithIdempotency(idempotencyKey, 'admin');

      const userData = {
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer' as const,
      };

      // First call: creates user
      const result1 = await adminCaller.users.create(userData);
      expect(result1.id).toBeDefined();

      // Simulates TTL expiration (a real test should use fake timers)
      idempotencyStore.clear();

      // With the cache expired, the request is NO LONGER replayed: it reaches
      // the handler again, which rejects it for duplicate email. It's exactly this
      // rejection that proves the cache entry is gone — if it were still there,
      // we'd silently get the first call's response.
      await expectToThrow(adminCaller.users.create(userData), {
        code: 'CONFLICT',
      });
    });
  });

  describe('idempotency statistics', () => {
    it('dovrebbe tracciare statistiche correttamente', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = await createCallerWithIdempotency(idempotencyKey, 'admin');

      const initialStats = idempotencyStore.getStats();
      expect(initialStats.size).toBe(0);
      expect(initialStats.maxSize).toBe(1000);
      expect(initialStats.ttlMs).toBe(5 * 60 * 1000); // 5 minutes

      // Make an idempotent request
      await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer',
      });

      const stats = idempotencyStore.getStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('idempotency key validation', () => {
    it('dovrebbe accettare UUID v4 validi', async () => {
      // Only **v4** UUIDs: the version nibble must be `4` and the variant
      // `8|9|a|b`. The examples `6ba7b81x-9dad-11d1-...` were v1 and the middleware
      // correctly rejects them — the test asserted the opposite of its name.
      const validKeys = [
        '550e8400-e29b-41d4-a716-446655440000',
        randomUUID(),
        randomUUID(),
      ];

      for (const key of validKeys) {
        const adminCaller = await createCallerWithIdempotency(key, 'admin');

        await adminCaller.users.create({
          username: `testuser-${key.slice(0, 8)}`,
          email: `testuser-${key.slice(0, 8)}@test.com`,
          password: TEST_USER_PASSWORD,
          role: 'viewer',
        });
      }
    });

    it('dovrebbe rifiutare UUID non validi', async () => {
      const invalidKeys = [
        'not-a-uuid',
        '550e8400-e29b-41d4-a716', // too short
        '550e8400-e29b-41d4-a716-446655440000-extra', // too long
        '550e8400-e29b-41d4-a716-44665544000g', // invalid character
      ];

      for (const key of invalidKeys) {
        const adminCaller = await createCallerWithIdempotency(key, 'admin');

        await expectToThrow(
          adminCaller.users.create({
            username: 'testuser',
            email: 'testuser@test.com',
            password: TEST_USER_PASSWORD,
            role: 'viewer',
          }),
          { code: 'BAD_REQUEST' }
        );
      }
    });
  });
});
