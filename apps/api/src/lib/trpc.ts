/**
 * Setup tRPC per Luke API
 * Definisce il context e le procedure base per i router
 */

import { randomUUID } from 'crypto';

import { initTRPC, TRPCError } from '@trpc/server';
import { trpcErrorFormatter } from './error';

import { type Role } from '@luke/core';

import { authenticateRequest, type UserSession } from './auth';
import { getTokenVersionCacheTTL } from './configManager';
import {
  withRole,
  roleIn,
  adminOnly,
  adminOrEditor,
  adminOrManager,
  authenticatedOnly,
} from './rbac';

import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Cache in-memory per tokenVersion con TTL
 * Evita query DB ad ogni richiesta per verificare tokenVersion
 */
const tokenVersionCache = new Map<
  string,
  { version: number; timestamp: number }
>();

// Cache per TTL dinamico da AppConfig
let cachedTTLValue: number | null = null;
let cachedTTLTimestamp: number = 0;
const TTL_REFRESH_INTERVAL = 5 * 60 * 1000; // Refresh config ogni 5min

/**
 * Invalida la cache tokenVersion per un utente specifico
 * Chiamata dopo revoca sessioni o cambio password
 */
export function invalidateTokenVersionCache(userId: string): void {
  tokenVersionCache.delete(userId);
}

/**
 * Ottiene il TTL della cache da AppConfig con refresh periodico
 * @param prisma - Client Prisma
 * @returns TTL in millisecondi
 */
async function getCacheTTL(prisma: PrismaClient): Promise<number> {
  const now = Date.now();

  if (
    cachedTTLValue === null ||
    now - cachedTTLTimestamp > TTL_REFRESH_INTERVAL
  ) {
    cachedTTLValue = await getTokenVersionCacheTTL(prisma);
    cachedTTLTimestamp = now;
  }

  return cachedTTLValue;
}

/**
 * Verifica tokenVersion con cache
 * @param userId - ID utente
 * @param tokenVersion - Versione dal JWT
 * @param prisma - Client Prisma
 * @returns true se valido, false se invalidato
 */
async function verifyTokenVersion(
  userId: string,
  tokenVersion: number | undefined,
  prisma: PrismaClient
): Promise<boolean> {
  // OPZIONE 1b: Rifiuta JWT senza tokenVersion
  if (tokenVersion === undefined || tokenVersion === null) {
    return false;
  }

  const cached = tokenVersionCache.get(userId);
  const now = Date.now();
  const cacheTTL = await getCacheTTL(prisma);

  if (cached && now - cached.timestamp < cacheTTL) {
    return cached.version === tokenVersion;
  }

  // Query DB per tokenVersion corrente
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return false;
  }

  // Aggiorna cache
  tokenVersionCache.set(userId, {
    version: user.tokenVersion,
    timestamp: now,
  });

  return user.tokenVersion === tokenVersion;
}

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
  logger: any; // Logger Pino da req.log
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
    logger: req.log,
  };
}

/**
 * Inizializza tRPC con il context
 */
const t = initTRPC.context<Context>().create({
  errorFormatter: trpcErrorFormatter as any,
});

/**
 * Esporta t per uso in middleware personalizzati
 */
export { t };

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
 * Verifica che l'utente sia autenticato e che il tokenVersion sia valido
 */
export const authMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  // Verifica tokenVersion con cache
  const isTokenVersionValid = await verifyTokenVersion(
    ctx.session.user.id,
    ctx.session.user.tokenVersion,
    ctx.prisma
  );

  if (!isTokenVersionValid) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Sessione scaduta, effettua nuovamente il login',
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
