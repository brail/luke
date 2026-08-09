/**
 * Returns exponential backoff delay: `baseMs * 2^attempt`, capped at `capMs`.
 * Jitter (if needed) is the caller's responsibility.
 */
export function calcBackoffDelay(attempt: number, baseMs: number, capMs = Infinity): number {
  return Math.min(baseMs * Math.pow(2, attempt), capMs);
}
