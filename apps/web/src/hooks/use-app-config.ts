'use client';

import { trpc } from '../lib/trpc';

/**
 * Probes backend connectivity via the public `appInfo` tRPC endpoint.
 * Re-fetches at most every 5 minutes; does not refetch on window focus.
 *
 * @returns `{ isLoading, hasError }` — `hasError` is true when the probe fails.
 */
export function useAppConfig() {
  const { isLoading, error } = trpc.public.appInfo.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1000,
  });

  return {
    isLoading,
    hasError: !!error,
  };
}
