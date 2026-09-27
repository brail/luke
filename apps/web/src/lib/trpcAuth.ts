/**
 * Lightweight tRPC client for server-side use (no React Query dependency).
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@luke/api';
import { getApiBaseUrl } from '@luke/core';

const trpcUrl = `${getApiBaseUrl()}/trpc`;

/**
 * Authenticated client factory — use when a Bearer token is available.
 *
 * @param clientIp - The user's real IP (`clientIpFrom`), forwarded as `X-Forwarded-For`: without it
 *   every call arrives from the web container's address, and an IP-keyed rate-limit bucket on the
 *   API collapses onto one key shared by all users (CLAUDE.md rule 13).
 */
export function createAuthedTrpcClient(accessToken: string, clientIp: string | undefined) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: trpcUrl,
        headers: () => ({
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
        }),
      }),
    ],
  });
}
