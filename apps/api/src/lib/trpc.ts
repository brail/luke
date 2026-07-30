/**
 * tRPC setup for Luke API.
 * Defines the request context factory, base procedures, and shared middleware.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';


import { hasPermission, type Role } from '@luke/core';

import { authenticateRequest } from './auth';
import { assertNotBlockedByMaintenance } from './maintenanceMode';
import { t } from './t';
import { verifyTokenVersion } from './tokenVersionCache';

import type { Context } from './context';
import type { PrismaClient } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';

export { invalidateTokenVersionCache } from './tokenVersionCache';

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
  const session = await authenticateRequest(req, res, prisma);

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

  // Ridondante per le richieste HTTP reali — `authenticateRequest` rifiuta già i
  // token revocati — ma non per i context costruiti a mano (test, job interni),
  // che non passano da lì. Il controllo resta perché l'invariante deve valere per
  // ogni context, non solo per quelli nati da una richiesta.
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
 * Middleware that blocks non-admin traffic while Maintenance Mode is `ACTIVE`.
 * Must be chained after `authMiddleware` (already done in `protectedProcedure`) so
 * `ctx.session` is guaranteed. Admins are never blocked — they need `adminProcedure`
 * (e.g. `maintenance.mode.end`) to keep working during the very maintenance they're managing.
 */
export const maintenanceGuard = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  await assertNotBlockedByMaintenance(ctx.prisma, ctx.session.user.role);

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
  .use(authMiddleware)
  .use(maintenanceGuard);

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
