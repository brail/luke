/**
 * Definizione del Context per tRPC
 * Separato in file dedicato per evitare circular dependencies
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';

import type { UserSession } from './auth';

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
  logger: FastifyBaseLogger; // req.log (FastifyBaseLogger, superset di pino.BaseLogger)
  _permissionsCache?: Map<string, boolean>; // Cache per-request delle permissions
}
