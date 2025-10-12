'use client';

import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '@luke/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Client tRPC per React Query
 * Importa il tipo AppRouter dall'API Luke
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
export function TRPCProvider({ children }: { children: React.ReactNode }) {
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
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/trpc`,
          // Headers per autenticazione (se necessario)
          headers() {
            return {
              // TODO: Aggiungere token JWT quando disponibile
              // authorization: `Bearer ${token}`,
            };
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
