/**
 * Client tRPC per autenticazione
 * Versione semplificata senza React Query per uso in auth.ts
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';

import { getApiBaseUrl } from '@luke/core';

/**
 * Client tRPC per autenticazione
 * Usa any per evitare problemi di tipo nel monorepo
 */
export const trpcAuth = createTRPCClient<any>({
  links: [
    httpBatchLink({
      url: `${getApiBaseUrl()}/trpc`,
      headers() {
        return {
          'Content-Type': 'application/json',
        };
      },
    }),
  ],
});
