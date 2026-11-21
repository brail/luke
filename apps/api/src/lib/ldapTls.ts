/**
 * LDAP over TLS for every ldapts client (#281): the options each one is built with, and the check of
 * the certificates an admin trusts besides the public CAs.
 */

import { X509Certificate } from 'node:crypto';
import { getCACertificates } from 'node:tls';

import { TRPCError } from '@trpc/server';

import { PEM_CERTIFICATE_BLOCK, TRUSTED_CERTIFICATES_MESSAGE } from '@luke/core';

import type { LdapConfig } from './configManager';
import type { ClientOptions } from 'ldapts';


/** Each certificate of a stored value, parsed; throws on a block that is not a certificate. */
export function parseTrustedCertificates(pem: string): X509Certificate[] {
  return (pem.match(new RegExp(PEM_CERTIFICATE_BLOCK.source, 'g')) ?? []).map(block => new X509Certificate(block));
}

/**
 * Refuses, as `BAD_REQUEST` with the fixed text, a value whose blocks are not all certificates. The
 * registry's shape check cannot parse X.509, and Node's TLS layer accepts a garbled one silently:
 * it would trust nothing, and the connection test would only say the server is not trusted.
 */
export function assertTrustedCertificates(pem: string): void {
  try {
    if (parseTrustedCertificates(pem).length === 0) throw new Error('no certificate');
  } catch (cause) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: TRUSTED_CERTIFICATES_MESSAGE, cause });
  }
}

/** Whether ldapts opens TLS for `url`: it reads the scheme as `new URL()` does, spaces trimmed. */
function isLdaps(url: string): boolean {
  try {
    return new URL(url).protocol === 'ldaps:';
  } catch {
    // ldapts refuses the URL too: no connection is made.
    return false;
  }
}

/**
 * The options of an ldapts `Client`. On `ldaps://` the server's certificate is always verified,
 * against the public CAs plus the trusted certificates when there are any, and the host name in the
 * URL must match it (Node's default identity check); nothing turns either off. On `ldap://` no TLS
 * options at all: ldapts would start TLS for any of them, and a certificate there is ignored.
 */
export function ldapClientOptions(
  config: Pick<LdapConfig, 'url' | 'trustedCertificates'>,
  timeouts: { timeout: number; connectTimeout?: number }
): ClientOptions {
  const options: ClientOptions = { url: config.url, ...timeouts };
  if (!isLdaps(config.url)) return options;
  return {
    ...options,
    tlsOptions: {
      // Explicit: left out, Node takes it from NODE_TLS_REJECT_UNAUTHORIZED.
      rejectUnauthorized: true,
      // `ca` replaces the default store, so the public CAs are listed again.
      ...(config.trustedCertificates && { ca: [...getCACertificates('default'), config.trustedCertificates] }),
    },
  };
}

/** What the settings page shows of a trusted certificate. */
export interface TrustedCertificateDetails {
  subject: string;
  /** ISO 8601 instant. */
  validTo: string;
  /** Past `validTo` now: the connection test will refuse it. */
  expired: boolean;
  selfSigned: boolean;
}

/**
 * The trusted certificates as the settings page lists them, or `null` when the stored value does not
 * parse (written before the check, or by hand): the caller logs it and shows none.
 */
export function trustedCertificateDetails(pem: string): TrustedCertificateDetails[] | null {
  try {
    return parseTrustedCertificates(pem).map(certificate => ({
      subject: certificate.subject.replaceAll('\n', ', '),
      validTo: certificate.validToDate.toISOString(),
      expired: certificate.validToDate.getTime() < Date.now(),
      selfSigned: certificate.subject === certificate.issuer && certificate.verify(certificate.publicKey),
    }));
  } catch {
    return null;
  }
}
