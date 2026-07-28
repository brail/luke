/**
 * Download/Export Token HMAC
 *
 * Sistema stateless per generare e verificare token temporanei per download/export —
 * di file dallo storage (bucket/key) o di dati generati on-the-fly (es. CSV audit log).
 *
 * Sicurezza:
 * - HMAC-SHA256 con chiave derivata via HKDF
 * - TTL breve (5 minuti)
 * - Stateless (no Redis/DB)
 * - Payload minimo (exp [, extra])
 */

import { createHmac, timingSafeEqual } from 'crypto';

import type { AuditLogFilters, BackupExportHeader, StorageBucket } from '@luke/core';
import { deriveSecret } from '@luke/core/server';


/**
 * TTL dei token (5 minuti)
 */
const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Chiave HMAC derivata via HKDF
 * Info: "luke:download-token"
 */
const HMAC_KEY = deriveSecret('luke:download-token');

/** Campo comune a ogni payload firmato da questo modulo: scadenza. Il resto del payload (bucket/key, filtri, ...) è specifico di ogni variante di token e passato via `requiredKeys` a `verifyTokenPayload`. */
interface BaseTokenPayload {
  exp: number;
}

/**
 * Firma un payload con HMAC-SHA256
 *
 * @param payload - Payload da firmare (JSON minified)
 * @returns Firma HMAC in base64url
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
 * Verifica una firma HMAC in modo timing-safe
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
 * Firma un payload (exp + campi specifici della variante) nel formato
 * `base64url(payload).base64url(signature)`, condiviso da tutte le varianti di token
 * (download semplice, export con header allegato, export CSV audit log, ...).
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
 * Verifica e decodifica un token firmato da `signTokenPayload`.
 *
 * @param token - Token da verificare
 * @param requiredKeys - Campi oltre a `exp` che devono essere presenti (es. `['bucket', 'key']`)
 * @throws Error se token invalido, incompleto o scaduto
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
 * Payload del token download
 */
export interface DownloadTokenPayload extends BaseTokenPayload {
  bucket: StorageBucket;
  key: string;
}

/**
 * Genera un token firmato per download di un file
 *
 * Formato token: base64url(payload).base64url(signature)
 *
 * @example
 * const token = signDownloadToken({ bucket: 'uploads', key: '2025/10/file.pdf' });
 * // Ritorna: "eyJidWNrZXQiOiJ1cGxvYWRzI...".abcd1234...
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
 * Verifica e decodifica un token download
 *
 * @throws Error se token invalido o scaduto
 *
 * @example
 * try {
 *   const { bucket, key } = verifyDownloadToken(token);
 *   // Download file da bucket/key
 * } catch (error) {
 *   // Token invalido
 * }
 */
export function verifyDownloadToken(token: string): DownloadTokenPayload {
  return verifyTokenPayload<DownloadTokenPayload>(token, ['bucket', 'key']);
}

/**
 * Payload del token export — stessa firma HMAC stateless di `DownloadTokenPayload`, ma include
 * anche l'header dell'envelope `.lukebak` (già cifrato per passphrase, mai il segreto in chiaro)
 * così la route di streaming non deve rileggere il DB per ricostruirlo.
 */
export interface ExportTokenPayload extends BaseTokenPayload {
  bucket: StorageBucket;
  key: string;
  header: BackupExportHeader;
}

/** Firma un token per l'export di un backup (stesso HMAC di `signDownloadToken`, payload esteso). */
export function signExportToken(params: {
  bucket: StorageBucket;
  key: string;
  header: BackupExportHeader;
  exp?: number;
}): string {
  const exp = params.exp || Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  return signTokenPayload<ExportTokenPayload>({ bucket: params.bucket, key: params.key, header: params.header, exp });
}

/** Verifica e decodifica un token export. @throws Error se token invalido o scaduto. */
export function verifyExportToken(token: string): ExportTokenPayload {
  return verifyTokenPayload<ExportTokenPayload>(token, ['bucket', 'key', 'header']);
}

/**
 * Payload del token export CSV dell'audit log — stesso HMAC stateless delle altre varianti,
 * ma senza bucket/key: non è un file già presente nello storage, il CSV viene generato
 * on-the-fly dai filtri incapsulati nel token.
 */
export interface AuditLogExportTokenPayload extends BaseTokenPayload {
  filters: AuditLogFilters;
}

/** Firma un token per l'export CSV dell'audit log, incapsulando i filtri applicati. */
export function signAuditLogExportToken(params: {
  filters: AuditLogFilters;
  exp?: number;
}): string {
  const exp = params.exp || Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  return signTokenPayload<AuditLogExportTokenPayload>({ filters: params.filters, exp });
}

/** Verifica e decodifica un token export audit log. @throws Error se token invalido o scaduto. */
export function verifyAuditLogExportToken(token: string): AuditLogExportTokenPayload {
  return verifyTokenPayload<AuditLogExportTokenPayload>(token, ['filters']);
}
