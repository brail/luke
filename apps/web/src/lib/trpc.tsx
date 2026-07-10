'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchStreamLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useSession } from 'next-auth/react';
import React, { useState } from 'react';

import type { AppRouter } from '@luke/api';

// Usa crypto.randomUUID() del browser invece di Node.js crypto
// Import type-only dall'API per type-safety end-to-end tRPC
// Nota: safe in monorepo; se separassimo i repo, considerare @luke/core/server

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
 * Wraps children with the tRPC and React Query providers.
 * Creates a `QueryClient` with project-wide defaults (1 min stale time, no
 * window-focus refetch, no mutation retry) and attaches a `Bearer` JWT header
 * from the NextAuth session on every tRPC request.
 */
export const TRPCProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: session } = useSession();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minuto
            retry: 1,
            refetchOnWindowFocus: false, // Evita refetch automatici non necessari
          },
          mutations: {
            retry: false, // No retry automatico per evitare duplicazioni
          },
        },
      })
  );

  const trpcClient = React.useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchStreamLink({
            // Relative path — Next.js rewrites proxy /trpc/* → http://api:3001/trpc/*
            // This works whether the browser hits port 80 (via NPM) or port 3000 directly.
            url: '/trpc',
            // Headers per autenticazione, Content-Type e trace correlation
            headers() {
              const headers: Record<string, string> = {
                'x-luke-trace-id': crypto.randomUUID(),
              };

              // Aggiungi token JWT se disponibile
              if (session?.accessToken) {
                headers.authorization = `Bearer ${session.accessToken}`;
              }

              return headers;
            },
          }),
        ],
      }),
    [session?.accessToken]
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
};
