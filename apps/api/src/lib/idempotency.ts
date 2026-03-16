/**
 * Idempotency Store per Luke API
 * Store in-memory con LRU cache per gestire richieste idempotenti
 *
 * Caratteristiche:
 * - LRU cache con max 1000 keys
 * - TTL: 5 minuti (auto-cleanup)
 * - Hash richiesta: SHA256(method + path + body)
 * - Header: Idempotency-Key: <client-uuid>
 */

import { createHash } from 'crypto';

import pino from 'pino';

// Logger interno per idempotency
const logger = pino({ level: 'info' });

/**
 * Entry nel store idempotency
 */
interface IdempotencyEntry {
  /** Hash della richiesta originale */
  requestHash: string;
  /** Risposta cached */
  response: any;
  /** Timestamp di creazione */
  timestamp: number;
  /** TTL in millisecondi */
  ttl: number;
}

/**
 * Risultato del check idempotency
 */
interface IdempotencyResult {
  /** true se trovato un match, false altrimenti */
  hit: boolean;
  /** Risposta cached (solo se hit=true) */
  response?: any;
  /** Timestamp della richiesta originale */
  originalTimestamp?: number;
  /** true se c'è conflitto (stessa key, body diverso) */
  conflict?: boolean;
}

/**
 * Store idempotency in-memory con LRU e TTL
 */
class IdempotencyStore {
  private cache = new Map<string, IdempotencyEntry>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSize: number = 1000, defaultTtlMs: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;

    // Avvia cleanup periodico ogni minuto
    this.startCleanup();
  }

  /**
   * Genera hash per una richiesta
   *
   * @param method - HTTP method
   * @param path - Request path
   * @param body - Request body (serializzato)
   * @returns Hash SHA256 della richiesta
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
   * Verifica se esiste una richiesta idempotente
   *
   * @param key - Idempotency key dal client
   * @param method - HTTP method
   * @param path - Request path
   * @param body - Request body
   * @returns Risultato del check
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

    // Verifica TTL
    const now = Date.now();
    if (now > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return { hit: false };
    }

    // Verifica che l'hash della richiesta corrisponda
    if (entry.requestHash !== requestHash) {
      // Hash diverso = richiesta diversa con stessa key
      // Ritorna conflitto invece di rimuovere entry
      return { hit: false, conflict: true };
    }

    return {
      hit: true,
      response: entry.response,
      originalTimestamp: entry.timestamp,
    };
  }

  /**
   * Memorizza una risposta per una richiesta idempotente
   *
   * @param key - Idempotency key dal client
   * @param method - HTTP method
   * @param path - Request path
   * @param body - Request body
   * @param response - Risposta da memorizzare
   * @param ttlMs - TTL personalizzato (opzionale)
   */
  store(
    key: string,
    method: string,
    path: string,
    body: string,
    response: any,
    ttlMs?: number
  ): void {
    const requestHash = this.generateRequestHash(method, path, body);
    const now = Date.now();
    const ttl = ttlMs || this.defaultTtlMs;

    // Se la cache è piena, rimuovi l'entry più vecchia (LRU)
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
   * Rimuove entry scadute dalla cache
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
   * Pulisce completamente la cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Ottiene statistiche della cache
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
 * Istanza singleton del store idempotency
 */
export const idempotencyStore = new IdempotencyStore();
