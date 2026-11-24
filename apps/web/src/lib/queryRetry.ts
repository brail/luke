import { onlineManager } from '@tanstack/react-query';
import { isTRPCClientError } from '@trpc/client';

import type { AppRouter } from '@luke/api';
import { calcBackoffDelay } from '@luke/core';

import type { QueryClient } from '@tanstack/react-query';

/** Retries of a query that failed on the network or with a 5xx. */
const MAX_TRANSIENT_RETRIES = 2;
/** The longest random wait before refetching after the network comes back. */
const RECONNECT_SPREAD_MS = 5_000;
/** The longest server wait a query retries after; the global limiter's window is one minute. */
const MAX_RETRY_AFTER_SECONDS = 60;
/** The random spread added to that wait, so the queries refused together do not return together. */
const RETRY_AFTER_SPREAD_MS = 1_000;

/** The HTTP status and server-requested wait of a failed tRPC call; nothing for any other error. */
function failure(error: unknown): { httpStatus?: number; retryAfterSeconds?: number } {
  return isTRPCClientError<AppRouter>(error) ? (error.data ?? {}) : {};
}

/**
 * Whether a failed query is tried again (ADR-051's client side). A 4xx is the answer, not an
 * accident: never retried, except a 429, retried once and only when the server said how long to
 * wait, up to a minute — a longer wait shows the error instead of a loader. A network failure (no
 * status) or a 5xx is retried up to twice.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const { httpStatus, retryAfterSeconds } = failure(error);
  if (httpStatus === 429) {
    return failureCount < 1 && retryAfterSeconds !== undefined && retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS;
  }
  if (httpStatus !== undefined && httpStatus < 500) return false;
  return failureCount < MAX_TRANSIENT_RETRIES;
}

/**
 * How long before that retry: the server's wait for a 429 plus up to `RETRY_AFTER_SPREAD_MS`,
 * otherwise exponential with full jitter.
 */
export function queryRetryDelay(attempt: number, error: unknown): number {
  const { httpStatus, retryAfterSeconds } = failure(error);
  if (httpStatus === 429 && retryAfterSeconds !== undefined) {
    return retryAfterSeconds * 1000 + Math.random() * RETRY_AFTER_SPREAD_MS;
  }
  return Math.random() * calcBackoffDelay(attempt, 1000, 30_000);
}

/**
 * Refetches the client's active, stale queries once when the network comes back, after a random
 * wait of up to `RECONNECT_SPREAD_MS`, so the tabs of one user do not all call at the same instant;
 * a new disconnection cancels the wait. Replaces React Query's `refetchOnReconnect`, which must be
 * off. A query that was in flight when the network dropped still resumes at once: React Query does
 * that on its own. Returns the unsubscribe.
 */
export function refetchOnReconnectWithJitter(queryClient: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = onlineManager.subscribe(online => {
    clearTimeout(timer);
    if (!online) return;
    timer = setTimeout(
      // `cancelRefetch: false`, as React Query's own reconnect: a query already fetching, or waiting
      // for its retry after a 429, keeps that fetch instead of being sent again at once.
      () => void queryClient.refetchQueries({ type: 'active', stale: true }, { cancelRefetch: false }),
      Math.random() * RECONNECT_SPREAD_MS
    );
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
