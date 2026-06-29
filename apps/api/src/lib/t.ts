/**
 * Isolated export of the tRPC instance `t`.
 * Keeping this in a dedicated file breaks the circular dependency that would
 * arise if middleware modules imported `t` directly from `trpc.ts`.
 */

import { initTRPC } from '@trpc/server';
import { trpcErrorFormatter } from './error';
import type { Context } from './context';

/**
 * Initialised tRPC instance bound to the Luke API request context.
 * Import this — not from `trpc.ts` — when creating standalone middleware.
 */
export const t = initTRPC.context<Context>().create({
  errorFormatter: trpcErrorFormatter as any,
});
