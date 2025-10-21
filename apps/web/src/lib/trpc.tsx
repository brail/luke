'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import { useSession } from 'next-auth/react';
import React, { useState } from 'react';

import type { AppRouter } from '@luke/api';

import { useUnauthorizedHandler } from '../hooks/use-unauthorized-handler';
// Usa crypto.randomUUID() del browser invece di Node.js crypto
// Import type-only dall'API per type-safety end-to-end tRPC
// Nota: safe in monorepo; se separassimo i repo, considerare @luke/core/server

/**
 * Client tRPC per React Query
 * Tipizzato con AppRouter reale per inferenza end-to-end
 * TODO futuro: Migrare a import da @luke/core se web/api si separano in repository diversi
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Helper per ottenere l'URL base dell'API
 * Sempre porta 3001 per l'API tRPC
 */
export function getBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

/**
 * Provider tRPC con configurazione React Query
 */
export const TRPCProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: session } = useSession();

  // Gestione globale degli errori UNAUTHORIZED
  useUnauthorizedHandler();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minuto
            retry: 1,
            refetchOnWindowFocus: false, // Evita refetch automatici non necessari
          },
          mutations: {
            retry: false, // No retry automatico per evitare duplicazioni
          },
        },
      })
  );

  const trpcClient = React.useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchLink({
            url: `${getBaseUrl()}/trpc`,
            // Headers per autenticazione, Content-Type e trace correlation
            headers() {
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-luke-trace-id':
                  crypto.randomUUID?.() ||
                  Math.random().toString(36).substring(2) +
                    Date.now().toString(36), // Nuovo per ogni batch request
              };

              // Aggiungi token JWT se disponibile
              if (session?.accessToken) {
                headers.authorization = `Bearer ${session.accessToken}`;
              }

              return headers;
            },
          }),
        ],
      }),
    [session?.accessToken]
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
};
