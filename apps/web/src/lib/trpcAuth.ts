/**
 * Lightweight tRPC client for server-side use (no React Query dependency).
 */

import 'server-only';

import { createTRPCClient, httpBatchLink } from '@trpc/client';

import type { AppRouter } from '@luke/api';
import { TRPC_MAX_BATCH_SIZE, getApiBaseUrl } from '@luke/core';

import { forwardedFor } from './clientIp';

const trpcUrl = `${getApiBaseUrl()}/trpc`;

/**
 * Authenticated client factory — use when a Bearer token is available.
 *
 * @param incomingHeaders - The headers of the request being served; the user's real IP in them is
 *   forwarded as `X-Forwarded-For`: without it every call arrives from the web container's address,
 *   and an IP-keyed rate-limit bucket on the API collapses onto one key shared by all users
 *   (CLAUDE.md rule 13).
 */
export function createAuthedTrpcClient(
  accessToken: string,
  incomingHeaders: { get(name: string): string | null }
) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: trpcUrl,
        maxItems: TRPC_MAX_BATCH_SIZE,
        headers: () => ({
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...forwardedFor(incomingHeaders),
        }),
      }),
    ],
  });
}
