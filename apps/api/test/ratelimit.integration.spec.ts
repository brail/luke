/**
 * Integration Tests for Rate-Limit
 * Verifies rate-limiting end-to-end with real tRPC calls
 */

import Fastify from 'fastify';
import { describe, it, expect, beforeEach } from 'vitest';

import { rateLimitStore } from '../src/lib/ratelimit';
import { TrustedProxyConfigError, createTrustProxy } from '../src/lib/trustProxy';

import {
  setupTestDb,
  createCallerWithIP,
  createCallerAs,
  createTestUser,
  expectToThrow,
  TEST_USER_PASSWORD,
} from './helpers';

import type { FastifyServerOptions } from 'fastify';


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
  // spot that does — it proves the resolution itself, at the HTTP level, through
  // the same factory server.ts wires up (see lib/trustProxy.ts).
  //
  // The previous version of this block called itself an "anti-spoofing proof"
  // while running every X-Forwarded-For case from remoteAddress 10.0.0.5 — the
  // *trusted* peer. It therefore never asked the only question that matters:
  // what happens when the peer is not the proxy. Under the hop-only predicate
  // it used to assert, the answer was that request.ip became whatever the
  // attacker wrote (GHSA-3m5p-2c4r-xxw2).
  describe('trustProxy address resolution (fastify HTTP layer)', () => {
    // apps/web on the compose `edge` network, whose subnet is the value
    // LUKE_TRUSTED_PROXY_CIDR carries.
    const EDGE_CIDR = '10.254.10.0/24';
    const EDGE_PEER = '10.254.10.5';
    // Anything else that manages to open a socket to apps/api directly.
    const UNTRUSTED_PEER = '203.0.113.9';
    const REAL_CLIENT = '203.0.113.7';

    async function serverWith(trustProxy: FastifyServerOptions['trustProxy']) {
      const fastify = Fastify({ trustProxy });
      fastify.get('/whoami', async (request) => ({ ip: request.ip }));
      await fastify.ready();
      return fastify;
    }

    async function ipFor(
      trustProxy: FastifyServerOptions['trustProxy'],
      remoteAddress: string,
      xff?: string
    ) {
      const fastify = await serverWith(trustProxy);
      try {
        const response = await fastify.inject({
          method: 'GET',
          url: '/whoami',
          remoteAddress,
          headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
        });
        return response.json().ip as string;
      } finally {
        await fastify.close();
      }
    }

    const shipped = () => createTrustProxy(EDGE_CIDR, 'production');

    it('resolves the real client IP for the edge peer with an NPM-appended chain', async () => {
      // NPM uses $proxy_add_x_forwarded_for, which appends its resolved peer.
      expect(await ipFor(shipped(), EDGE_PEER, REAL_CLIENT)).toBe(REAL_CLIENT);
    });

    it('ignores a leftmost entry the client supplied itself', async () => {
      // The attacker's value sits to the LEFT of what NPM appends.
      const ip = await ipFor(shipped(), EDGE_PEER, `198.51.100.9, ${REAL_CLIENT}`);
      expect(ip).toBe(REAL_CLIENT);
      expect(ip).not.toBe('198.51.100.9');
    });

    it('ignores a forged header from a peer outside the trusted range', async () => {
      // The case the old block never ran. Under a hop-only predicate this
      // returns 9.9.9.9 and every keyBy:'ip' bucket becomes attacker-chosen.
      const ip = await ipFor(shipped(), UNTRUSTED_PEER, '9.9.9.9');
      expect(ip).toBe(UNTRUSTED_PEER);
      expect(ip).not.toBe('9.9.9.9');
    });

    it('ignores an in-range hop the client injected into the chain', async () => {
      // A bare CIDR string handed to fastify walks past this and returns the
      // leftmost value. `hop < 1` is what stops it.
      const ip = await ipFor(shipped(), EDGE_PEER, `9.9.9.9, 10.254.10.7`);
      expect(ip).toBe('10.254.10.7');
      expect(ip).not.toBe('9.9.9.9');
    });

    it('falls back to the raw socket address when there is no X-Forwarded-For', async () => {
      expect(await ipFor(shipped(), UNTRUSTED_PEER)).toBe(UNTRUSTED_PEER);
    });

    // ── The two rejected shapes, asserted to be rejected for a reason ────────

    it('a hop-only predicate would let an untrusted peer forge request.ip', async () => {
      const hopOnly: FastifyServerOptions['trustProxy'] = (_address, hop) => hop < 1;
      expect(await ipFor(hopOnly, UNTRUSTED_PEER, '9.9.9.9')).toBe('9.9.9.9');
      // ...which is exactly what the shipped predicate refuses.
      expect(await ipFor(shipped(), UNTRUSTED_PEER, '9.9.9.9')).toBe(UNTRUSTED_PEER);
    });

    it('numeric trustProxy: 1 is disabled by fastify and collapses every client onto the proxy', async () => {
      // Fastify 5.12.1 fixed GHSA-3m5p-2c4r-xxw2 by making the numeric form
      // return false. It is safe and useless: every request reports the web
      // container's address, so one rate-limit bucket is shared by everyone —
      // the CRITICAL this whole mechanism exists to prevent.
      // The 5.12.1 fix also removed the numeric form from the TypeScript union,
      // so this cast is the only way to reach the runtime behaviour at all —
      // which is itself part of what this test records.
      const numeric = 1 as unknown as FastifyServerOptions['trustProxy'];
      expect(await ipFor(numeric, EDGE_PEER, REAL_CLIENT)).toBe(EDGE_PEER);
      expect(await ipFor(shipped(), EDGE_PEER, REAL_CLIENT)).toBe(REAL_CLIENT);
    });

    // ── Configuration fails closed ──────────────────────────────────────────

    it('rejects an invalid range instead of trusting nothing silently', () => {
      for (const bad of ['not-a-cidr', '10.254.10.0/99', '10.254.10.0/24, nonsense']) {
        expect(() => createTrustProxy(bad, 'production')).toThrow(TrustedProxyConfigError);
      }
    });

    it('refuses to start in production without a configured range', () => {
      for (const missing of [undefined, '', '   ', ' , ']) {
        expect(() => createTrustProxy(missing, 'production')).toThrow(TrustedProxyConfigError);
      }
    });

    it('reads no forwarded headers at all when unconfigured outside production', async () => {
      // Local `pnpm dev` has no proxy, so the socket address is the client.
      const dev = createTrustProxy(undefined, 'development');
      expect(dev).toBe(false);
      expect(await ipFor(dev, UNTRUSTED_PEER, '9.9.9.9')).toBe(UNTRUSTED_PEER);
    });
  });
});
