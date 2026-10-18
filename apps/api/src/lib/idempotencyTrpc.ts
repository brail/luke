/**
 * tRPC idempotency middleware for Luke API.
 * Reuses the shared `IdempotencyStore` to deduplicate mutation requests
 * identified by a client-supplied `Idempotency-Key: <uuid-v4>` header.
 * TTL and capacity are inherited from the store defaults (5 min / 1 000 keys).
 */

import { TRPCError } from '@trpc/server';

import { idempotencyStore } from './idempotency';

/**
 * Returns a raw tRPC middleware function that enforces idempotency for mutations.
 * Requests without an `Idempotency-Key` header are passed through unchanged.
 *
 * The key is reserved before the mutation runs: a second request with that key while the first is
 * still running is refused (`CONFLICT`), never run twice. After a successful first request, the same
 * key with an identical input returns the stored response, and with a different input throws
 * `CONFLICT`. A failure stores nothing, so a retry with that key runs again.
 *
 * Keys belong to the caller: `scope: 'caller'` (the default) files them under the session user id,
 * stable across a refreshed session, so a key is never shared between users — neither replayed to
 * another nor blocking one. A public procedure declares `scope: 'anonymous'`, which ignores any
 * session the request may carry (context authentication runs for public procedures too).
 *
 * @returns Raw tRPC middleware (use directly with `.use()` on a procedure).
 */
export function withIdempotency({ scope = 'caller' }: { scope?: 'caller' | 'anonymous' } = {}) {
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

    let owner: string;
    if (scope === 'anonymous') {
      owner = 'anonymous';
    } else if (ctx.session?.user?.id) {
      owner = `user:${ctx.session.user.id}`;
    } else {
      // A procedure that requires no session must declare `scope: 'anonymous'`; reaching this is
      // a wiring error, not a client one, and falling back to a shared scope would let users
      // collide on keys.
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `withIdempotency() on ${path} has no session to scope the key to`,
      });
    }
    const key = `${owner}:${idempotencyKey}`;

    // `input` comes from the middleware, not from `ctx`: `ctx.input` doesn't exist on
    // the tRPC context and was always undefined, so the body hash was
    // constantly "{}" — two requests with the same key but different payloads
    // ended up identical, and the second one replayed the response of the
    // first instead of the expected CONFLICT. Requires that `.use(withIdempotency())`
    // be chained AFTER `.input(...)`, otherwise the input isn't parsed yet.
    const begun = idempotencyStore.begin(key, 'POST', `/trpc/${path}`, JSON.stringify(input ?? {}));

    switch (begun.kind) {
      case 'hit':
        return begun.response;
      case 'conflict':
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'Idempotency-Key already used with different request body. Each key must identify a single operation.',
        });
      case 'inFlight':
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A request with this Idempotency-Key is still in progress. Retry once it has finished.',
        });
      case 'full':
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many idempotent requests in progress. Retry shortly.',
        });
    }

    try {
      const mutationResult = await next();

      // A procedure error reaches a middleware as a resolved `{ ok: false }`, not as a throw, so
      // `ok` is the only success signal. Caching a failure would replay it to every retry with the
      // same key for the whole TTL, even once its cause is gone.
      if (mutationResult.ok) {
        try {
          idempotencyStore.complete(key, begun.token, mutationResult);
        } catch (error) {
          // Log the error but don't block the response
          ctx.logger.warn({ err: error }, 'Failed to store idempotency result');
        }
      }
      return mutationResult;
    } finally {
      // Always: after a completion it finds nothing of its own to drop, and it covers a `next()`
      // that throws, an `ok: false` and a failed `complete`.
      idempotencyStore.release(key, begun.token);
    }
  };
}
