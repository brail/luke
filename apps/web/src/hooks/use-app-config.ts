'use client';

import { trpc } from '../lib/trpc';

/**
 * Hook per recuperare le configurazioni dell'app dal backend
 * Segue il pattern architetturale corretto: frontend → API → database
 */
export function useAppConfig() {
  const {
    data: appName,
    isLoading: nameLoading,
    error: nameError,
  } = (trpc as any).config.get.useQuery(
    { key: 'app.name' },
    {
      staleTime: 5 * 60 * 1000, // 5 minuti
      refetchOnWindowFocus: false,
      retry: 1, // Solo 1 retry per evitare attese lunghe
      retryDelay: 1000, // 1 secondo di attesa
    }
  );

  const {
    data: appVersion,
    isLoading: versionLoading,
    error: versionError,
  } = (trpc as any).config.get.useQuery(
    { key: 'app.version' },
    {
      staleTime: 5 * 60 * 1000, // 5 minuti
      refetchOnWindowFocus: false,
      retry: 1, // Solo 1 retry per evitare attese lunghe
      retryDelay: 1000, // 1 secondo di attesa
    }
  );

  // Se c'è un errore o i dati non sono disponibili, usa i fallback
  const hasError = nameError || versionError;
  const isLoading = (nameLoading || versionLoading) && !hasError;

  return {
    name: appName?.value || '',
    version: appVersion?.value || '',
    isLoading,
    hasError,
    error: hasError ? 'Impossibile caricare le configurazioni' : null,
  };
}
