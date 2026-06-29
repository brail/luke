/**
 * tRPC setup for Luke API.
 * Defines the request context factory, base procedures, and shared middleware.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { hasPermission, type Role } from '@luke/core';

import { authenticateRequest } from './auth';
import { getTokenVersionCacheTTL } from './configManager';
import { t } from './t';
import type { Context } from './context';

import type { PrismaClient } from '@prisma/client';

/**
 * In-memory tokenVersion cache with TTL.
 * Avoids a DB round-trip on every request to verify that the token has not been revoked.
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
 * Removes the cached tokenVersion for a specific user.
 * Call this after revoking sessions or changing a user's password.
 */
export function invalidateTokenVersionCache(userId: string): void {
  tokenVersionCache.delete(userId);
}

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
 * Creates a tRPC context for an incoming Fastify request.
 * Authenticates the request, assigns a traceId, and injects dependencies.
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
 * Base tRPC router factory. Use this to create all domain routers.
 */
export const router = t.router;

export { t };

/**
 * Base procedure with no authentication requirement.
 * Use for endpoints that must be accessible without a session (e.g. login, health checks).
 */
export const publicProcedure = t.procedure;

/**
 * Middleware that logs the start and completion of every tRPC call with duration.
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
 * Middleware that enforces authentication and tokenVersion validity.
 * Rejects requests with an `UNAUTHORIZED` error if the session is absent or the token has been revoked.
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
 * Middleware that restricts access to users with the `admin` role.
 * Must be chained after `authMiddleware` (already done in `adminProcedure`).
 */
export const adminMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  if (!hasPermission(ctx.session.user as { role: Role }, 'maintenance:update')) {
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
 * Public procedure with automatic request logging.
 */
export const loggedProcedure = publicProcedure.use(loggingMiddleware);

/**
 * Procedure that requires a valid authenticated session.
 */
export const protectedProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(authMiddleware);

/**
 * Procedure that requires admin role.
 * Chains `authMiddleware` so tokenVersion is verified before the role check.
 */
export const adminProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(authMiddleware)
  .use(adminMiddleware);

/** Re-exported for backward compatibility. */
export type { Context };
