/**
 * Test per Rate-Limit Store
 * Verifica funzionalità di rate limiting per-rotta
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rateLimitStore, RATE_LIMIT_CONFIG } from '../src/lib/ratelimit';

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

      // Prime 4 richieste dovrebbero essere permesse
      for (let i = 0; i < 4; i++) {
        expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);
        rateLimitStore.record(routeName, key, config);
      }
    });

    it('should block requests after limit exceeded', () => {
      const routeName = 'login';
      const key = '192.168.1.1';
      const config = RATE_LIMIT_CONFIG[routeName];

      // Raggiungi il limite
      for (let i = 0; i < config.max; i++) {
        expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);
        rateLimitStore.record(routeName, key, config);
      }

      // La prossima richiesta dovrebbe essere bloccata
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);
    });

    it('should reset after window expires with fake timers', () => {
      vi.useFakeTimers();

      const routeName = 'login';
      const key = '192.168.1.1';
      const config = RATE_LIMIT_CONFIG[routeName];

      // Raggiungi limite
      for (let i = 0; i < config.max; i++) {
        rateLimitStore.record(routeName, key, config);
      }
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);

      // Avanza il tempo di 61 secondi (oltre il window di 60s)
      vi.advanceTimersByTime(61_000);

      // Dovrebbe essere di nuovo permesso
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(false);

      vi.useRealTimers();
    });

    it('should reset passwordChange after 15min window', () => {
      vi.useFakeTimers();

      const routeName = 'passwordChange';
      const key = 'user-123';
      const config = RATE_LIMIT_CONFIG[routeName];

      // Raggiungi limite (3 req)
      for (let i = 0; i < config.max; i++) {
        rateLimitStore.record(routeName, key, config);
      }
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);

      // Avanza 14min → ancora bloccato
      vi.advanceTimersByTime(14 * 60 * 1000);
      expect(rateLimitStore.isLimited(routeName, key, config)).toBe(true);

      // Avanza 2min (totale 16min) → sbloccato
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

      // Raggiungi limite per key1
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

      // Raggiungi limite per route1
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

      // Aggiungi alcune richieste
      rateLimitStore.record(routeName, key, config);

      const stats = rateLimitStore.getStats();
      expect(stats.routes).toBe(1);
      expect(stats.totalKeys).toBe(1);
      expect(stats.maxSize).toBe(1000);
    });
  });
});
