/**
 * In-memory idempotency store for Luke API.
 * Uses an LRU-like Map with a configurable capacity (default: 1 000 keys)
 * and a 5-minute TTL. Request identity is hashed as SHA-256(method + path + body).
 * Clients signal intent via the `Idempotency-Key: <uuid-v4>` header.
 */

import { createHash } from 'crypto';

import pino from 'pino';

// Internal idempotency logger
const logger = pino({ level: 'info' });

/**
 * Internal cache entry for a single idempotency key.
 */
interface IdempotencyEntry {
  /** Hash of the original request */
  requestHash: string;
  /** Cached response */
  response: unknown;
  /** Creation timestamp */
  timestamp: number;
  /** TTL in milliseconds */
  ttl: number;
}

/**
 * Outcome of an idempotency cache lookup.
 */
interface IdempotencyResult {
  /** true if a match was found, false otherwise */
  hit: boolean;
  /** Cached response (only if hit=true) */
  response?: unknown;
  /** Timestamp of the original request */
  originalTimestamp?: number;
  /** true if there's a conflict (same key, different body) */
  conflict?: boolean;
}

/**
 * In-memory idempotency store with LRU eviction and TTL-based expiry.
 */
class IdempotencyStore {
  private cache = new Map<string, IdempotencyEntry>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSize: number = 1000, defaultTtlMs: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;

    // Start periodic cleanup every minute
    this.startCleanup();
  }

  /**
   * Generates a hash for a request
   *
   * @param method - HTTP method
   * @param path - Request path
   * @param body - Request body (serialized)
   * @returns SHA256 hash of the request
   */
  private generateRequestHash(
    method: string,
    path: string,
    body: string
  ): string {
    const content = `${method.toUpperCase()}:${path}:${body}`;
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Checks whether an idempotent request exists
   *
   * @param key - Idempotency key from the client
   * @param method - HTTP method
   * @param path - Request path
   * @param body - Request body
   * @returns Check result
   */
  check(
    key: string,
    method: string,
    path: string,
    body: string
  ): IdempotencyResult {
    const requestHash = this.generateRequestHash(method, path, body);
    const entry = this.cache.get(key);

    if (!entry) {
      return { hit: false };
    }

    // Check TTL
    const now = Date.now();
    if (now > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return { hit: false };
    }

    // Check that the request hash matches
    if (entry.requestHash !== requestHash) {
      // Different hash = different request with the same key
      // Return a conflict instead of removing the entry
      return { hit: false, conflict: true };
    }

    return {
      hit: true,
      response: entry.response,
      originalTimestamp: entry.timestamp,
    };
  }

  /**
   * Stores a response for an idempotent request
   *
   * @param key - Idempotency key from the client
   * @param method - HTTP method
   * @param path - Request path
   * @param body - Request body
   * @param response - Response to store
   * @param ttlMs - Custom TTL (optional)
   */
  store(
    key: string,
    method: string,
    path: string,
    body: string,
    response: unknown,
    ttlMs?: number
  ): void {
    const requestHash = this.generateRequestHash(method, path, body);
    const now = Date.now();
    const ttl = ttlMs || this.defaultTtlMs;

    // If the cache is full, remove the oldest entry (LRU)
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      requestHash,
      response,
      timestamp: now,
      ttl,
    });
  }

  /**
   * Removes expired entries from the cache
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.cache.delete(key));

    if (expiredKeys.length > 0) {
      logger.info({ removedCount: expiredKeys.length }, 'Idempotency cleanup');
    }
  }

  /**
   * Starts the periodic cleanup
   */
  private startCleanup(): void {
    // Cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Stops the periodic cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Completely clears the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Gets cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttlMs: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.defaultTtlMs,
    };
  }
}

/**
 * Singleton idempotency store shared by all request handlers.
 */
export const idempotencyStore = new IdempotencyStore();
