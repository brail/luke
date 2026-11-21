import { Client as LdapClient } from 'ldapts';
import * as ldapts from 'ldapts';

import { ldapClientOptions } from '../lib/ldapTls';

const config = { url: 'ldaps://dc.test', trustedCertificates: '' };

// ruleid: luke-ldap-client-options
export const aliased = new LdapClient({ url: config.url });

// ruleid: luke-ldap-client-options
export const namespaced = new ldapts.Client({ url: config.url });

// ok: luke-ldap-client-options
export const aliasedThroughTheHelper = new LdapClient(ldapClientOptions(config, { timeout: 1000 }));
