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
 * serialized error `data`, so clients can render an accurate `Retry-After` without
 * recomputing the window themselves.
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
 * Shared by `withRateLimit()` and by call sites that check `rateLimitStore` directly with
 * an explicit key instead of going through the middleware (e.g. `loginByUsername`).
 */
export function buildRateLimitExceededError(
  routeName: string,
  config: { max: number; windowMs: number }
): TRPCError {
  const windowMinutes = Math.ceil(config.windowMs / 60_000);
  const cause: RateLimitExceededCause = {
    retryAfterSeconds: Math.ceil(config.windowMs / 1000),
  };

  return new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: `Rate limit exceeded for ${routeName}. Max ${config.max} requests per ${windowMinutes} minute(s).`,
    cause,
  });
}
