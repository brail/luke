/**
 * The options every ldapts client is built with (#281), the check of the trusted certificates, and
 * the kinds of TLS failure a settings test words. Over `ldaps://` the server is always verified —
 * explicitly, so `NODE_TLS_REJECT_UNAUTHORIZED` cannot turn it off — against the public CAs plus the
 * trusted certificates; over `ldap://` no TLS option at all.
 */

import { getCACertificates } from 'node:tls';

import { describe, expect, it } from 'vitest';

import {
  assertTrustedCertificates,
  ldapClientOptions,
  parseTrustedCertificates,
  trustedCertificateDetails,
} from '../src/lib/ldapTls';
import { tlsFailureKind } from '../src/lib/tlsErrors';

import { selfSignedCertificate } from './helpers/ldapsServer';

const { certificate } = selfSignedCertificate();
const TIMEOUTS = { timeout: 1000, connectTimeout: 500 };
/** The shape of a certificate block, its body not DER. */
const NOT_A_CERTIFICATE = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';

describe('ldapClientOptions', () => {
  it('over ldaps:// with no trusted certificate verifies against the public CAs, explicitly', () => {
    expect(ldapClientOptions({ url: 'ldaps://dc.test:636', trustedCertificates: '' }, TIMEOUTS)).toEqual({
      url: 'ldaps://dc.test:636',
      ...TIMEOUTS,
      tlsOptions: { rejectUnauthorized: true },
    });
  });

  it('over ldaps:// trusts the certificates in addition to the public CAs', () => {
    const { tlsOptions } = ldapClientOptions({ url: 'LDAPS://dc.test', trustedCertificates: certificate }, TIMEOUTS);

    expect(tlsOptions).toEqual({ rejectUnauthorized: true, ca: [...getCACertificates('default'), certificate] });
  });

  it('sets nothing that weakens the check', () => {
    const { tlsOptions } = ldapClientOptions({ url: 'ldaps://dc.test', trustedCertificates: certificate }, TIMEOUTS);

    expect(Object.keys(tlsOptions ?? {}).sort()).toEqual(['ca', 'rejectUnauthorized']);
  });

  it('reads the scheme as ldapts does, so a URL it trims is still verified', () => {
    expect(ldapClientOptions({ url: ' ldaps://dc.test', trustedCertificates: '' }, TIMEOUTS).tlsOptions).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('over ldap:// passes no TLS option, a stored certificate included', () => {
    expect(ldapClientOptions({ url: 'ldap://dc.test:389', trustedCertificates: certificate }, TIMEOUTS)).toEqual({
      url: 'ldap://dc.test:389',
      ...TIMEOUTS,
    });
  });
});

describe('the trusted certificates', () => {
  it('accepts one certificate, or several in one value', () => {
    expect(() => assertTrustedCertificates(certificate)).not.toThrow();
    expect(parseTrustedCertificates(`${certificate}\n${certificate}`)).toHaveLength(2);
  });

  it.each([
    ['a block that is not a certificate', NOT_A_CERTIFICATE],
    ['a certificate followed by one that is not', `${certificate}${NOT_A_CERTIFICATE}`],
    ['no block at all', 'not a certificate'],
  ])('refuses %s with the fixed text', (_case, value) => {
    expect(() => assertTrustedCertificates(value)).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('Certificati non validi') })
    );
  });

  it('lists subject, expiry and whether each is self-signed, and none for a value that does not parse', () => {
    expect(trustedCertificateDetails(certificate)).toEqual([
      { subject: 'CN=localhost', validTo: expect.any(String), expired: false, selfSigned: true },
    ]);
    expect(trustedCertificateDetails(NOT_A_CERTIFICATE)).toBeNull();
  });
});

describe('tlsFailureKind', () => {
  it.each([
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'untrusted'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'untrusted'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'untrusted'],
    ['UNABLE_TO_GET_ISSUER_CERT', 'untrusted'],
    ['INVALID_CA', 'untrusted'],
    ['CERT_REJECTED', 'untrusted'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'hostname'],
    ['HOSTNAME_MISMATCH', 'hostname'],
    ['CERT_HAS_EXPIRED', 'validity'],
    ['CERT_NOT_YET_VALID', 'validity'],
    ['CERT_SIGNATURE_FAILURE', 'other'],
    ['INVALID_PURPOSE', 'other'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'other'],
    ['EPROTO', 'other'],
    ['ECONNREFUSED', null],
    ['toString', null],
    [undefined, null],
  ])('%s is %s', (code, kind) => {
    expect(tlsFailureKind(code)).toBe(kind);
  });
});
