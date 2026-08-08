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
  /**
   * Smoke-test mutation to verify that mutations reach the server and round-trip correctly —
   * echoes the input message back, logging it server-side.
   *
   * @auth {public}
   * @input {{ message: string }}
   * @output {{ success: true, message: string }} — echoes the input message wrapped in a
   *   confirmation string.
   */
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
