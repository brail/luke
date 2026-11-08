/**
 * The NAV connection as a user-facing read sees it: one reader for the NAV settings page and every
 * procedure that queries NAV directly, so they answer a broken configuration the same way (#213).
 */

import type { PrismaClient } from '@luke/db';
import { getNavDbConfig, NavConfigIncompleteError, type NavDbConfig } from '@luke/nav';

import { getConfig, rethrowUnreadable } from './configManager';
import { externalCheckFailed } from './error';

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
