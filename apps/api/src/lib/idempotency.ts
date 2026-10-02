/**
 * In-memory idempotency store for Luke API.
 * Stored results live in a Map with a configurable capacity (default: 1 000 keys), evicting in
 * insertion order, and a 5-minute TTL; requests still running hold a reservation outside it.
 * Request identity is hashed as SHA-256(method + path + body).
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
 * What `begin` found for a key:
 * - `hit` — a stored result of this same request, to replay;
 * - `conflict` — the key belongs to a different request, stored or still running;
 * - `inFlight` — this same request is still running;
 * - `full` — no stored result and no running request, but the reservations are at capacity;
 * - `reserved` — the key is now this request's; `token` proves it to `complete` and `release`.
 */
export type IdempotencyBegin =
  | { kind: 'hit'; response: unknown }
  | { kind: 'conflict' }
  | { kind: 'inFlight' }
  | { kind: 'full' }
  | { kind: 'reserved'; token: symbol };

/**
 * In-memory idempotency store: stored results, with insertion-order (FIFO) eviction and TTL-based
 * expiry, and the reservations of requests still running, kept apart from them.
 *
 * A reservation never expires and is never evicted: it lasts until its request settles, however
 * long that takes, because expiring it would let a second execution start while the first may still
 * commit. A request that never settles holds its key until the process restarts. The store is
 * process-local (ADR-011) and lost on restart: this is not durable exactly-once execution.
 */
export class IdempotencyStore {
  private cache = new Map<string, IdempotencyEntry>();
  private reservations = new Map<string, { requestHash: string; token: symbol }>();
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
   * Looks the key up and, when it is free, reserves it — synchronously, so no other request can
   * slip in between. The stored result and the running reservation are looked up before the
   * capacity check: a full table never turns a replay or a conflict into `full`.
   */
  begin(key: string, method: string, path: string, body: string): IdempotencyBegin {
    const requestHash = this.generateRequestHash(method, path, body);

    const entry = this.cache.get(key);
    if (entry && Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
    } else if (entry) {
      return entry.requestHash === requestHash
        ? { kind: 'hit', response: entry.response }
        : { kind: 'conflict' };
    }

    const running = this.reservations.get(key);
    if (running) {
      return running.requestHash === requestHash ? { kind: 'inFlight' } : { kind: 'conflict' };
    }

    if (this.reservations.size >= this.maxSize) {
      return { kind: 'full' };
    }

    const token = Symbol(key);
    this.reservations.set(key, { requestHash, token });
    return { kind: 'reserved', token };
  }

  /**
   * Stores the result of the request that owns the reservation and ends it. A token that no
   * longer owns the key (a stale completion) changes nothing.
   */
  complete(key: string, token: symbol, response: unknown): void {
    const running = this.reservations.get(key);
    if (running?.token !== token) return;
    this.reservations.delete(key);

    // If the cache is full, remove the oldest inserted entry: a Map keeps insertion order, and
    // nothing moves a key on reuse, so this is FIFO, not LRU.
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      requestHash: running.requestHash,
      response,
      timestamp: Date.now(),
      ttl: this.defaultTtlMs,
    });
  }

  /** Ends the reservation without storing anything, if `token` still owns it. */
  release(key: string, token: symbol): void {
    if (this.reservations.get(key)?.token === token) {
      this.reservations.delete(key);
    }
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
   * Completely clears the stored results and the reservations
   */
  clear(): void {
    this.cache.clear();
    this.reservations.clear();
  }

  /**
   * Gets cache statistics
   */
  getStats(): {
    size: number;
    inFlight: number;
    maxSize: number;
    ttlMs: number;
  } {
    return {
      size: this.cache.size,
      inFlight: this.reservations.size,
      maxSize: this.maxSize,
      ttlMs: this.defaultTtlMs,
    };
  }
}

/**
 * Singleton idempotency store shared by all request handlers.
 */
export const idempotencyStore = new IdempotencyStore();
