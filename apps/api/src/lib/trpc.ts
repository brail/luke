/**
 * Setup tRPC per Luke API
 * Definisce il context e le procedure base per i router
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { authenticateRequest, type UserSession } from './auth';
import { randomUUID } from 'crypto';
import { type Role } from '@luke/core';
import {
  withRole,
  roleIn,
  adminOnly,
  adminOrEditor,
  adminOrManager,
  authenticatedOnly,
} from './rbac';

/**
 * Context per tRPC
 * Contiene il client Prisma, la sessione utente e altre dipendenze
 */
export interface Context {
  prisma: PrismaClient;
  session: UserSession | null;
  req: FastifyRequest;
  res: FastifyReply;
  traceId: string;
}

/**
 * Crea il context per tRPC
 * @param context - Oggetto contenente le dipendenze
 * @returns Context per tRPC
 */
export async function createContext({
  prisma,
  req,
  res,
}: {
  prisma: PrismaClient;
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<Context> {
  // Autentica la richiesta e ottieni la sessione
  const session = await authenticateRequest(req, res);

  // Estrai o genera traceId
  const traceId = (req.headers['x-luke-trace-id'] as string) || randomUUID();

  return {
    prisma,
    session,
    req,
    res,
    traceId,
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
export const loggingMiddleware = t.middleware(
  async ({ next, path, type, ctx }) => {
    const start = Date.now();

    ctx.req.log.info({
      traceId: ctx.traceId,
      type,
      path,
      message: `tRPC ${type}: ${path}`,
    });

    const result = await next();

    const duration = Date.now() - start;
    ctx.req.log.info({
      traceId: ctx.traceId,
      type,
      path,
      duration,
      message: `tRPC ${type}: ${path} completed (${duration}ms)`,
    });

    return result;
  }
);

/**
 * Middleware per autenticazione
 * Verifica che l'utente sia autenticato
 */
export const authMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session, // Type-safe: session non è più null
    },
  });
});

/**
 * Middleware per autorizzazione admin
 * Verifica che l'utente sia autenticato e abbia ruolo admin
 */
export const adminMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  if (ctx.session.user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Accesso negato: richiesto ruolo admin',
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session, // Type-safe: session non è più null
    },
  });
});

/**
 * Procedure con logging automatico
 */
export const loggedProcedure = publicProcedure.use(loggingMiddleware);

/**
 * Procedure protetta (richiede autenticazione)
 */
export const protectedProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(authMiddleware);

/**
 * Procedure admin (richiede ruolo admin)
 */
export const adminProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(adminMiddleware);

/**
 * Helper per verificare se utente ha uno dei ruoli autorizzati
 */
export function ensureRoles(
  session: UserSession | null,
  allowedRoles: Role[]
): void {
  if (!session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  if (!allowedRoles.includes(session.user.role as Role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Accesso negato: richiesto uno dei ruoli ${allowedRoles.join(', ')}`,
    });
  }
}

/**
 * Middleware per autorizzazione admin + editor
 * Verifica che l'utente sia autenticato e abbia ruolo admin o editor
 */
export const adminOrEditorMiddleware = t.middleware(async ({ ctx, next }) => {
  ensureRoles(ctx.session, ['admin', 'editor']);

  return next({
    ctx: {
      ...ctx,
      session: ctx.session!, // Type-safe: session non è più null
    },
  });
});

/**
 * Procedure per admin o editor (richiede ruolo admin o editor)
 */
export const adminOrEditorProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(adminOrEditorMiddleware);

/**
 * Esporta le guardie RBAC per uso nei router
 */
export {
  withRole,
  roleIn,
  adminOnly,
  adminOrEditor,
  adminOrManager,
  authenticatedOnly,
};
