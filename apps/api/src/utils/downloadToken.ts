/**
 * Download/Export Token HMAC
 *
 * Stateless system for generating and verifying temporary download/export tokens —
 * for files from storage (bucket/key) or data generated on-the-fly (e.g. audit log CSV).
 *
 * Security:
 * - HMAC-SHA256 with a key derived via HKDF
 * - Short TTL (5 minutes)
 * - Stateless (no Redis/DB)
 * - Minimal payload (exp [, extra])
 */

import { createHmac, timingSafeEqual } from 'crypto';

import type { AuditLogFilters, BackupExportHeader, StorageBucket } from '@luke/core';
import { deriveSecret } from '@luke/core/server';


/**
 * Token TTL (5 minutes)
 */
const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * HMAC key derived via HKDF
 * Info: "luke:download-token"
 */
const HMAC_KEY = deriveSecret('luke:download-token');

/** Field common to every payload signed by this module: expiry. The rest of the payload (bucket/key, filters, ...) is specific to each token variant and passed via `requiredKeys` to `verifyTokenPayload`. */
interface BaseTokenPayload {
  exp: number;
}

/**
 * Signs a payload with HMAC-SHA256
 *
 * @param payload - Payload to sign (JSON minified)
 * @returns HMAC signature in base64url
 */
function signPayload(payload: string): string {
  const hmac = createHmac('sha256', HMAC_KEY);
  hmac.update(payload);
  const signature = hmac.digest();

  // Base64url encoding
  return signature
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Verifies an HMAC signature in a timing-safe way
 *
 * Compares raw 32-byte HMAC digests directly so the comparison has constant
 * length regardless of the provided signature string, eliminating the timing
 * side-channel that would otherwise leak whether the signature is well-formed.
 */
function verifySignature(payload: string, signature: string): boolean {
  // Re-compute expected signature as raw bytes
  const expectedBuffer = (() => {
    const h = createHmac('sha256', HMAC_KEY);
    h.update(payload);
    return h.digest(); // Always 32 bytes for HMAC-SHA256
  })();

  // Decode provided signature from base64url to raw bytes
  let actualBuffer: Buffer;
  try {
    const base64 = (signature || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    );
    actualBuffer = Buffer.from(padded, 'base64');
  } catch {
    return false;
  }

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Signs a payload (exp + variant-specific fields) in the
 * `base64url(payload).base64url(signature)` format, shared by all token variants
 * (plain download, export with an attached header, audit log CSV export, ...).
 */
function signTokenPayload<T extends BaseTokenPayload>(payload: T): string {
  const payloadStr = JSON.stringify(payload);

  const payloadB64 = Buffer.from(payloadStr, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const signature = signPayload(payloadStr);

  return `${payloadB64}.${signature}`;
}

/**
 * Verifies and decodes a token signed by `signTokenPayload`.
 *
 * @param token - Token to verify
 * @param requiredKeys - Fields besides `exp` that must be present (e.g. `['bucket', 'key']`)
 * @throws Error if the token is invalid, incomplete, or expired
 */
function verifyTokenPayload<T extends BaseTokenPayload>(token: string, requiredKeys: (keyof T)[] = []): T {
  if (!token || typeof token !== 'string') {
    throw new Error('Token invalido');
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Token formato invalido');
  }

  const [payloadB64, signature] = parts;

  let payloadStr: string;
  try {
    const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    payloadStr = Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    throw new Error('Token payload invalido');
  }

  let payload: T;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    throw new Error('Token payload JSON invalido');
  }

  if (typeof payload.exp !== 'number') {
    throw new Error('Token payload incompleto');
  }
  for (const key of requiredKeys) {
    if (payload[key] === undefined) {
      throw new Error('Token payload incompleto');
    }
  }

  if (!verifySignature(payloadStr, signature)) {
    throw new Error('Token firma invalida');
  }

  if (payload.exp < Date.now()) {
    throw new Error('Token scaduto');
  }

  return payload;
}

/**
 * Download token payload
 */
export interface DownloadTokenPayload extends BaseTokenPayload {
  bucket: StorageBucket;
  key: string;
}

/**
 * Generates a signed token for downloading a file
 *
 * Token format: base64url(payload).base64url(signature)
 *
 * @example
 * const token = signDownloadToken({ bucket: 'uploads', key: '2025/10/file.pdf' });
 * // Returns: "eyJidWNrZXQiOiJ1cGxvYWRzI...".abcd1234...
 */
export function signDownloadToken(params: {
  bucket: StorageBucket;
  key: string;
  exp?: number;
}): string {
  const exp = params.exp || Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  return signTokenPayload<DownloadTokenPayload>({ bucket: params.bucket, key: params.key, exp });
}

/**
 * Verifies and decodes a download token
 *
 * @throws Error if the token is invalid or expired
 *
 * @example
 * try {
 *   const { bucket, key } = verifyDownloadToken(token);
 *   // Download file from bucket/key
 * } catch (error) {
 *   // Invalid token
 * }
 */
export function verifyDownloadToken(token: string): DownloadTokenPayload {
  return verifyTokenPayload<DownloadTokenPayload>(token, ['bucket', 'key']);
}

/**
 * Upload token payload — binds an upload slot to bucket, key **and user**.
 *
 * `confirmUpload` used to accept bucket and key directly from the input, without
 * ever comparing them against what storage actually contains. The bucket was
 * constrained by the enum, the key wasn't: it was enough to call it with the key
 * of a blob uploaded by someone else to get a `FileObject` created with your own
 * `createdBy`. From there the `confirmPendingFile` predicate (`createdBy === userId`)
 * passes, and someone else's file gets linked as your own logo — the predicate
 * verifies ownership of the *row*, and it's `confirmUpload` that decides who owns
 * the row.
 *
 * Binding the key to the slot the server allocated closes the hole without any
 * round-trip to storage, which wouldn't have a `head`/`exists` anyway
 * (`IStorageProvider` only exposes put/get/delete/list).
 */
export interface UploadTokenPayload extends BaseTokenPayload {
  bucket: StorageBucket;
  key: string;
  /** The user the slot was assigned to: only they can confirm it. */
  userId: string;
}

/**
 * Signs the slot allocated by `requestUpload`.
 *
 * @param ttlMs - Align it to the presigned URL's expiry, don't leave the
 *   default: a slow upload on a poor network would exceed 5 minutes and
 *   fail at confirmation, with the blob already uploaded.
 */
export function signUploadToken(params: {
  bucket: StorageBucket;
  key: string;
  userId: string;
  ttlMs?: number;
}): string {
  const exp = Date.now() + (params.ttlMs ?? DOWNLOAD_TOKEN_TTL_MS);
  return signTokenPayload<UploadTokenPayload>({
    bucket: params.bucket,
    key: params.key,
    userId: params.userId,
    exp,
  });
}

/**
 * Verifies an upload token.
 *
 * The caller must compare `userId` against the session: the signature proves
 * that the server allocated that slot, not that they are the one using it.
 *
 * @throws Error if the token is invalid, incomplete, or expired.
 */
export function verifyUploadToken(token: string): UploadTokenPayload {
  return verifyTokenPayload<UploadTokenPayload>(token, ['bucket', 'key', 'userId']);
}

/**
 * Export token payload — same stateless HMAC signature as `DownloadTokenPayload`, but also
 * includes the `.lukebak` envelope header (already passphrase-encrypted, never the secret
 * in plaintext) so the streaming route doesn't need to re-read the DB to reconstruct it.
 */
export interface ExportTokenPayload extends BaseTokenPayload {
  bucket: StorageBucket;
  key: string;
  header: BackupExportHeader;
}

/** Signs a token for exporting a backup (same HMAC as `signDownloadToken`, extended payload). */
export function signExportToken(params: {
  bucket: StorageBucket;
  key: string;
  header: BackupExportHeader;
  exp?: number;
}): string {
  const exp = params.exp || Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  return signTokenPayload<ExportTokenPayload>({ bucket: params.bucket, key: params.key, header: params.header, exp });
}

/** Verifies and decodes an export token. @throws Error if the token is invalid or expired. */
export function verifyExportToken(token: string): ExportTokenPayload {
  return verifyTokenPayload<ExportTokenPayload>(token, ['bucket', 'key', 'header']);
}

/**
 * Audit log CSV export token payload — same stateless HMAC as the other variants,
 * but without bucket/key: it's not a file already present in storage, the CSV is
 * generated on-the-fly from the filters encapsulated in the token.
 */
export interface AuditLogExportTokenPayload extends BaseTokenPayload {
  filters: AuditLogFilters;
}

/** Signs a token for the audit log CSV export, encapsulating the applied filters. */
export function signAuditLogExportToken(params: {
  filters: AuditLogFilters;
  exp?: number;
}): string {
  const exp = params.exp || Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  return signTokenPayload<AuditLogExportTokenPayload>({ filters: params.filters, exp });
}

/** Verifies and decodes an audit log export token. @throws Error if the token is invalid or expired. */
export function verifyAuditLogExportToken(token: string): AuditLogExportTokenPayload {
  return verifyTokenPayload<AuditLogExportTokenPayload>(token, ['filters']);
}
