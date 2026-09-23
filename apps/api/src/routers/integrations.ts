/**
 * Integrations Router per Luke API
 * Gestisce configurazioni e test per Storage, Mail, LDAP e Import/Export
 */

import { router } from '../lib/trpc';

import { googleRouter } from './integrations.google.router';
import { importExportRouter } from './integrations.import.router';
import { ldapRouter } from './integrations.ldap.router';
import { mailRouter } from './integrations.mail.router';
import { navRouter } from './integrations.nav.router';
import { storageRouter } from './integrations.storage.router';

export const integrationsRouter = router({
  google: googleRouter,
  storage: storageRouter,
  mail: mailRouter,
  nav: navRouter,
  importExport: importExportRouter,
  auth: ldapRouter,
});
