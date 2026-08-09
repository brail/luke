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
  // Not t.middleware(...)-wrapped: this middleware short-circuits by returning
  // a cached response instead of always going through next(), which is incompatible
  // with the stricter MiddlewareResult type that t.middleware requires — verified
  // empirically: with a precise type instead of `any`, `.use()` rejects the
  // function on every router that uses it (same error everywhere).
  return async ({ ctx, next, path, type, input }: any) => {
    // Only for mutations (queries don't need idempotency)
    if (type !== 'mutation') {
      return next();
    }

    // Extract idempotency key from the header
    const idempotencyKey = ctx.req.headers['idempotency-key'] as string;

    // If there's no idempotency key, proceed normally
    if (!idempotencyKey) {
      return next();
    }

    // Validate the idempotency key format (UUID v4)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid Idempotency-Key format. Must be a valid UUID v4.',
      });
    }

    // Serialize input for the hash (uses path + input as the identifier)
    const method = 'POST'; // tRPC always uses POST for mutations
    const pathStr = `/trpc/${path}`;
    // `input` comes from the middleware, not from `ctx`: `ctx.input` doesn't exist on
    // the tRPC context and was always undefined, so the body hash was
    // constantly "{}" — two requests with the same key but different payloads
    // ended up identical, and the second one replayed the response of the
    // first instead of the expected CONFLICT. Requires that `.use(withIdempotency())`
    // be chained AFTER `.input(...)`, otherwise the input isn't parsed yet.
    const body = JSON.stringify(input ?? {});

    // Check whether a response already exists
    const result = idempotencyStore.check(
      idempotencyKey,
      method,
      pathStr,
      body
    );

    if (result.hit) {
      // Return the cached response
      return result.response;
    }

    // If there's a conflict (same key, different body), return 409 Conflict
    if (result.conflict) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'Idempotency-Key already used with different request body. Each key must identify a single operation.',
      });
    }

    // Execute the original mutation
    const mutationResult = await next();

    // Store the response only if it succeeded
    // For tRPC, we assume that no exception = success
    try {
      idempotencyStore.store(
        idempotencyKey,
        method,
        pathStr,
        body,
        mutationResult
      );
    } catch (error) {
      // Log the error but don't block the response
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
