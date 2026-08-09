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

import argon2 from 'argon2';

import type { PassphraseWrappedDek } from '@luke/core';

import { ALGORITHM, AUTH_TAG_LENGTH, decryptValue, encryptValue, IV_LENGTH } from '../configManager';
import { ARGON2_OPTIONS } from '../password';

const DEK_LENGTH = 32; // 256 bits, matches AES-256

const PASSPHRASE_SALT_LENGTH = 16;

/** Same Argon2id tuning as `lib/password.ts`, reused here for a raw-key KDF instead of a verify-hash. */
async function derivePassphraseKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return argon2.hash(passphrase, { ...ARGON2_OPTIONS, raw: true, salt }) as Promise<Buffer>;
}

/**
 * Wraps a backup's DEK a second time with a key derived from a user-supplied passphrase
 * (Argon2id), independent of the server master key. This is what makes a `.lukebak` export
 * package decryptable on a different Luke instance — the only shared secret needed is the
 * passphrase itself.
 */
export async function wrapDekWithPassphrase(dek: Buffer, passphrase: string): Promise<PassphraseWrappedDek> {
  const salt = randomBytes(PASSPHRASE_SALT_LENGTH);
  const key = await derivePassphraseKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    saltHex: salt.toString('hex'),
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextHex: ciphertext.toString('hex'),
  };
}

/**
 * Recovers a DEK from its passphrase-wrapped form. Throws (GCM auth-tag mismatch) if the
 * passphrase is wrong or the package was tampered with — this doubles as passphrase validation,
 * no separate check needed.
 */
export async function unwrapDekWithPassphrase(wrapped: PassphraseWrappedDek, passphrase: string): Promise<Buffer> {
  const salt = Buffer.from(wrapped.saltHex, 'hex');
  const key = await derivePassphraseKey(passphrase, salt);
  const iv = Buffer.from(wrapped.ivHex, 'hex');
  const authTag = Buffer.from(wrapped.authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertextHex, 'hex')), decipher.final()]);
}

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
