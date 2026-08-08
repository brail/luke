/**
 * Tests for Rate-Limit Store
 * Verifies per-route rate limiting functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { RateLimitConfigSchema } from '@luke/core';

import { rateLimitStore, RATE_LIMIT_CONFIG } from '../src/lib/ratelimit';
import { RATE_LIMIT_POLICY_DEFAULTS } from '../src/lib/rateLimitPolicy';

describe('Rate-Limit Store', () => {
  beforeEach(() => {
    rateLimitStore.clear();
  });

  afterEach(() => {
    rateLimitStore.clear();
  });

  describe('Basic functionality', () => {
    it('should allow requests within limit', () => {
      const routeName = 'login';
      const key = '192.168.1.1';
      const config = RATE_LIMIT_CONFIG[routeName];

      // First 4 requests should be allowed
      for (let i = 0; i < 4; i++) {
        expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);
        rateLimitStore.record(routeName, key, config);
      }
    });

    it('should block requests after limit exceeded', () => {
      const routeName = 'login';
      const key = '192.168.1.1';
      const config = RATE_LIMIT_CONFIG[routeName];

      // Reach the limit
      for (let i = 0; i < config.max; i++) {
        expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);
        rateLimitStore.record(routeName, key, config);
      }

      // The next request should be blocked
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);
    });

    it('should reset after window expires with fake timers', () => {
      vi.useFakeTimers();

      const routeName = 'login';
      const key = '192.168.1.1';
      const config = RATE_LIMIT_CONFIG[routeName];

      // Reach the limit
      for (let i = 0; i < config.max; i++) {
        rateLimitStore.record(routeName, key, config);
      }
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);

      // Advance time by 61 seconds (past the 60s window)
      vi.advanceTimersByTime(61_000);

      // Should be allowed again
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);

      vi.useRealTimers();
    });

    it('should block loginByUsername after 10 attempts regardless of key format', () => {
      const routeName = 'loginByUsername';
      const key = 'spray-target-user'; // key = normalized username, not an IP
      const config = RATE_LIMIT_CONFIG[routeName];

      for (let i = 0; i < config.max; i++) {
        expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);
        rateLimitStore.record(routeName, key, config);
      }

      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);
    });

    it('should reset passwordChange after 15min window', () => {
      vi.useFakeTimers();

      const routeName = 'passwordChange';
      const key = 'user-123';
      const config = RATE_LIMIT_CONFIG[routeName];

      // Reach the limit (3 req)
      for (let i = 0; i < config.max; i++) {
        rateLimitStore.record(routeName, key, config);
      }
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);

      // Advance 14min → still blocked
      vi.advanceTimersByTime(14 * 60 * 1000);
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);

      // Advance 2min (16min total) → unblocked
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('Key separation', () => {
    it('should separate different IPs', () => {
      const routeName = 'login';
      const key1 = '192.168.1.1';
      const key2 = '192.168.1.2';
      const config = RATE_LIMIT_CONFIG[routeName];

      // Reach the limit for key1
      for (let i = 0; i < config.max; i++) {
        rateLimitStore.record(routeName, key1, config);
      }

      expect(rateLimitStore.isLimited(routeName, key1, config)).toBe(true);
      expect(rateLimitStore.isLimited(routeName, key2, config)).toBe(false);
    });

    it('should separate different routes', () => {
      const routeName1 = 'login';
      const routeName2 = 'configMutations';
      const key = '192.168.1.1';
      const config1 = RATE_LIMIT_CONFIG[routeName1];
      const config2 = RATE_LIMIT_CONFIG[routeName2];

      // Reach the limit for route1
      for (let i = 0; i < config1.max; i++) {
        rateLimitStore.record(routeName1, key, config1);
      }

      expect(rateLimitStore.isLimited(routeName1, key, config1)).toBe(true);
      expect(rateLimitStore.isLimited(routeName2, key, config2)).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should use correct limits for different routes', () => {
      expect(RATE_LIMIT_CONFIG.login.max).toBe(5);
      expect(RATE_LIMIT_CONFIG.login.windowMs).toBe(60_000);
      expect(RATE_LIMIT_CONFIG.login.keyBy).toBe('ip');

      expect(RATE_LIMIT_CONFIG.loginByUsername.max).toBe(10);
      expect(RATE_LIMIT_CONFIG.loginByUsername.windowMs).toBe(900_000);
      expect(RATE_LIMIT_CONFIG.loginByUsername.keyBy).toBe('username');

      expect(RATE_LIMIT_CONFIG.passwordChange.max).toBe(3);
      expect(RATE_LIMIT_CONFIG.passwordChange.windowMs).toBe(900_000);
      expect(RATE_LIMIT_CONFIG.passwordChange.keyBy).toBe('userId');

      expect(RATE_LIMIT_CONFIG.configMutations.max).toBe(20);
      expect(RATE_LIMIT_CONFIG.configMutations.windowMs).toBe(60_000);
      expect(RATE_LIMIT_CONFIG.configMutations.keyBy).toBe('userId');

      expect(RATE_LIMIT_CONFIG.userMutations.max).toBe(10);
      expect(RATE_LIMIT_CONFIG.userMutations.windowMs).toBe(60_000);
      expect(RATE_LIMIT_CONFIG.userMutations.keyBy).toBe('userId');
    });
  });

  describe('Statistics', () => {
    it('should track statistics correctly', () => {
      const routeName = 'login';
      const key = '192.168.1.1';
      const config = RATE_LIMIT_CONFIG[routeName];

      const initialStats = rateLimitStore.getStats();
      expect(initialStats.routes).toBe(0);
      expect(initialStats.totalKeys).toBe(0);

      // Add a few requests
      rateLimitStore.record(routeName, key, config);

      const stats = rateLimitStore.getStats();
      expect(stats.routes).toBe(1);
      expect(stats.totalKeys).toBe(1);
      expect(stats.maxSize).toBe(1000);
    });
  });
});

describe('Sincronia delle mappe di rate limit', () => {
  it('ogni rotta in RATE_LIMIT_CONFIG ha un default in RATE_LIMIT_POLICY_DEFAULTS', () => {
    // `resolveRateLimitPolicy` throws on a route missing from the defaults: a
    // key added to only one map isn't a compile error, it's a crash on the
    // first request that uses it. This has already happened (v1.9.1).
    const missing = Object.keys(RATE_LIMIT_CONFIG).filter(
      route => !(route in RATE_LIMIT_POLICY_DEFAULTS)
    );

    expect(missing).toEqual([]);
  });

  it('ogni rotta in RATE_LIMIT_CONFIG ha un campo in RateLimitConfigSchema', () => {
    // If missing here, an AppConfig override for that route gets silently
    // discarded by safeParse (non-strict) — no error, no log.
    const schemaKeys = Object.keys(RateLimitConfigSchema.shape);
    const missing = Object.keys(RATE_LIMIT_CONFIG).filter(
      route => !schemaKeys.includes(route)
    );

    expect(missing).toEqual([]);
  });
});
