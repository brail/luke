/**
 * Prisma client construction for one-shot CLI scripts.
 *
 * Prisma 7 removed `datasources` and `datasourceUrl` from the constructor, and
 * a `new PrismaClient()` with no arguments can no longer be built: the only way
 * to open a connection is the driver adapter, the same one `src/server.ts` uses.
 * The scripts were left on the old signature and failed on startup.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

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
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL non definito: impossibile connettersi al database.'
    );
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
