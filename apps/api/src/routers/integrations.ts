/**
 * Integrations Router per Luke API
 * Gestisce configurazioni e test per Storage, Mail, LDAP e Import/Export
 */

import { z } from 'zod';

import { router, publicProcedure } from '../lib/trpc';

import { googleRouter } from './integrations.google.router';
import { importExportRouter } from './integrations.import.router';
import { ldapRouter } from './integrations.ldap.router';
import { mailRouter } from './integrations.mail.router';
import { navRouter } from './integrations.nav.router';
import { storageRouter } from './integrations.storage.router';

export const integrationsRouter = router({
  // Endpoint di test per verificare che le mutation funzionino
  test: publicProcedure
    .input(z.object({ message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      ctx.logger.info({ input }, 'Test mutation received');
      return {
        success: true,
        message: `Test mutation received: ${input.message}`,
      };
    }),

  google: googleRouter,
  storage: storageRouter,
  mail: mailRouter,
  nav: navRouter,
  importExport: importExportRouter,
  auth: ldapRouter,
});
