/**
 * @luke/core/crypto - Secure secret management (SERVER-ONLY)
 *
 * This module provides:
 * - Access to the master key for encryption
 * - Derivation of purpose-specific secrets via HKDF-SHA256
 * - Management of deterministically derived NextAuth secret
 *
 * ⚠️ IMPORTANT: This module can only be imported server-side
 *
 * @version 0.1.0
 * @author Luke Team
 */

// Runtime check: fail if executed in the browser
import { hkdfSync, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

if (typeof window !== 'undefined') {
  throw new Error('secrets.server.ts can only be imported server-side');
}

const MASTER_KEY_PATH = join(homedir(), '.luke', 'secret.key');
const KEY_LENGTH = 32; // 256 bits per AES-256
const HKDF_SALT = 'luke';
const HKDF_INFO_NEXTAUTH = 'nextauth.secret';
const HKDF_INFO_API_JWT = 'api.jwt';
const HKDF_INFO_COOKIE = 'cookie.secret';
const HKDF_LENGTH = 32; // 256 bits

/**
 * Returns the 32-byte master key used for all HKDF-derived secrets.
 * Auto-generates and persists the key to `~/.luke/secret.key` (mode 0600) on first call.
 *
 * @returns 32-byte `Buffer` containing the master key
 * @throws {Error} If the key file cannot be created or read, or if its length is not 32 bytes
 */
export function getMasterKey(): Buffer {
  const keyDir = join(homedir(), '.luke');

  if (!existsSync(MASTER_KEY_PATH)) {
    // Create directory if it does not exist
    if (!existsSync(keyDir)) {
      mkdirSync(keyDir, { mode: 0o700 });
    }

    // Generate new master key
    const masterKey = randomBytes(KEY_LENGTH);
    writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });
  }

  const keyBuffer = readFileSync(MASTER_KEY_PATH);

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `Master key must be ${KEY_LENGTH} bytes, found ${keyBuffer.length}`
    );
  }

  return keyBuffer;
}

/**
 * Derives a purpose-specific secret from the master key using HKDF-SHA256.
 *
 * @param purpose - Derivation label (e.g. `'nextauth.secret'`, `'api.jwt'`)
 * @returns Derived 32-byte secret encoded as base64url
 * @throws {Error} If HKDF derivation fails
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

    // Convert ArrayBuffer to Buffer and then to base64url (URL-safe base64)
    const buffer = Buffer.from(derivedKey);
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  } catch {
    throw new Error(`Unable to derive secret for purpose: ${purpose}`);
  }
}

/**
 * Returns the NextAuth secret derived from the master key via HKDF.
 * Deterministic: the same master key always produces the same secret, so sessions
 * remain valid across restarts. Rotating the master key invalidates all sessions.
 *
 * @returns base64url-encoded NextAuth secret
 * @throws {Error} If derivation fails
 */
export function getNextAuthSecret(): string {
  try {
    return deriveSecret(HKDF_INFO_NEXTAUTH);
  } catch {
    throw new Error('Unable to derive NextAuth secret from master key');
  }
}

/**
 * Returns the API JWT secret derived from the master key via HKDF.
 * Deterministic: JWTs remain valid across restarts on the same host.
 * Rotating the master key invalidates all existing API tokens.
 *
 * @returns base64url-encoded JWT secret
 * @throws {Error} If derivation fails
 */
export function getApiJwtSecret(): string {
  try {
    return deriveSecret(HKDF_INFO_API_JWT);
  } catch {
    throw new Error('Unable to derive API JWT secret from master key');
  }
}

/**
 * Checks whether the master key is accessible and has the correct length.
 *
 * @returns `true` if the key is readable and exactly 32 bytes; `false` otherwise
 */
export function validateMasterKey(): boolean {
  try {
    const masterKey = getMasterKey();
    return masterKey.length === KEY_LENGTH;
  } catch {
    return false;
  }
}

// Export constants for external use (eliminate magic strings)
export { HKDF_INFO_NEXTAUTH, HKDF_INFO_API_JWT, HKDF_INFO_COOKIE };
