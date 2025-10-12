'use client';

import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useState } from 'react';

/**
 * Client tRPC per React Query
 * Usa any per evitare problemi di tipo nel monorepo
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
export function TRPCProvider({ children }: { children: React.ReactNode }): any {
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

  const [trpcClient] = useState(() =>
    (trpc as any).createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/trpc`,
          // Headers per autenticazione e Content-Type
          headers() {
            return {
              'Content-Type': 'application/json',
              // TODO: Aggiungere token JWT quando disponibile
              // authorization: `Bearer ${token}`,
            };
          },
        }),
      ],
    })
  );

  const TrpcProvider = (trpc as any).Provider;

  return React.createElement(
    TrpcProvider,
    { client: trpcClient, queryClient },
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );
}
