/**
 * tRPC idempotency middleware for Luke API.
 * Reuses the shared `IdempotencyStore` to deduplicate mutation requests
 * identified by a client-supplied `Idempotency-Key: <uuid-v4>` header.
 * TTL and capacity are inherited from the store defaults (5 min / 1 000 keys).
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';

import { idempotencyStore } from './idempotency';

import type { FastifyRequest } from 'fastify';

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
  // Non t.middleware(...)-wrapped: questo middleware short-circuita ritornando
  // una risposta cached invece di passare sempre da next(), incompatibile con
  // il tipo MiddlewareResult più stretto che t.middleware richiede — provato
  // empiricamente: con un tipo preciso invece di `any`, `.use()` rifiuta la
  // funzione su tutti i router che la usano (stesso errore ovunque).
  return async ({ ctx, next, path, type, input }: any) => {
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
    // `input` arriva dal middleware, non da `ctx`: `ctx.input` non esiste sul
    // context tRPC e valeva sempre undefined, quindi il body hash era
    // costantemente "{}" — due richieste con la stessa key ma payload diversi
    // risultavano identiche e la seconda riceveva in replay la risposta della
    // prima invece del CONFLICT previsto. Richiede che `.use(withIdempotency())`
    // sia concatenato DOPO `.input(...)`, altrimenti l'input non è ancora parsato.
    const body = JSON.stringify(input ?? {});

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
export function hasIdempotencyKey(ctx: { req: FastifyRequest }): boolean {
  return !!ctx.req.headers['idempotency-key'];
}

/**
 * Extracts the `Idempotency-Key` header value from the request.
 *
 * @returns The key string, or `null` if the header is absent.
 */
export function getIdempotencyKey(ctx: { req: FastifyRequest }): string | null {
  const header = ctx.req.headers['idempotency-key'];
  return (Array.isArray(header) ? header[0] : header) || null;
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
