/**
 * Download Token HMAC per storage
 *
 * Sistema stateless per generare e verificare token temporanei
 * per download di file dallo storage.
 *
 * Sicurezza:
 * - HMAC-SHA256 con chiave derivata via HKDF
 * - TTL breve (5 minuti)
 * - Stateless (no Redis/DB)
 * - Payload minimo (bucket, key, exp)
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { deriveSecret } from '@luke/core/server';

import type { StorageBucket } from '@luke/core';

/**
 * TTL dei token download (5 minuti)
 */
const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Chiave HMAC derivata via HKDF
 * Info: "luke:download-token"
 */
const HMAC_KEY = deriveSecret('luke:download-token');

/**
 * Payload del token download
 */
export interface DownloadTokenPayload {
  /** Bucket del file */
  bucket: StorageBucket;
  /** Chiave del file */
  key: string;
  /** Timestamp di scadenza (Unix ms) */
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
 * @param payload - Payload originale
 * @param signature - Firma da verificare (base64url)
 * @returns true se la firma è valida
 */
function verifySignature(payload: string, signature: string): boolean {
  const expectedSignature = signPayload(payload);

  // Converti entrambe le stringhe in Buffer per timing-safe compare
  const expected = Buffer.from(expectedSignature, 'utf8');
  const actual = Buffer.from(signature, 'utf8');

  // Se lunghezze diverse, fallisce subito (ma timing-safe)
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

/**
 * Genera un token firmato per download di un file
 *
 * Formato token: base64url(payload).base64url(signature)
 *
 * @param params - Parametri del token
 * @returns Token firmato
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
  const now = Date.now();
  const exp = params.exp || now + DOWNLOAD_TOKEN_TTL_MS;

  const payload: DownloadTokenPayload = {
    bucket: params.bucket,
    key: params.key,
    exp,
  };

  // JSON minified (no whitespace)
  const payloadStr = JSON.stringify(payload);

  // Base64url encode payload
  const payloadB64 = Buffer.from(payloadStr, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Firma payload
  const signature = signPayload(payloadStr);

  // Token: payload.signature
  return `${payloadB64}.${signature}`;
}

/**
 * Verifica e decodifica un token download
 *
 * @param token - Token da verificare
 * @returns Payload decodificato se valido
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
  // Valida formato base
  if (!token || typeof token !== 'string') {
    throw new Error('Token invalido');
  }

  // Split payload.signature
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Token formato invalido');
  }

  const [payloadB64, signature] = parts;

  // Decode payload
  let payloadStr: string;
  try {
    // Converti da base64url a base64 standard
    const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    // Aggiungi padding se necessario
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    );
    payloadStr = Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    throw new Error('Token payload invalido');
  }

  // Parse JSON
  let payload: DownloadTokenPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    throw new Error('Token payload JSON invalido');
  }

  // Valida campi obbligatori
  if (!payload.bucket || !payload.key || typeof payload.exp !== 'number') {
    throw new Error('Token payload incompleto');
  }

  // Verifica firma HMAC
  if (!verifySignature(payloadStr, signature)) {
    throw new Error('Token firma invalida');
  }

  // Verifica scadenza
  const now = Date.now();
  if (payload.exp < now) {
    throw new Error('Token scaduto');
  }

  return payload;
}

/**
 * Verifica se un token è valido senza lanciare eccezioni
 *
 * @param token - Token da verificare
 * @returns true se valido, false altrimenti
 */
export function isValidDownloadToken(token: string): boolean {
  try {
    verifyDownloadToken(token);
    return true;
  } catch {
    return false;
  }
}


