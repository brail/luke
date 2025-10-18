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
      // Rimuovi entry esistente per evitare conflitti
      this.cache.delete(key);
      return { hit: false };
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

/**
 * Middleware per gestire richieste idempotenti
 *
 * @param req - Fastify request
 * @param res - Fastify reply
 * @param next - Next function
 */
export async function idempotencyMiddleware(
  req: any,
  res: any,
  next: () => Promise<void>
): Promise<void> {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  // Se non c'è idempotency key, procedi normalmente
  if (!idempotencyKey) {
    return next();
  }

  // Valida formato idempotency key (UUID v4)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(idempotencyKey)) {
    res.status(400).send({
      error: 'Invalid Idempotency-Key format. Must be a valid UUID v4.',
    });
    return;
  }

  const method = req.method;
  const path = req.url;
  const body = JSON.stringify(req.body || {});

  // Check se esiste già una risposta
  const result = idempotencyStore.check(idempotencyKey, method, path, body);

  if (result.hit) {
    // Restituisci risposta cached
    res.status(200).send(result.response);
    return;
  }

  // Procedi con la richiesta originale
  const originalSend = res.send.bind(res);
  res.send = function (data: any) {
    // Memorizza la risposta solo se è un successo (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyStore.store(idempotencyKey, method, path, body, data);
    }

    // Restituisci la risposta originale
    return originalSend(data);
  };

  return next();
}

/**
 * Helper per verificare se una richiesta ha idempotency key
 *
 * @param req - Fastify request
 * @returns true se ha idempotency key, false altrimenti
 */
export function hasIdempotencyKey(req: any): boolean {
  return !!req.headers['idempotency-key'];
}

/**
 * Helper per estrarre l'idempotency key da una richiesta
 *
 * @param req - Fastify request
 * @returns Idempotency key o null
 */
export function getIdempotencyKey(req: any): string | null {
  return req.headers['idempotency-key'] || null;
}

/**
 * Configurazione idempotency esportata
 */
export const IDEMPOTENCY_CONFIG = {
  maxSize: 1000,
  defaultTtlMs: 5 * 60 * 1000, // 5 minuti
  cleanupIntervalMs: 60 * 1000, // 1 minuto
  headerName: 'idempotency-key',
} as const;
