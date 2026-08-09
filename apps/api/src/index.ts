/**
 * Public type exports for the Luke API.
 *
 * Re-exports `AppRouter` and the inferred `RouterOutputs` / `RouterInputs` types
 * consumed by the Next.js frontend for end-to-end tRPC type safety.
 */

import type { AppRouter } from './routers';
import type { inferRouterOutputs, inferRouterInputs } from '@trpc/server';

export type { AppRouter };
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
