'use client';

import { trpc } from '../lib/trpc';

/**
 * Probe di connettività verso il backend.
 * La versione dell'app è disponibile a build time via NEXT_PUBLIC_APP_VERSION.
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
