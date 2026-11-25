'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchStreamLink, httpLink, splitLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useSession } from 'next-auth/react';
import React, { useEffect, useState } from 'react';

import type { AppRouter } from '@luke/api';
import { TRPC_MAX_BATCH_SIZE, sendsUnbatched } from '@luke/core';

import { queryRetryDelay, refetchOnReconnectWithJitter, shouldRetryQuery } from './queryRetry';
import { endSession, isSessionEnded } from './sessionEnd';
import { trpcFetch } from './trpcFetch';

/**
 * Typed tRPC client bound to `AppRouter` for end-to-end type inference.
 *
 * Future: migrate to an import from `@luke/core` if `web` and `api` are split
 * into separate repositories.
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Narrows a deeply-nested tRPC `RouterOutputs` value to a shallower, hand-written local type — the
 * workaround for TS2589 ("Type instantiation is excessively deep"), which some queries with several
 * levels of nested `include` hit when consumed directly inside a `useMemo`/component. The cast is
 * the actual fix here (there's no deeper one short of flattening the query shape), so keep this as
 * the single documented place it happens rather than repeating `as unknown as T` ad hoc.
 *
 * Only fits when `T` is a shallow interface you wrote by hand (e.g. picking a few fields) — if `T`
 * itself is (or embeds) the full deep `RouterOutputs` shape, instantiating this generic with it is
 * itself expensive enough to retrigger TS2589; use a plain `(value as any) as T` expression at the
 * call site instead in that case (see `collection-layout/page.tsx`'s `layout` for an example).
 */
export function narrowRouterOutput<T>(value: unknown): T {
  return value as T;
}

/**
 * The browser's `QueryClient`, with project-wide defaults: 1 min stale time, no window-focus refetch,
 * retries that follow the server's answer, no React Query reconnect refetch (`TRPCProvider` runs
 * `refetchOnReconnectWithJitter` instead), no mutation retry. Any query or mutation answering
 * `sessionEnded` signs the browser out (ADR-052).
 */
export function createQueryClient(): QueryClient {
  const onError = (error: unknown) => {
    if (isSessionEnded(error)) endSession();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        retry: shouldRetryQuery,
        retryDelay: queryRetryDelay,
        refetchOnWindowFocus: false, // Avoid unnecessary automatic refetches
        refetchOnReconnect: false, // `refetchOnReconnectWithJitter` instead
      },
      mutations: {
        retry: false, // No automatic retry, to avoid duplicate writes
      },
    },
  });
}

/**
 * Wraps children with the tRPC and React Query providers: a `createQueryClient` client, its jittered
 * reconnect refetch, and a `Bearer` JWT header from the NextAuth session on every tRPC request.
 */
export const TRPCProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: session } = useSession();
  const accessToken = session?.accessToken;

  const [queryClient] = useState(createQueryClient);

  useEffect(() => refetchOnReconnectWithJitter(queryClient), [queryClient]);

  const trpcClient = React.useMemo(() => {
    // Headers for authentication and trace correlation, on every request.
    const headers = () => {
      // crypto.randomUUID() requires a secure context (HTTPS or localhost) — falls back
      // to a non-crypto random id over plain HTTP (e.g. an internal http:// hostname).
      const values: Record<string, string> = {
        'x-luke-trace-id':
          crypto.randomUUID?.() ||
          Math.random().toString(36).substring(2) + Date.now().toString(36),
      };
      if (accessToken) values.authorization = `Bearer ${accessToken}`;
      return values;
    };
    // Relative path — Next.js rewrites proxy /trpc/* → http://api:3001/trpc/*
    // This works whether the browser hits port 80 (via NPM) or port 3000 directly.
    const url = '/trpc';
    return trpc.createClient({
      links: [
        // Essential and background calls (profile, refresh, sign-out, heartbeat, SSE ticket) go
        // alone: the API's limiter counts a batch that mixes them with other calls in the normal
        // lane, so the profile would share the page's budget (ADR-051).
        splitLink({
          condition: op => sendsUnbatched(op.path),
          true: httpLink({ url, fetch: trpcFetch, headers }),
          false: httpBatchStreamLink({ url, maxItems: TRPC_MAX_BATCH_SIZE, fetch: trpcFetch, headers }),
        }),
      ],
    });
  },
    [accessToken]
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
};
