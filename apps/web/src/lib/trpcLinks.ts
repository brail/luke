'use client';

// Browser only: the server-side client (`trpcAuth`) forwards the client IP
// itself (CLAUDE.md rule 13); these links run in the user's browser, which sends its own.

import { httpBatchStreamLink, httpLink, splitLink, type TRPCLink } from '@trpc/client';

import type { AppRouter } from '@luke/api';
import { TRPC_MAX_BATCH_SIZE, sendsUnbatched } from '@luke/core';

import { idempotencyKeyOf } from './idempotencyKey';
import { trpcFetch } from './trpcFetch';
import { uuidV4 } from './uuid';

/**
 * The browser client's links, with a `Bearer` header from `accessToken` and a trace id on every
 * request. Essential and background calls (profile, refresh, sign-out, heartbeat, SSE ticket) go
 * alone: the API's limiter counts a batch that mixes them with other calls in the normal lane, so
 * the profile would share the page's budget (ADR-051). So does a call carrying an action's
 * idempotency key (`useIdempotentAction`, #248): one HTTP header cannot carry one key per batched
 * call.
 */
export function browserLinks(accessToken: string | undefined): TRPCLink<AppRouter>[] {
  const headers = () => {
    const values: Record<string, string> = { 'x-luke-trace-id': uuidV4() };
    if (accessToken) values.authorization = `Bearer ${accessToken}`;
    return values;
  };
  // Relative path — Next.js rewrites proxy /trpc/* → http://api:3001/trpc/*
  // This works whether the browser hits port 80 (via NPM) or port 3000 directly.
  const url = '/trpc';
  return [
    splitLink({
      condition: op => sendsUnbatched(op.path) || idempotencyKeyOf(op.input) !== undefined,
      true: httpLink({
        url,
        fetch: trpcFetch,
        headers: ({ op }) => {
          const key = idempotencyKeyOf(op.input);
          return key ? { ...headers(), 'idempotency-key': key } : headers();
        },
      }),
      false: httpBatchStreamLink({ url, maxItems: TRPC_MAX_BATCH_SIZE, fetch: trpcFetch, headers }),
    }),
  ];
}
