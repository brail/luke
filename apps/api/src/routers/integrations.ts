/**
 * Integrations router: configuration and connection tests for Google, mail, NAV and LDAP,
 * plus data import/export.
 */

import { router } from '../lib/trpc';

import { googleRouter } from './integrations.google.router';
import { importExportRouter } from './integrations.import.router';
import { ldapRouter } from './integrations.ldap.router';
import { mailRouter } from './integrations.mail.router';
import { navRouter } from './integrations.nav.router';

export const integrationsRouter = router({
  google: googleRouter,
  mail: mailRouter,
  nav: navRouter,
  importExport: importExportRouter,
  auth: ldapRouter,
});
