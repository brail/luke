/**
 * tRPC context type definition.
 * Isolated in its own file to prevent circular dependency cycles.
 */

import type { UserSession } from './auth';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';


/**
 * Request-scoped context injected into every tRPC procedure.
 */
export interface Context {
  prisma: PrismaClient;
  session: UserSession | null;
  req: FastifyRequest;
  res: FastifyReply;
  traceId: string;
  /** Fastify request logger (FastifyBaseLogger, superset of pino.BaseLogger). */
  logger: FastifyBaseLogger;
  /** Per-request permission check cache — populated lazily by requirePermission(). */
  _permissionsCache?: Map<string, boolean>;
}
