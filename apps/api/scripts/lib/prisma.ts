/**
 * Costruzione del client Prisma per gli script CLI one-shot.
 *
 * Prisma 7 ha rimosso `datasources` e `datasourceUrl` dal costruttore, e un
 * `new PrismaClient()` senza argomenti non è più costruibile: l'unico modo di
 * aprire una connessione è il driver adapter, lo stesso che usa `src/server.ts`.
 * Gli script erano rimasti alla firma vecchia e fallivano all'avvio.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Crea un client Prisma per uno script CLI.
 *
 * @param connectionString - URL del database. Default: `DATABASE_URL`.
 * @throws Se l'URL non è definito — meglio un errore esplicito qui che una
 *   connessione a un database non voluto.
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
