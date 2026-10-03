/**
 * `TOO_MANY_REQUESTS` error shape shared between rate-limit enforcement (`ratelimit.ts`)
 * and the tRPC error formatter (`error.ts`). Kept in its own leaf module — both of those
 * files need it, and `ratelimit.ts` → `./t` → `error.ts` already forms a chain, so `error.ts`
 * importing from `ratelimit.ts` directly would be a circular dependency.
 */

import { TRPCError } from '@trpc/server';

/**
 * Structured payload attached as `cause` to every `TOO_MANY_REQUESTS` error thrown by
 * rate-limit checks. `trpcErrorFormatter` reads this to put `retryAfterSeconds` in the
 * serialized error `data`, so clients can render an upper-bound `Retry-After` (the whole
 * window) without recomputing it themselves.
 */
export interface RateLimitExceededCause {
  retryAfterSeconds: number;
}

/**
 * Type guard for `RateLimitExceededCause`, used where an error's `cause` is `unknown`
 * (e.g. in a tRPC `errorFormatter`) and needs narrowing before reading `retryAfterSeconds`.
 */
export function isRateLimitExceededCause(
  cause: unknown
): cause is RateLimitExceededCause {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as { retryAfterSeconds?: unknown }).retryAfterSeconds === 'number'
  );
}

/**
 * Builds a `TOO_MANY_REQUESTS` TRPCError with `retryAfterSeconds` attached as `cause`.
 * Called only by `enforceRateLimit()`, which logs the route and the limit before throwing.
 *
 * The message names neither the route nor the limit: a 4xx reaches every client, and the
 * budget of `auth.login` is exactly what a password sprayer would pace itself by. No number either — `retryAfterSeconds` is the whole window, not the time left.
 */
export function buildRateLimitExceededError(windowMs: number): TRPCError {
  const cause: RateLimitExceededCause = {
    retryAfterSeconds: Math.ceil(windowMs / 1000),
  };

  return new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: 'Troppe richieste. Riprova più tardi.',
    cause,
  });
}
