/**
 * tRPC idempotency middleware for Luke API.
 * Reuses the shared `IdempotencyStore` to deduplicate mutation requests
 * identified by a client-supplied `Idempotency-Key: <uuid-v4>` header.
 * TTL and capacity are inherited from the store defaults (5 min / 1 000 keys).
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';

import { idempotencyStore } from './idempotency';

const logger = pino({ level: 'info' });

/**
 * Returns a raw tRPC middleware function that enforces idempotency for mutations.
 * Requests without an `Idempotency-Key` header are passed through unchanged.
 * A second request with the same key and identical body returns the cached response.
 * A second request with the same key but a different body throws `CONFLICT`.
 *
 * @returns Raw tRPC middleware (use directly with `.use()` on a procedure).
 */
export function withIdempotency() {
  return async ({ ctx, next, path, type }: any) => {
    // Solo per mutation (query non hanno bisogno di idempotency)
    if (type !== 'mutation') {
      return next();
    }

    // Estrai idempotency key dall'header
    const idempotencyKey = ctx.req.headers['idempotency-key'] as string;

    // Se non c'è idempotency key, procedi normalmente
    if (!idempotencyKey) {
      return next();
    }

    // Valida formato idempotency key (UUID v4)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid Idempotency-Key format. Must be a valid UUID v4.',
      });
    }

    // Serializza input per hash (usa path + input come identificatore)
    const method = 'POST'; // tRPC usa sempre POST per mutation
    const pathStr = `/trpc/${path}`;
    const body = JSON.stringify(ctx.input || {});

    // Check se esiste già una risposta
    const result = idempotencyStore.check(
      idempotencyKey,
      method,
      pathStr,
      body
    );

    if (result.hit) {
      // Restituisci risposta cached
      return result.response;
    }

    // Se c'è conflitto (stessa key, body diverso), ritorna 409 Conflict
    if (result.conflict) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'Idempotency-Key already used with different request body. Each key must identify a single operation.',
      });
    }

    // Esegui la mutation originale
    const mutationResult = await next();

    // Memorizza la risposta solo se è un successo
    // Per tRPC, assumiamo che se non c'è eccezione = successo
    try {
      idempotencyStore.store(
        idempotencyKey,
        method,
        pathStr,
        body,
        mutationResult
      );
    } catch (error) {
      // Log errore ma non bloccare la risposta
      logger.warn({ err: error }, 'Failed to store idempotency result');
    }

    return mutationResult;
  };
}

/**
 * Returns `true` if the request carries an `Idempotency-Key` header.
 */
export function hasIdempotencyKey(ctx: { req: any }): boolean {
  return !!ctx.req.headers['idempotency-key'];
}

/**
 * Extracts the `Idempotency-Key` header value from the request.
 *
 * @returns The key string, or `null` if the header is absent.
 */
export function getIdempotencyKey(ctx: { req: any }): string | null {
  return ctx.req.headers['idempotency-key'] || null;
}

/**
 * Static configuration constants for the tRPC idempotency middleware.
 */
export const IDEMPOTENCY_TRPC_CONFIG = {
  headerName: 'idempotency-key',
  uuidRegex:
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  supportedTypes: ['mutation'] as const,
} as const;
