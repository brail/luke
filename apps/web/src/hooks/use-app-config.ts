'use client';

import { trpc } from '../lib/trpc';

/**
 * Probes backend connectivity via the public `appInfo` tRPC endpoint.
 * Polls every 30 seconds so the indicator follows the backend coming back up (or going
 * down) without a page reload; does not poll while the tab is in background, and does not
 * refetch on window focus.
 *
 * @returns `{ isLoading, hasError }` — `hasError` is true when the probe fails.
 */
export function useAppConfig() {
  const { isLoading, error } = trpc.public.appInfo.useQuery(undefined, {
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1000,
  });

  return {
    isLoading,
    hasError: !!error,
  };
}
