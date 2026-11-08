/**
 * NAV as a user-facing read sees it: one configuration reader and one query-failure answer for the
 * NAV settings page and every procedure that queries NAV directly, so they answer a broken
 * configuration or an unanswered query the same way (#193, #213).
 */

import type { PrismaClient } from '@luke/db';
import { getNavDbConfig, NavConfigIncompleteError, type NavDbConfig } from '@luke/nav';

import { getConfig, rethrowUnreadable } from './configManager';
import { externalCheckFailed } from './error';

import type { TRPCError } from '@trpc/server';
import type { FastifyBaseLogger } from 'fastify';

/**
 * The saved connection, or the answer an admin can act on: PRECONDITION_FAILED for an incomplete
 * configuration or an invalid stored port, a request to enter again a value that does not decrypt.
 */
export function readNavConfig(prisma: PrismaClient): Promise<NavDbConfig> {
  return getNavDbConfig(prisma, getConfig).catch((error: unknown) => {
    if (error instanceof NavConfigIncompleteError) {
      throw externalCheckFailed(
        error.invalidPort
          ? 'La porta NAV salvata non è valida: inseriscila di nuovo e salva.'
          : 'Configurazione NAV incompleta. Salva tutti i campi (host, porta, database, utente, password, company).'
      );
    }
    return rethrowUnreadable(error);
  });
}

/** Logs a NAV query a user-facing read could not complete; `read` names which one. */
export function logNavQueryFailure(logger: FastifyBaseLogger, err: unknown, read: string): void {
  logger.warn({ err, read }, 'NAV query failed');
}

/**
 * What a user-facing NAV read answers when SQL Server does not answer it:
 * `externalCheckFailed`, with the driver's error in the log only.
 */
export function navQueryFailed(logger: FastifyBaseLogger, err: unknown, read: string): TRPCError {
  logNavQueryFailure(logger, err, read);
  return externalCheckFailed('Query NAV non riuscita: verifica connessione e company');
}
