/**
 * Client tRPC per autenticazione
 * Versione semplificata senza React Query per uso in auth.ts
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';

/**
 * Helper per ottenere l'URL base dell'API
 */
function getBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

/**
 * Client tRPC per autenticazione
 * Usa any per evitare problemi di tipo nel monorepo
 */
export const trpcAuth = createTRPCClient<any>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/trpc`,
      headers() {
        return {
          'Content-Type': 'application/json',
        };
      },
    }),
  ],
});
