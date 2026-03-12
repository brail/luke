/**
 * Esportazioni pubbliche dell'API Luke
 * Utilizzate dal front-end per type-safety
 */

import type { inferRouterOutputs, inferRouterInputs } from '@trpc/server';
import type { AppRouter } from './routers';

export type { AppRouter };
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
