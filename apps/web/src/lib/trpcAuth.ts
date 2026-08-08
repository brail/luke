/**
 * Lightweight tRPC clients for server-side use (no React Query dependency).
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@luke/api';
import { getApiBaseUrl } from '@luke/core';

const trpcUrl = `${getApiBaseUrl()}/trpc`;

/** Unauthenticated client — used during NextAuth credential resolution. */
export const trpcAuth = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: trpcUrl,
      headers: () => ({ 'Content-Type': 'application/json' }),
    }),
  ],
});

/** Authenticated client factory — use when a Bearer token is available. */
export function createAuthedTrpcClient(accessToken: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: trpcUrl,
        headers: () => ({
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }),
      }),
    ],
  });
}
