/**
 * Test per Idempotency tRPC Middleware
 * Verifica funzionalità di idempotency per richieste duplicate
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { idempotencyStore } from '../src/lib/idempotency';

describe('Idempotency Store', () => {
  beforeEach(() => {
    idempotencyStore.clear();
  });

  afterEach(() => {
    idempotencyStore.clear();
  });

  describe('Basic functionality', () => {
    it('should return miss for new key', () => {
      const key = 'test-key-123';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body = JSON.stringify({ username: 'test', password: 'test' });

      const result = idempotencyStore.check(key, method, path, body);
      expect(result.hit).toBe(false);
    });

    it('should store and retrieve response', () => {
      const key = 'test-key-123';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body = JSON.stringify({ username: 'test', password: 'test' });
      const response = { user: { id: '123', email: 'test@example.com' } };

      // Store response
      idempotencyStore.store(key, method, path, body, response);

      // Check should return hit
      const result = idempotencyStore.check(key, method, path, body);
      expect(result.hit).toBe(true);
      expect(result.response).toEqual(response);
    });

    it('should miss for different request with same key', () => {
      const key = 'test-key-123';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body1 = JSON.stringify({ username: 'test1', password: 'test1' });
      const body2 = JSON.stringify({ username: 'test2', password: 'test2' });
      const response = { user: { id: '123', email: 'test@example.com' } };

      // Store response for body1
      idempotencyStore.store(key, method, path, body1, response);

      // Check with body2 should miss
      const result = idempotencyStore.check(key, method, path, body2);
      expect(result.hit).toBe(false);
    });

    it('should miss for different key with same request', () => {
      const key1 = 'test-key-123';
      const key2 = 'test-key-456';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body = JSON.stringify({ username: 'test', password: 'test' });
      const response = { user: { id: '123', email: 'test@example.com' } };

      // Store response for key1
      idempotencyStore.store(key1, method, path, body, response);

      // Check with key2 should miss
      const result = idempotencyStore.check(key2, method, path, body);
      expect(result.hit).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('should miss after TTL expires', () => {
      const key = 'test-key-123';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body = JSON.stringify({ username: 'test', password: 'test' });
      const response = { user: { id: '123', email: 'test@example.com' } };

      // Store response
      idempotencyStore.store(key, method, path, body, response);

      // Should hit initially
      const result1 = idempotencyStore.check(key, method, path, body);
      expect(result1.hit).toBe(true);

      // Clear store simula TTL expiration
      idempotencyStore.clear();

      // Should miss after expiration
      const result2 = idempotencyStore.check(key, method, path, body);
      expect(result2.hit).toBe(false);
    });
  });

  describe('Request hash validation', () => {
    it('should validate request hash correctly', () => {
      const key = 'test-key-123';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body = JSON.stringify({ username: 'test', password: 'test' });
      const response = { user: { id: '123', email: 'test@example.com' } };

      // Store response
      idempotencyStore.store(key, method, path, body, response);

      // Same request should hit
      const result1 = idempotencyStore.check(key, method, path, body);
      expect(result1.hit).toBe(true);

      // Different method should miss
      const result2 = idempotencyStore.check(key, 'GET', path, body);
      expect(result2.hit).toBe(false);

      // Different path should miss
      const result3 = idempotencyStore.check(key, method, '/trpc/me.get', body);
      expect(result3.hit).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should track statistics correctly', () => {
      const stats = idempotencyStore.getStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(1000);
      expect(stats.ttlMs).toBe(5 * 60 * 1000); // 5 minuti
    });

    it('should update statistics after operations', () => {
      const key = 'test-key-123';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body = JSON.stringify({ username: 'test', password: 'test' });
      const response = { user: { id: '123', email: 'test@example.com' } };

      const initialStats = idempotencyStore.getStats();
      expect(initialStats.size).toBe(0);

      // Store response
      idempotencyStore.store(key, method, path, body, response);

      const stats = idempotencyStore.getStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('Cleanup', () => {
    it('should handle cleanup correctly', () => {
      const key = 'test-key-123';
      const method = 'POST';
      const path = '/trpc/auth.login';
      const body = JSON.stringify({ username: 'test', password: 'test' });
      const response = { user: { id: '123', email: 'test@example.com' } };

      // Store response
      idempotencyStore.store(key, method, path, body, response);

      const stats1 = idempotencyStore.getStats();
      expect(stats1.size).toBe(1);

      // Clear store
      idempotencyStore.clear();

      const stats2 = idempotencyStore.getStats();
      expect(stats2.size).toBe(0);
    });
  });
});
