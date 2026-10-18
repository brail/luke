/**
 * Prisma client construction for one-shot CLI scripts.
 *
 * A named re-export rather than its own construction: `createPrismaClient` in
 * `@luke/db` already is the single constructor, adapter and all, and it already
 * refuses to build without a connection string. This module stays because the
 * scripts read better naming what kind of client they open, and because the
 * default it documents — `DATABASE_URL`, the script's own environment — is a
 * decision about scripts rather than about the database package.
 */

import { createPrismaClient, type PrismaClient } from '@luke/db';

/**
 * Creates a Prisma client for a CLI script.
 *
 * @param connectionString - Database URL. Default: `DATABASE_URL`.
 * @throws If the URL is not defined — better an explicit error here than a
 *   connection to an unintended database.
 */
export function createScriptPrismaClient(
  connectionString = process.env.DATABASE_URL
): PrismaClient {
  return createPrismaClient({ connectionString });
}
