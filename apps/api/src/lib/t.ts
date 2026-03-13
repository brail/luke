/**
 * Esportazione isolata di `t` (tRPC instance)
 * Questo file separate evita circular dependencies quando altri moduli
 * hanno bisogno di importare `t` per creare middleware senza creare
 * una circular dependency con trpc.ts
 */

import { initTRPC } from '@trpc/server';
import { trpcErrorFormatter } from './error';
import type { Context } from './context';

// Inizializza tRPC
export const t = initTRPC.context<Context>().create({
  errorFormatter: trpcErrorFormatter as any,
});
