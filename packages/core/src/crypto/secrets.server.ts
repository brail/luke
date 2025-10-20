/**
 * @luke/core/crypto - Gestione sicura dei segreti (SERVER-ONLY)
 *
 * Questo modulo fornisce:
 * - Accesso alla master key per cifratura
 * - Derivazione di segreti specifici tramite HKDF-SHA256
 * - Gestione NextAuth secret derivato deterministicamente
 *
 * ⚠️ IMPORTANTE: Questo modulo può essere importato solo server-side
 *
 * @version 0.1.0
 * @author Luke Team
 */

// Runtime check: fail se eseguito nel browser
import { hkdfSync, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

if (typeof window !== 'undefined') {
  throw new Error('secrets.server.ts può essere importato solo server-side');
}

const MASTER_KEY_PATH = join(homedir(), '.luke', 'secret.key');
const KEY_LENGTH = 32; // 256 bits per AES-256
const HKDF_SALT = 'luke';
const HKDF_INFO_NEXTAUTH = 'nextauth.secret';
const HKDF_INFO_API_JWT = 'api.jwt';
const HKDF_INFO_COOKIE = 'cookie.secret';
const HKDF_LENGTH = 32; // 256 bits

/**
 * Ottiene la master key per la cifratura
 * Se non esiste, la crea automaticamente con permessi 0600
 *
 * @returns Buffer della master key (32 bytes)
 * @throws Error se la master key non può essere creata o letta
 */
export function getMasterKey(): Buffer {
  const keyDir = join(homedir(), '.luke');

  if (!existsSync(MASTER_KEY_PATH)) {
    // Crea directory se non esiste
    if (!existsSync(keyDir)) {
      mkdirSync(keyDir, { mode: 0o700 });
    }

    // Genera nuova master key
    const masterKey = randomBytes(KEY_LENGTH);
    writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });

    console.log(`🔑 Master key creata in: ${MASTER_KEY_PATH}`);
  }

  const keyBuffer = readFileSync(MASTER_KEY_PATH);

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `Master key deve essere di ${KEY_LENGTH} bytes, trovati ${keyBuffer.length}`
    );
  }

  return keyBuffer;
}

/**
 * Deriva un segreto specifico dalla master key usando HKDF-SHA256
 *
 * @param purpose - Scopo del segreto (es: 'nextauth.secret', 'jwt.secret')
 * @returns Segreto derivato in formato base64url
 * @throws Error se la derivazione fallisce
 */
export function deriveSecret(purpose: string): string {
  try {
    const masterKey = getMasterKey();

    // HKDF-SHA256: Extract + Expand
    const derivedKey = hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(HKDF_SALT, 'utf8'),
      Buffer.from(purpose, 'utf8'),
      HKDF_LENGTH
    );

    // Converti ArrayBuffer in Buffer e poi in base64url (URL-safe base64)
    const buffer = Buffer.from(derivedKey);
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  } catch (error) {
    console.error(`❌ Errore derivazione segreto per '${purpose}':`, error);
    throw new Error(`Impossibile derivare segreto per scopo: ${purpose}`);
  }
}

/**
 * Ottiene il NextAuth secret derivato dalla master key
 *
 * Il secret è deterministico: stesso master key → stesso secret
 * Questo garantisce che le sessioni rimangano valide tra riavvii
 * sullo stesso host, ma cambiano se la master key viene rigenerata.
 *
 * @returns NextAuth secret in formato base64url
 * @throws Error se la derivazione fallisce
 */
export function getNextAuthSecret(): string {
  try {
    const secret = deriveSecret(HKDF_INFO_NEXTAUTH);
    console.log('🔐 NextAuth secret derivato via HKDF-SHA256');
    return secret;
  } catch (error) {
    console.error('❌ Errore derivazione NextAuth secret:', error);
    throw new Error('Impossibile derivare NextAuth secret dalla master key');
  }
}

/**
 * Ottiene il JWT secret per l'API derivato dalla master key
 *
 * Il secret è deterministico: stesso master key → stesso secret
 * Questo garantisce che i token JWT rimangano validi tra riavvii
 * sullo stesso host, ma cambiano se la master key viene rigenerata.
 *
 * @returns JWT secret per API in formato base64url
 * @throws Error se la derivazione fallisce
 */
export function getApiJwtSecret(): string {
  try {
    const secret = deriveSecret(HKDF_INFO_API_JWT);
    console.log('🔐 API JWT secret derivato via HKDF-SHA256');
    return secret;
  } catch (error) {
    console.error('❌ Errore derivazione API JWT secret:', error);
    throw new Error('Impossibile derivare API JWT secret dalla master key');
  }
}

/**
 * Verifica che la master key sia accessibile e valida
 *
 * @returns true se la master key è valida, false altrimenti
 */
export function validateMasterKey(): boolean {
  try {
    const masterKey = getMasterKey();
    return masterKey.length === KEY_LENGTH;
  } catch {
    return false;
  }
}

// Export costanti per uso esterno (eliminare magic strings)
export { HKDF_INFO_NEXTAUTH, HKDF_INFO_API_JWT, HKDF_INFO_COOKIE };
