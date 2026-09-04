/**
 * The one place a `PrismaClient` is constructed.
 *
 * Prisma 7 removed `datasources` and `datasourceUrl` from the constructor: the
 * only way to point a client at a database is the driver adapter, and a client
 * built without one does not reach the database the caller thinks it does. That
 * had already cost this repository months of test helpers silently running on
 * SQLite, which is why `.semgrep/rules/prisma-client-instantiation.yml` refuses
 * a bare `new PrismaClient(...)` everywhere except this file.
 *
 * `DATABASE_URL` is infrastructural bootstrap under the Env Policy in
 * CLAUDE.md — the one class of value that cannot come from AppConfig, since
 * AppConfig is in the database this string opens. Absent, this throws rather
 * than connecting somewhere unintended.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient, type Prisma } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  /** Database URL. Defaults to `DATABASE_URL`. */
  connectionString?: string;
  /** Prisma log levels, as accepted by the client constructor. */
  log?: Prisma.PrismaClientOptions['log'];
}

/**
 * Creates a Prisma client bound to a Postgres connection through the pg driver
 * adapter.
 *
 * @throws If no connection string is given and `DATABASE_URL` is unset.
 */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL non definito: impossibile connettersi al database.'
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: options.log,
  });
}
