/**
 * What kind of TLS failure a Node error `code` is, for the settings tests that tell an admin why a
 * connection failed (S3, LDAP). The certificate codes are Node's X.509 error codes (tls docs,
 * "X509 certificate error codes"), each in one kind; anything else TLS-shaped is `other`.
 */

/** Why a TLS connection refused the server, as a settings test words it. */
export type TlsFailureKind = 'untrusted' | 'hostname' | 'validity' | 'other';

const X509_CODE_KINDS: Readonly<Record<string, TlsFailureKind>> = {
  UNABLE_TO_GET_ISSUER_CERT: 'untrusted',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'untrusted',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'untrusted',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'untrusted',
  SELF_SIGNED_CERT_IN_CHAIN: 'untrusted',
  CERT_UNTRUSTED: 'untrusted',
  CERT_REJECTED: 'untrusted',
  INVALID_CA: 'untrusted',
  HOSTNAME_MISMATCH: 'hostname',
  ERR_TLS_CERT_ALTNAME_INVALID: 'hostname',
  CERT_NOT_YET_VALID: 'validity',
  CERT_HAS_EXPIRED: 'validity',
  ERROR_IN_CERT_NOT_BEFORE_FIELD: 'validity',
  ERROR_IN_CERT_NOT_AFTER_FIELD: 'validity',
  UNABLE_TO_GET_CRL: 'other',
  UNABLE_TO_DECRYPT_CERT_SIGNATURE: 'other',
  UNABLE_TO_DECRYPT_CRL_SIGNATURE: 'other',
  UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY: 'other',
  CERT_SIGNATURE_FAILURE: 'other',
  CRL_SIGNATURE_FAILURE: 'other',
  CRL_NOT_YET_VALID: 'other',
  CRL_HAS_EXPIRED: 'other',
  ERROR_IN_CRL_LAST_UPDATE_FIELD: 'other',
  ERROR_IN_CRL_NEXT_UPDATE_FIELD: 'other',
  OUT_OF_MEM: 'other',
  CERT_CHAIN_TOO_LONG: 'other',
  CERT_REVOKED: 'other',
  PATH_LENGTH_EXCEEDED: 'other',
  INVALID_PURPOSE: 'other',
};

/**
 * The kind of TLS failure `code` names, or `null` when it is not one. `EPROTO` and `ERR_SSL_*` are
 * TLS spoken to a plain port or the reverse.
 */
export function tlsFailureKind(code: unknown): TlsFailureKind | null {
  if (typeof code !== 'string') return null;
  if (Object.hasOwn(X509_CODE_KINDS, code)) return X509_CODE_KINDS[code] ?? null;
  return code === 'EPROTO' || code.startsWith('ERR_SSL_') || code.startsWith('ERR_TLS_') ? 'other' : null;
}
