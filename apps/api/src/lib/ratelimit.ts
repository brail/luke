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

// Logger interno per rate-limit
const logger = pino({ level: 'info' });

/**
 * Static fallback rate-limit configuration used when AppConfig / env overrides are absent.
 * Values are conservative security defaults.
 */
export const RATE_LIMIT_CONFIG = {
  login: {
    max: 5, // 5 tentativi
    windowMs: 60_000, // 1 minuto
    keyBy: 'ip' as const,
  },
  // Bucket separato, chiave username (non IP): ferma il password-spray distribuito su
  // più IP contro un singolo account, che il bucket 'login' (keyBy: 'ip') non copre.
  // Applicato direttamente in authenticateUser() con lo username normalizzato come
  // chiave esplicita — non passa da withRateLimit()/extractRateLimitKey (che non
  // deriva 'username' da ctx, essendo login un endpoint pubblico non autenticato).
  loginByUsername: {
    max: 10, // 10 tentativi
    windowMs: 900_000, // 15 minuti
    keyBy: 'username' as const,
  },
  passwordChange: {
    max: 3, // 3 tentativi
    windowMs: 900_000, // 15 minuti
    keyBy: 'userId' as const,
  },
  passwordReset: {
    max: 3, // 3 tentativi
    windowMs: 900_000, // 15 minuti
    keyBy: 'ip' as const,
  },
  configMutations: {
    max: 20, // 20 richieste
    windowMs: 60_000, // 1 minuto
    keyBy: 'userId' as const,
  },
  userMutations: {
    max: 10, // 10 richieste
    windowMs: 60_000, // 1 minuto
    keyBy: 'userId' as const,
  },
  sectionAccessSet: {
    max: 20, // 20 richieste
    windowMs: 60_000, // 1 minuto
    keyBy: 'userId' as const,
  },
  brandMutations: {
    max: 10, // 10 richieste
    windowMs: 60_000, // 1 minuto
    keyBy: 'userId' as const,
  },
  pendingEmail: {
    max: 10, // 10 tentativi per IP
    windowMs: 900_000, // 15 minuti
    keyBy: 'ip' as const,
  },
  ldapTest: {
    max: 3, // 3 tentativi
    windowMs: 900_000, // 15 minuti
    keyBy: 'userId' as const,
  },
  companyStructureMutations: {
    max: 30,
    windowMs: 60_000,
    keyBy: 'userId' as const,
  },
  navSyncTrigger: {
    max: 1,
    windowMs: 600_000, // 10 minuti — 1 sync per finestra, previene connection pool exhaustion
    keyBy: 'userId' as const,
  },
  exportGeneration: {
    // Generare un PDF è l'operazione più costosa dell'API: pdfmake tiene l'intero
    // documento in memoria e l'export carica anche i logo come Buffer. Senza
    // limite, un singolo account in loop satura l'event loop del processo.
    max: 10,
    windowMs: 60_000, // 1 minuto
    keyBy: 'userId' as const,
  },
} as const;

/**
 * Internal sliding-window entry tracked per key.
 */
interface RateLimitEntry {
  /** Numero di richieste nel window corrente */
  count: number;
  /** Timestamp di inizio window */
  windowStart: number;
  /** TTL in millisecondi */
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
   * Verifica se una chiave è limitata
   *
   * @param routeName - Nome della rotta
   * @param key - Chiave (IP o userId)
   * @param config - Configurazione rate-limit
   * @returns true se limitata, false altrimenti
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
      return false; // Nessuna entry = non limitata
    }

    // Verifica se il window è scaduto
    if (now > entry.windowStart + entry.windowMs) {
      // Window scaduto, rimuovi entry
      store.delete(key);
      return false;
    }

    // Verifica se ha superato il limite
    return entry.count >= config.max;
  }

  /**
   * Registra una richiesta per una chiave
   *
   * @param routeName - Nome della rotta
   * @param key - Chiave (IP o userId)
   * @param config - Configurazione rate-limit
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
      // Nuova entry
      store.set(key, {
        count: 1,
        windowStart: now,
        windowMs: config.windowMs,
      });
    } else {
      // Verifica se il window è scaduto
      if (now > entry.windowStart + entry.windowMs) {
        // Reset window
        entry.count = 1;
        entry.windowStart = now;
        entry.windowMs = config.windowMs;
      } else {
        // Incrementa contatore
        entry.count++;
      }
    }

    // Se la cache è piena, rimuovi l'entry più vecchia (LRU)
    if (store.size >= this.maxSize) {
      const oldestKey = store.keys().next().value;
      if (oldestKey) {
        store.delete(oldestKey);
      }
    }
  }

  /**
   * Ottiene o crea lo store per una rotta
   */
  private getOrCreateStore(routeName: string): Map<string, RateLimitEntry> {
    if (!this.stores.has(routeName)) {
      this.stores.set(routeName, new Map());
    }
    return this.stores.get(routeName)!;
  }

  /**
   * Rimuove entry scadute da tutti gli store
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

      // Se lo store è vuoto, rimuovilo
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
   * Avvia il cleanup periodico
   */
  private startCleanup(): void {
    // Cleanup ogni minuto
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Ferma il cleanup periodico
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Pulisce completamente tutti gli store
   */
  clear(): void {
    this.stores.clear();
  }

  /**
   * Ottiene statistiche degli store
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
        // Nessuna rotta wired su withRateLimit() usa oggi keyBy 'username' (solo
        // loginByUsername, controllato direttamente in authenticateUser()) — se mai
        // capitasse (es. AppConfig override malformato su un'altra rotta), fallisce
        // rumorosamente invece di derivare silenziosamente una chiave sbagliata.
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
  cleanupIntervalMs: 60 * 1000, // 1 minuto
} as const;
