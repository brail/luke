/**
 * Password management utilities using Argon2id.
 * Provides hashing, verification, and policy validation.
 */

import argon2 from 'argon2';

import { checkPassword, type PasswordPolicy } from '@luke/core';

/**
 * Argon2 configuration for password hashing
 * Uses argon2id for optimal security
 *
 * Exported for reuse by other Argon2id modules (e.g. `lib/backup/crypto.ts`, which derives a
 * key from passphrase with the same tuning instead of a verification hash) that must remain
 * aligned on these parameters.
 */
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16, // 64 MB
  timeCost: 3, // 3 iterations
  parallelism: 1, // 1 thread
  hashLength: 32, // 32 bytes
};

/**
 * Hashes a password using Argon2id with the configured memory, time, and parallelism cost.
 *
 * @returns Argon2id hash string.
 * @throws {Error} If hashing fails for any reason.
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    return await argon2.hash(password, ARGON2_OPTIONS);
  } catch (error) {
    throw new Error(
      `Errore durante l'hash della password: ${error instanceof Error ? error.message : 'Errore sconosciuto'}`,
      { cause: error }
    );
  }
}

/**
 * Verifies a plaintext password against a stored Argon2id hash.
 *
 * @returns `true` if the password matches, `false` otherwise (including on malformed hash).
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // On error (malformed hash, etc.), consider the password invalid
    return false;
  }
}

export type { PasswordPolicy };

/**
 * Outcome of a password validation check.
 */
export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates a plaintext password against the given policy.
 *
 * @param policy - Complexity requirements to enforce.
 * @returns Validation result with `isValid` flag and a list of human-readable error messages.
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicy
): PasswordValidationResult {
  // The predicates live in `@luke/core`; what stays here is the wording. `checkPassword` returns
  // keys precisely so the client can render the same evaluation as a checklist without either side
  // having to share the other's phrasing.
  const messages: Record<string, string> = {
    length: `Lunghezza minima: ${policy.minLength} caratteri`,
    uppercase: 'Richiesta almeno una lettera maiuscola',
    lowercase: 'Richiesta almeno una lettera minuscola',
    digit: 'Richiesta almeno una cifra',
    special: 'Richiesto almeno un carattere speciale',
  };

  const errors = checkPassword(password, policy)
    .filter(r => !r.met)
    .map(r => messages[r.key] as string);

  return {
    isValid: errors.length === 0,
    errors,
  };
}
