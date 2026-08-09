/**
 * In-memory rate-limit store for Luke API.
 * Uses a per-route LRU Map (max 1 000 keys per route) with configurable TTL windows.
 * Key extraction is IP-based for public endpoints and user-ID-based for authenticated ones.
 * Expired entries are evicted on a 60-second cleanup interval.
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';

import { buildRateLimitExceededError } from './rateLimitError';
import { resolveRateLimitPolicy } from './rateLimitPolicy';
import { t } from './t';

import type { FastifyRequest } from 'fastify';

// Internal rate-limit logger
const logger = pino({ level: 'info' });

/**
 * Static fallback rate-limit configuration used when AppConfig / env overrides are absent.
 * Values are conservative security defaults.
 */
export const RATE_LIMIT_CONFIG = {
  login: {
    max: 5, // 5 attempts
    windowMs: 60_000, // 1 minute
    keyBy: 'ip' as const,
  },
  // Separate bucket, keyed by username (not IP): stops a password-spray distributed
  // across many IPs against a single account, which the 'login' bucket (keyBy: 'ip') doesn't cover.
  // Applied directly in authenticateUser() with the normalized username as an
  // explicit key — it doesn't go through withRateLimit()/extractRateLimitKey (which
  // doesn't derive 'username' from ctx, since login is an unauthenticated public endpoint).
  loginByUsername: {
    max: 10, // 10 attempts
    windowMs: 900_000, // 15 minutes
    keyBy: 'username' as const,
  },
  passwordChange: {
    max: 3, // 3 attempts
    windowMs: 900_000, // 15 minutes
    keyBy: 'userId' as const,
  },
  passwordReset: {
    max: 3, // 3 attempts
    windowMs: 900_000, // 15 minutes
    keyBy: 'ip' as const,
  },
  configMutations: {
    max: 20, // 20 requests
    windowMs: 60_000, // 1 minute
    keyBy: 'userId' as const,
  },
  userMutations: {
    max: 10, // 10 requests
    windowMs: 60_000, // 1 minute
    keyBy: 'userId' as const,
  },
  sectionAccessSet: {
    max: 20, // 20 requests
    windowMs: 60_000, // 1 minute
    keyBy: 'userId' as const,
  },
  brandMutations: {
    max: 10, // 10 requests
    windowMs: 60_000, // 1 minute
    keyBy: 'userId' as const,
  },
  pendingEmail: {
    max: 10, // 10 attempts per IP
    windowMs: 900_000, // 15 minutes
    keyBy: 'ip' as const,
  },
  ldapTest: {
    max: 3, // 3 attempts
    windowMs: 900_000, // 15 minutes
    keyBy: 'userId' as const,
  },
  companyStructureMutations: {
    max: 30,
    windowMs: 60_000,
    keyBy: 'userId' as const,
  },
  navSyncTrigger: {
    max: 1,
    windowMs: 600_000, // 10 minutes — 1 sync per window, prevents connection pool exhaustion
    keyBy: 'userId' as const,
  },
  exportGeneration: {
    // Generating a PDF is the API's most expensive operation: pdfmake keeps the whole
    // document in memory, and the export also loads logos as Buffers. Without a
    // limit, a single account looping saturates the process's event loop.
    max: 10,
    windowMs: 60_000, // 1 minute
    keyBy: 'userId' as const,
  },
} as const;

/**
 * Internal sliding-window entry tracked per key.
 */
interface RateLimitEntry {
  /** Number of requests in the current window */
  count: number;
  /** Window start timestamp */
  windowStart: number;
  /** TTL in milliseconds */
  windowMs: number;
}

/**
 * In-memory rate-limit store with per-route LRU maps and TTL-based window expiry.
 */
class RateLimitStore {
  private stores = new Map<string, Map<string, RateLimitEntry>>();
  private readonly maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
    this.startCleanup();
  }

  /**
   * Checks whether a key is limited
   *
   * @param routeName - Route name
   * @param key - Key (IP or userId)
   * @param config - Rate-limit configuration
   * @returns true if limited, false otherwise
   */
  isLimited(
    routeName: string,
    key: string,
    config: { max: number; windowMs: number }
  ): boolean {
    const store = this.getOrCreateStore(routeName);
    const entry = store.get(key);
    const now = Date.now();

    if (!entry) {
      return false; // No entry = not limited
    }

    // Check whether the window has expired
    if (now > entry.windowStart + entry.windowMs) {
      // Window expired, remove entry
      store.delete(key);
      return false;
    }

    // Check whether the limit has been exceeded
    return entry.count >= config.max;
  }

  /**
   * Records a request for a key
   *
   * @param routeName - Route name
   * @param key - Key (IP or userId)
   * @param config - Rate-limit configuration
   */
  record(
    routeName: string,
    key: string,
    config: { max: number; windowMs: number }
  ): void {
    const store = this.getOrCreateStore(routeName);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry) {
      // New entry
      store.set(key, {
        count: 1,
        windowStart: now,
        windowMs: config.windowMs,
      });
    } else {
      // Check whether the window has expired
      if (now > entry.windowStart + entry.windowMs) {
        // Reset window
        entry.count = 1;
        entry.windowStart = now;
        entry.windowMs = config.windowMs;
      } else {
        // Increment counter
        entry.count++;
      }
    }

    // If the cache is full, remove the oldest entry (LRU)
    if (store.size >= this.maxSize) {
      const oldestKey = store.keys().next().value;
      if (oldestKey) {
        store.delete(oldestKey);
      }
    }
  }

  /**
   * Gets or creates the store for a route
   */
  private getOrCreateStore(routeName: string): Map<string, RateLimitEntry> {
    if (!this.stores.has(routeName)) {
      this.stores.set(routeName, new Map());
    }
    return this.stores.get(routeName)!;
  }

  /**
   * Removes expired entries from all stores
   */
  private cleanup(): void {
    const now = Date.now();
    let totalRemoved = 0;

    for (const [routeName, store] of this.stores.entries()) {
      const expiredKeys: string[] = [];

      for (const [key, entry] of store.entries()) {
        if (now > entry.windowStart + entry.windowMs) {
          expiredKeys.push(key);
        }
      }

      expiredKeys.forEach(key => store.delete(key));
      totalRemoved += expiredKeys.length;

      // If the store is empty, remove it
      if (store.size === 0) {
        this.stores.delete(routeName);
      }
    }

    if (totalRemoved > 0) {
      logger.info(
        { removedCount: totalRemoved, routes: this.stores.size },
        'Rate-limit cleanup'
      );
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
   * Completely clears all stores
   */
  clear(): void {
    this.stores.clear();
  }

  /**
   * Gets statistics for the stores
   */
  getStats(): {
    routes: number;
    totalKeys: number;
    maxSize: number;
  } {
    let totalKeys = 0;
    for (const store of this.stores.values()) {
      totalKeys += store.size;
    }

    return {
      routes: this.stores.size,
      totalKeys,
      maxSize: this.maxSize,
    };
  }
}

/**
 * Singleton rate-limit store shared by all tRPC procedures.
 */
export const rateLimitStore = new RateLimitStore();

/**
 * Derives the rate-limit bucket key from the request context.
 *
 * @param keyBy - `'ip'` for unauthenticated endpoints, `'userId'` for authenticated ones.
 * @returns The resolved key string.
 * @throws {Error} If `keyBy` is `'userId'` but the session is missing.
 */
export function extractRateLimitKey(
  ctx: { req: FastifyRequest; session?: { user: { id: string } } | null },
  keyBy: 'ip' | 'userId'
): string {
  if (keyBy === 'ip') {
    return ctx.req.ip || 'unknown';
  }

  if (!ctx.session?.user?.id) {
    throw new Error('User ID required for userId-based rate limiting');
  }
  return ctx.session.user.id;
}

/**
 * Checks a key against `rateLimitStore` and either records the hit or throws
 * `TOO_MANY_REQUESTS`. Shared by `withRateLimit()` (ctx-derived key) and by call sites that
 * already have an explicit key, e.g. `loginByUsername` in `authenticateUser()`
 * (`apps/api/src/services/auth.service.ts`) — username lives in the procedure input, not
 * `ctx`, so it can't go through `extractRateLimitKey()`.
 *
 * @throws {TRPCError} `TOO_MANY_REQUESTS` if the key has exceeded `config.max`.
 */
export function enforceRateLimit(
  routeName: string,
  key: string,
  config: { max: number; windowMs: number }
): void {
  if (rateLimitStore.isLimited(routeName, key, config)) {
    throw buildRateLimitExceededError(routeName, config);
  }
  // Record BEFORE the caller proceeds so concurrent requests see the updated count.
  rateLimitStore.record(routeName, key, config);
}

/**
 * Creates a tRPC middleware that enforces rate limiting for the specified route.
 * Policy is resolved dynamically on every request: AppConfig → ENV → static default.
 * Requests beyond the limit receive a `TOO_MANY_REQUESTS` tRPC error.
 *
 * @param routeName - Route name (must be a key of `RATE_LIMIT_CONFIG`).
 * @returns tRPC middleware.
 */
export function withRateLimit(routeName: keyof typeof RATE_LIMIT_CONFIG) {
  return t.middleware(async ({ ctx, next }) => {
    try {
      const config = await resolveRateLimitPolicy(
        routeName as keyof typeof RATE_LIMIT_CONFIG,
        ctx.prisma
      );

      if (config.keyBy === 'username') {
        // No route currently wired to withRateLimit() uses keyBy 'username' (only
        // loginByUsername, checked directly in authenticateUser()) — if it ever
        // did (e.g. a malformed AppConfig override on another route), fail
        // loudly instead of silently deriving the wrong key.
        throw new Error(
          `withRateLimit('${routeName}'): keyBy 'username' non è supportato da questo middleware — la chiave va passata esplicitamente dal chiamante`
        );
      }

      const key = extractRateLimitKey(ctx, config.keyBy);
      enforceRateLimit(routeName, key, config);
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }

      logger.error({ err: error }, `Rate limit error for ${routeName}`);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Rate limit check failed',
        cause: error,
      });
    }

    // next() runs outside the rate-limit try/catch — procedure errors propagate untouched
    return next();
  });
}

/**
 * Internal rate-limit store configuration constants.
 */
export const RATE_LIMIT_CONFIG_EXPORT = {
  maxSize: 1000,
  cleanupIntervalMs: 60 * 1000, // 1 minute
} as const;
