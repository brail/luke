/**
 * Lightweight tRPC client for server-side use (no React Query dependency).
 */

import 'server-only';

import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';

import type { AppRouter } from '@luke/api';
import { TRPC_MAX_BATCH_SIZE, getApiBaseUrl, sendsUnbatched } from '@luke/core';

import { forwardedFor } from './clientIp';
import { trpcFetch } from './trpcFetch';

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
      // Essential and background calls go alone: the API's limiter counts a batch that mixes them
      // with other calls in the normal lane (ADR-051). Each link carries its headers inline (rule 13).
      // No `Content-Type`: tRPC sets it on a POST, and a second one would be joined to it (415).
      splitLink({
        condition: op => sendsUnbatched(op.path),
        true: httpLink({
          url: trpcUrl,
          fetch: trpcFetch,
          headers: () => ({ Authorization: `Bearer ${accessToken}`, ...forwardedFor(incomingHeaders) }),
        }),
        false: httpBatchLink({
          url: trpcUrl,
          maxItems: TRPC_MAX_BATCH_SIZE,
          fetch: trpcFetch,
          headers: () => ({ Authorization: `Bearer ${accessToken}`, ...forwardedFor(incomingHeaders) }),
        }),
      }),
    ],
  });
}
