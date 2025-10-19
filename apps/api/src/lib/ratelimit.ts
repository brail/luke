/**
 * Rate-Limit Store per Luke API
 * Store in-memory con LRU cache per gestire rate limiting per-rotta
 *
 * Caratteristiche:
 * - LRU cache con max 1000 keys per rotta
 * - TTL: configurabile per rotta (1-15 minuti)
 * - Key extraction: IP per endpoint pubblici, userId per endpoint autenticati
 * - Cleanup automatico ogni minuto
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';

import { resolveRateLimitPolicy } from './rateLimitPolicy';

// Logger interno per rate-limit
const logger = pino({ level: 'info' });

/**
 * Configurazione rate-limit hardcoded
 * Valori conservativi per sicurezza
 */
export const RATE_LIMIT_CONFIG = {
  login: {
    max: 5, // 5 tentativi
    windowMs: 60_000, // 1 minuto
    keyBy: 'ip' as const,
  },
  passwordChange: {
    max: 3, // 3 tentativi
    windowMs: 900_000, // 15 minuti
    keyBy: 'userId' as const,
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
} as const;

/**
 * Entry nel store rate-limit
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
 * Store rate-limit in-memory con LRU e TTL
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
 * Istanza singleton del store rate-limit
 */
export const rateLimitStore = new RateLimitStore();

/**
 * Estrae la chiave per rate-limit dal context tRPC
 *
 * @param ctx - Context tRPC
 * @param keyBy - Tipo di chiave ('ip' o 'userId')
 * @returns Chiave per rate-limit
 */
export function extractRateLimitKey(
  ctx: { req: any; session?: { user: { id: string } } | null },
  keyBy: 'ip' | 'userId'
): string {
  if (keyBy === 'ip') {
    return ctx.req.ip || 'unknown';
  }

  if (keyBy === 'userId') {
    if (!ctx.session?.user?.id) {
      throw new Error('User ID required for userId-based rate limiting');
    }
    return ctx.session.user.id;
  }

  throw new Error(`Invalid keyBy: ${keyBy}`);
}

/**
 * Middleware tRPC per rate-limit
 * Factory che crea middleware per una specifica rotta
 * Usa risoluzione dinamica: AppConfig → ENV → Default
 *
 * @param routeName - Nome della rotta (deve essere in RATE_LIMIT_CONFIG)
 * @returns Middleware tRPC
 */
export function withRateLimit(routeName: keyof typeof RATE_LIMIT_CONFIG) {
  return async ({ ctx, next }: any) => {
    try {
      // Risolvi policy dinamicamente
      const config = await resolveRateLimitPolicy(
        routeName as
          | 'login'
          | 'passwordChange'
          | 'configMutations'
          | 'userMutations',
        ctx.prisma
      );

      // Estrai chiave per rate-limit
      const key = extractRateLimitKey(ctx, config.keyBy);

      // Verifica se è limitata
      if (rateLimitStore.isLimited(routeName, key, config)) {
        const windowMs = config.windowMs;
        const windowMinutes = Math.ceil(windowMs / 60_000);

        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Rate limit exceeded for ${routeName}. Max ${config.max} requests per ${windowMinutes} minute(s).`,
        });
      }

      // Esegui la procedura
      const result = await next();

      // Registra la richiesta
      rateLimitStore.record(routeName, key, config);

      return result;
    } catch (error) {
      // Se è già un TRPCError, rilancialo
      if (error instanceof TRPCError) {
        throw error;
      }

      // Per altri errori, logga e rilancia come errore generico
      console.error(`Rate limit error for ${routeName}:`, error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Rate limit check failed',
      });
    }
  };
}

/**
 * Configurazione rate-limit esportata
 */
export const RATE_LIMIT_CONFIG_EXPORT = {
  maxSize: 1000,
  cleanupIntervalMs: 60 * 1000, // 1 minuto
} as const;
