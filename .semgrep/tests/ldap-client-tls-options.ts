import { Client } from 'ldapts';

import { ldapClientOptions } from '../lib/ldapTls';

const config = { url: 'ldaps://dc.test', trustedCertificates: '' };

// ruleid: luke-ldap-client-options
export const byHand = new Client({ url: config.url, timeout: 1000 });

// ok: luke-ldap-client-options
export const throughTheHelper = new Client(ldapClientOptions(config, { timeout: 1000 }));

// ruleid: luke-tls-verification-off
export const insecure = { host: 'dc.test', rejectUnauthorized: false };

// ok: luke-tls-verification-off
export const verified = { host: 'dc.test', rejectUnauthorized: true };

export function disableEverywhere(): void {
  // ruleid: luke-tls-verification-off
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
