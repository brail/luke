'use client';

import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
/**
 * Client tRPC per React Query
 * TODO: Tipizzare con AppRouter reale quando risolto conflitto con metodi built-in
 * Attualmente usa any per evitare conflitti con metodi built-in tRPC
 */
export const trpc = createTRPCReact<any>();

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

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minuto
            retry: 1,
          },
        },
      })
  );

  const trpcClient = React.useMemo(
    () =>
      (trpc as any).createClient({
        links: [
          httpBatchLink({
            url: `${getBaseUrl()}/trpc`,
            // Headers per autenticazione e Content-Type
            headers() {
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
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

  const TrpcProvider = (trpc as any).Provider;

  return React.createElement(
    TrpcProvider,
    { client: trpcClient, queryClient },
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );
};
