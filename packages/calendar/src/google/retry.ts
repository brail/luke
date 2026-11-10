import { calcBackoffDelay } from '@luke/core';

/** Reasons Google gives a 403 that is a rate limit, not a refusal. */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/**
 * HTTP status of a Google API error: gaxios puts it in `code`. A network error carries a string
 * code instead (`ECONNRESET`), so the answer is `undefined` for it.
 */
export function googleErrorStatus(err: unknown): number | undefined {
  // Narrowed from `unknown`: only the `code` field is read, and its type is checked below.
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

/**
 * Google has nothing at that id — not found (404) or already deleted (410): a delete of a calendar
 * or an ACL rule is done. A calendar the caller can no longer reach answers 404 too and cannot be
 * told apart here; events, whose calendar can be checked, use `isEventGone`.
 */
export function isGoneError(err: unknown): boolean {
  const status = googleErrorStatus(err);
  return status === 404 || status === 410;
}

function isRetryable(err: unknown): boolean {
  const status = googleErrorStatus(err);
  if (status === undefined || status === 429 || status >= 500) return true;
  if (status !== 403) return false;
  // The body Google sends with an error (AIP-193): only the reasons are read.
  const errors = (err as { response?: { data?: { error?: { errors?: { reason?: unknown }[] } } } })
    .response?.data?.error?.errors ?? [];
  return errors.some(e => typeof e.reason === 'string' && RATE_LIMIT_REASONS.has(e.reason));
}

/**
 * Runs a Google API call up to `maxAttempts` times with exponential back-off (500 ms, 1 s, ...).
 * Retries network errors, 5xx, 429 and a 403 whose reason is a rate limit; any other 4xx is a
 * refusal that a retry cannot change, so it is thrown at once.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (!isRetryable(err)) throw err;
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, calcBackoffDelay(attempt, 500)));
      }
    }
  }
  throw lastErr;
}
