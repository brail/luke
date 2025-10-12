/**
 * Setup tRPC per Luke API
 * Definisce il context e le procedure base per i router
 */

import { initTRPC } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';

/**
 * Context per tRPC
 * Contiene il client Prisma e altre dipendenze
 */
export interface Context {
  prisma: PrismaClient;
}

/**
 * Crea il context per tRPC
 * @param context - Oggetto contenente le dipendenze
 * @returns Context per tRPC
 */
export function createContext({ prisma }: Context): Context {
  return {
    prisma,
  };
}

/**
 * Inizializza tRPC con il context
 */
const t = initTRPC.context<Context>().create();

/**
 * Router base per tRPC
 */
export const router = t.router;

/**
 * Procedure pubblica (senza autenticazione)
 * Per ora tutte le procedure sono pubbliche
 * In futuro si aggiungerà middleware per autenticazione
 */
export const publicProcedure = t.procedure;

/**
 * Middleware per logging delle procedure
 * Logga le chiamate tRPC per debugging
 */
export const loggingMiddleware = t.middleware(async ({ next, path, type }) => {
  const start = Date.now();

  console.log(`🔍 tRPC ${type}: ${path}`);

  const result = await next();

  const duration = Date.now() - start;
  console.log(`✅ tRPC ${type}: ${path} (${duration}ms)`);

  return result;
});

/**
 * Procedure con logging automatico
 */
export const loggedProcedure = publicProcedure.use(loggingMiddleware);
