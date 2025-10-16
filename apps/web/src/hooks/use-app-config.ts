'use client';

import { trpc } from '../lib/trpc';

/**
 * Hook per recuperare le informazioni pubbliche dell'app
 * Usa endpoint pubblico che non richiede autenticazione
 */
export function useAppConfig() {
  const {
    data: appInfo,
    isLoading,
    error,
  } = trpc.public.appInfo.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // 5 minuti
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1000,
  });

  return {
    name: appInfo?.name || 'Luke',
    version: appInfo?.version || '1.0.0',
    environment: appInfo?.environment || 'development',
    isLoading,
    hasError: !!error,
    error: error ? "Impossibile caricare le informazioni dell'app" : null,
  };
}
