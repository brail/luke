/**
 * Idempotency tRPC Middleware per Luke API
 * Wrapper tRPC che riusa l'IdempotencyStore esistente
 *
 * Caratteristiche:
 * - Riusa IdempotencyStore esistente (DRY)
 * - Header: Idempotency-Key (UUID v4)
 * - Serializzazione input tRPC per hash
 * - TTL: 5 minuti (ereditato da IdempotencyStore)
 */

import { TRPCError } from '@trpc/server';
import { idempotencyStore } from './idempotency';

/**
 * Middleware tRPC per idempotency
 * Riusa l'IdempotencyStore esistente per gestire richieste duplicate
 *
 * @returns Middleware tRPC
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
      console.warn('Failed to store idempotency result:', error);
    }

    return mutationResult;
  };
}

/**
 * Helper per verificare se una richiesta ha idempotency key
 *
 * @param ctx - Context tRPC
 * @returns true se ha idempotency key, false altrimenti
 */
export function hasIdempotencyKey(ctx: { req: any }): boolean {
  return !!ctx.req.headers['idempotency-key'];
}

/**
 * Helper per estrarre l'idempotency key da una richiesta
 *
 * @param ctx - Context tRPC
 * @returns Idempotency key o null
 */
export function getIdempotencyKey(ctx: { req: any }): string | null {
  return ctx.req.headers['idempotency-key'] || null;
}

/**
 * Configurazione idempotency tRPC esportata
 */
export const IDEMPOTENCY_TRPC_CONFIG = {
  headerName: 'idempotency-key',
  uuidRegex:
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  supportedTypes: ['mutation'] as const,
} as const;
