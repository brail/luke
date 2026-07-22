/**
 * Envelope encryption for backups.
 *
 * Each backup is encrypted with a random 32-byte data-encryption-key (DEK), streamed via
 * AES-256-GCM so arbitrarily large payloads never sit fully in memory. The DEK itself is
 * small, so it is wrapped (encrypted) with the existing server master key via the same
 * whole-string AES-256-GCM primitive already used for AppConfig secrets — this reuses
 * `encryptValue`/`decryptValue` rather than re-implementing master-key crypto, and means
 * the master key can be rotated without re-encrypting every historical backup blob.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'crypto';

import { ALGORITHM, AUTH_TAG_LENGTH, decryptValue, encryptValue, IV_LENGTH } from '../configManager';

const DEK_LENGTH = 32; // 256 bits, matches AES-256

/** Generates a random 256-bit data-encryption-key for a single backup. */
export function generateDek(): Buffer {
  return randomBytes(DEK_LENGTH);
}

/** Encrypts a DEK with the server master key for storage in `BackupRecord.wrappedDekHex`. */
export function wrapDek(dek: Buffer): string {
  return encryptValue(dek.toString('hex'));
}

/** Decrypts a wrapped DEK back to its raw bytes using the server master key. */
export function unwrapDek(wrappedDekHex: string): Buffer {
  return Buffer.from(decryptValue(wrappedDekHex), 'hex');
}

export interface BackupCipher {
  /** Initialization vector — must be persisted (as hex) to decrypt later. */
  iv: Buffer;
  cipher: CipherGCM;
}

/**
 * Creates a streaming AES-256-GCM cipher for a backup's data stream.
 * Pipe the archive stream through `cipher`, then call `cipher.final()` and
 * `cipher.getAuthTag()` once the stream ends — the auth tag is only known at that point.
 */
export function createBackupCipher(dek: Buffer): BackupCipher {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
  return { iv, cipher };
}

/**
 * Creates a streaming AES-256-GCM decipher for a backup's data stream.
 * The auth tag is set immediately (known upfront from `BackupRecord`/sidecar metadata),
 * which Node's streaming API allows as long as it happens before `decipher.final()`.
 */
export function createBackupDecipher(
  dek: Buffer,
  ivHex: string,
  authTagHex: string
): DecipherGCM {
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher;
}
