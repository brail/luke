/**
 * Lightweight tRPC client for use inside `auth.ts` (no React Query dependency).
 * Calls the API directly via `httpBatchLink` using the internal base URL.
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';

import { getApiBaseUrl } from '@luke/core';

/**
 * Vanilla tRPC client (no React hooks) used during NextAuth credential resolution.
 * Typed as `any` to avoid a circular dependency between the web and api packages
 * when their routers are not yet exported through a shared package.
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
