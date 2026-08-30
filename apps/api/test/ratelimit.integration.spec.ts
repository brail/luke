/**
 * Integration Tests for Rate-Limit
 * Verifies rate-limiting end-to-end with real tRPC calls
 */

import Fastify from 'fastify';
import { describe, it, expect, beforeEach } from 'vitest';

import { rateLimitStore } from '../src/lib/ratelimit';
import { trustProxy } from '../src/lib/trustProxy';

import {
  setupTestDb,
  createCallerWithIP,
  createCallerAs,
  createTestUser,
  expectToThrow,
  TEST_USER_PASSWORD,
} from './helpers';


describe('Rate-Limit Integration', () => {
  beforeEach(async () => {
    // The rate-limit store is cleared by `test/setup.ts` before every test.
    await setupTestDb();
  });

  describe('auth.login rate limiting', () => {
    it('dovrebbe bloccare dopo 5 tentativi dallo stesso IP', async () => {
      const caller = await createCallerWithIP('192.168.1.100', null);

      // First 5 requests should fail for wrong credentials but not for rate-limit
      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // 6th request must fail with TOO_MANY_REQUESTS
      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });

    it('dovrebbe permettere richieste da IP diversi', async () => {
      const caller1 = await createCallerWithIP('192.168.1.100', null);
      const caller2 = await createCallerWithIP('192.168.1.200', null);

      // Reach the limit for IP1
      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller1.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // IP1 should be blocked
      await expectToThrow(
        caller1.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // IP2 should still work
      await expectToThrow(
        caller2.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'UNAUTHORIZED' } // Not TOO_MANY_REQUESTS
      );
    });
  });

  describe('auth.login rate limiting blocks valid credentials too (proof of enforcement)', () => {
    it('dovrebbe bloccare anche un tentativo con credenziali valide dopo aver esaurito il bucket IP', async () => {
      // End-to-end proof that the IP-based block isn't just a "generic response indistinguishable
      // from a wrong password" (the validation gap flagged by the Strix pentest, which from the
      // outside couldn't verify whether the limiter actually tripped): an attempt with REAL credentials
      // must still fail with TOO_MANY_REQUESTS once the bucket is exhausted.
      const { user } = await createTestUser('viewer');
      const caller = await createCallerWithIP('192.168.1.150', null);

      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'not-the-real-user', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      await expectToThrow(
        caller.auth.login({ username: user.username, password: TEST_USER_PASSWORD }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('auth.login rate limiting per username (anti password-spray)', () => {
    it('dovrebbe bloccare dopo 10 tentativi sullo stesso username da IP diversi', async () => {
      // The 'login' bucket (keyBy: 'ip') doesn't stop a spray distributed across many IPs
      // against a single account: each IP below is under the IP threshold (5/60s), yet the
      // 'loginByUsername' bucket must still trip on the 11th attempt against the same username.
      const targetUsername = 'spray-target-user';

      for (let i = 0; i < 10; i++) {
        const caller = await createCallerWithIP(`10.0.0.${i + 1}`, null);
        await expectToThrow(
          caller.auth.login({ username: targetUsername, password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      const caller11 = await createCallerWithIP('10.0.0.11', null);
      await expectToThrow(
        caller11.auth.login({ username: targetUsername, password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });

    it('non deve essere aggirabile cambiando maiuscole/minuscole dello username', async () => {
      const targetUsername = 'CaseSprayTarget';

      for (let i = 0; i < 10; i++) {
        const caller = await createCallerWithIP(`10.0.1.${i + 1}`, null);
        const usernameVariant =
          i % 2 === 0 ? targetUsername.toLowerCase() : targetUsername.toUpperCase();
        await expectToThrow(
          caller.auth.login({ username: usernameVariant, password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      const caller11 = await createCallerWithIP('10.0.1.11', null);
      await expectToThrow(
        caller11.auth.login({ username: targetUsername, password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });

    it('non deve bloccare username diversi tra loro', async () => {
      // Distinct IP per attempt: isolates the username dimension, otherwise the
      // 'login' bucket (keyBy: 'ip', max 5/60s) would trip first and confuse the test.
      for (let i = 0; i < 10; i++) {
        const caller = await createCallerWithIP(`10.0.2.${i + 1}`, null);
        await expectToThrow(
          caller.auth.login({ username: `distinct-user-${i}`, password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }
    });
  });

  describe('me.changePassword rate limiting', () => {
    it('dovrebbe bloccare dopo 3 tentativi in 15min per stesso utente', async () => {
      const adminCaller = await createCallerAs('admin');

      // Create a user to test password change
      await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer',
      });

      // Create caller for the test user
      const userCaller = await createCallerAs('viewer');

      // First 3 requests should fail for wrong password but not for rate-limit
      for (let i = 0; i < 3; i++) {
        await expectToThrow(
          userCaller.me.changePassword({
            currentPassword: 'WrongPassw0rd!23',
            newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
          }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // 4th request must fail with TOO_MANY_REQUESTS
      await expectToThrow(
        userCaller.me.changePassword({
          currentPassword: 'WrongPassw0rd!23',
          newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('users mutations rate limiting', () => {
    it('dovrebbe bloccare dopo 10 richieste create/update/delete per stesso utente', async () => {
      const adminCaller = await createCallerAs('admin');

      // First 10 create requests should succeed
      for (let i = 0; i < 10; i++) {
        await adminCaller.users.create({
          username: `testuser${i}`,
          email: `testuser${i}@test.com`,
          password: TEST_USER_PASSWORD,
          role: 'viewer',
        });
      }

      // 11th request must fail with TOO_MANY_REQUESTS
      await expectToThrow(
        adminCaller.users.create({
          username: 'testuser11',
          email: 'testuser11@test.com',
          password: TEST_USER_PASSWORD,
          role: 'viewer',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('config mutations rate limiting', () => {
    it('dovrebbe bloccare dopo 20 richieste set/update per stesso utente', async () => {
      const adminCaller = await createCallerAs('admin');

      // First 20 set requests should succeed
      for (let i = 0; i < 20; i++) {
        await adminCaller.config.set({
          key: 'app.name',
          value: `value${i}`,
          encrypt: false,
        });
      }

      // 21st request must fail with TOO_MANY_REQUESTS
      await expectToThrow(
        adminCaller.config.set({
          key: 'app.name',
          value: 'value21',
          encrypt: false,
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('rate limit window reset', () => {
    it('dovrebbe permettere nuove richieste dopo scadenza window', async () => {
      const caller = await createCallerWithIP('192.168.1.100', null);

      // Reach the limit
      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // Should be blocked
      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // Simulate window reset (a real test should use fake timers)
      rateLimitStore.clear();

      // Should work again
      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'UNAUTHORIZED' } // Not TOO_MANY_REQUESTS
      );
    });
  });

  describe('rate limit statistics', () => {
    it('dovrebbe tracciare statistiche correttamente', async () => {
      const caller = await createCallerWithIP('192.168.1.100', null);

      const initialStats = rateLimitStore.getStats();
      expect(initialStats.routes).toBe(0);
      expect(initialStats.totalKeys).toBe(0);

      // Make a few requests
      for (let i = 0; i < 3; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      const stats = rateLimitStore.getStats();
      // 'login' (IP key) + 'loginByUsername' (username key): authenticateUser()
      // checks both buckets on every attempt, see the RC brute-force fix.
      expect(stats.routes).toBe(2);
      expect(stats.totalKeys).toBe(2); // 1 IP + 1 username
      expect(stats.maxSize).toBe(1000);
    });
  });

  describe('ENV-based rate limits', () => {
    it('should apply custom limit from ENV variables', async () => {
      // Simulate ENV override for login: 3 req/1min
      process.env.LUKE_RATE_LIMIT_LOGIN_MAX = '3';
      process.env.LUKE_RATE_LIMIT_LOGIN_WINDOW = '1m';

      const caller = await createCallerWithIP('192.168.1.100', null);

      // With a custom limit of 3, the 4th request should be blocked
      for (let i = 0; i < 3; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // Cleanup
      delete process.env.LUKE_RATE_LIMIT_LOGIN_MAX;
      delete process.env.LUKE_RATE_LIMIT_LOGIN_WINDOW;
    });

    it('should apply custom keyBy from ENV variables', async () => {
      // Simulate ENV override for passwordChange: 2 req/5min with keyBy IP
      process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX = '2';
      process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_WINDOW = '5m';
      process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_KEY_BY = 'ip';

      // Create a user to test password change
      const adminCaller = await createCallerAs('admin');
      await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer',
      });

      // Create caller for the test user
      const userCaller = await createCallerAs('viewer');

      // With a custom limit of 2, the 3rd request should be blocked
      for (let i = 0; i < 2; i++) {
        await expectToThrow(
          userCaller.me.changePassword({
            currentPassword: 'WrongPassw0rd!23',
            newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
          }),
          { code: 'UNAUTHORIZED' }
        );
      }

      await expectToThrow(
        userCaller.me.changePassword({
          currentPassword: 'WrongPassw0rd!23',
          newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // Cleanup
      delete process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX;
      delete process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_WINDOW;
      delete process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_KEY_BY;
    });
  });

  // Every `keyBy: 'ip'` bucket above only works if fastify resolves request.ip
  // correctly from X-Forwarded-For. That resolution is invisible to the tests
  // above: createCallerWithIP stubs req.ip directly on a fake context, never
  // exercising fastify's real HTTP layer or trustProxy option. This is the one
  // spot that does — it proves the resolution itself, at the HTTP level, using
  // the exact trustProxy value server.ts wires up (see lib/trustProxy.ts).
  describe('trustProxy hop resolution (fastify HTTP layer)', () => {
    async function buildTrustProxyTestServer() {
      const fastify = Fastify({ trustProxy });
      fastify.get('/whoami', async (request) => ({ ip: request.ip }));
      await fastify.ready();
      return fastify;
    }

    it('trusts the one hop apps/web sits behind: X-Forwarded-For resolves to the real client IP', async () => {
      const fastify = await buildTrustProxyTestServer();
      try {
        // remoteAddress simulates the apps/web container's socket connection
        // (the only possible direct peer per docker-compose network topology).
        // A single X-Forwarded-For entry simulates NPM's own append.
        const response = await fastify.inject({
          method: 'GET',
          url: '/whoami',
          remoteAddress: '10.0.0.5',
          headers: { 'x-forwarded-for': '203.0.113.7' },
        });
        expect(response.json().ip).toBe('203.0.113.7');
      } finally {
        await fastify.close();
      }
    });

    it('does not let a client-supplied hop spoof req.ip past the trusted one (anti-spoofing proof)', async () => {
      const fastify = await buildTrustProxyTestServer();
      try {
        // An attacker sending their own X-Forwarded-For header ends up to the
        // LEFT of whatever NPM appends (NPM appends, never overwrites). If
        // trustProxy trusted more than the one real hop, this attacker-chosen
        // value would leak through as req.ip, defeating every keyBy:'ip'
        // rate-limit bucket by letting the attacker pick their own bucket key.
        const response = await fastify.inject({
          method: 'GET',
          url: '/whoami',
          remoteAddress: '10.0.0.5',
          headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' },
        });
        expect(response.json().ip).toBe('203.0.113.7');
        expect(response.json().ip).not.toBe('198.51.100.9');
      } finally {
        await fastify.close();
      }
    });

    it('falls back to the raw socket address when there is no X-Forwarded-For at all', async () => {
      const fastify = await buildTrustProxyTestServer();
      try {
        const response = await fastify.inject({
          method: 'GET',
          url: '/whoami',
          remoteAddress: '203.0.113.9',
        });
        expect(response.json().ip).toBe('203.0.113.9');
      } finally {
        await fastify.close();
      }
    });
  });
});
