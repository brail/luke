/**
 * Password management utilities using Argon2id.
 * Provides hashing, verification, and policy validation.
 */

import argon2 from 'argon2';

import { PASSWORD_SPECIAL_CHAR_REGEX } from '@luke/core';

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

/**
 * Password complexity requirements loaded from AppConfig.
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
}

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
  const errors: string[] = [];

  // Checks minimum length
  if (password.length < policy.minLength) {
    errors.push(`Lunghezza minima: ${policy.minLength} caratteri`);
  }

  // Checks for uppercase letter
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Richiesta almeno una lettera maiuscola');
  }

  // Checks for lowercase letter
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Richiesta almeno una lettera minuscola');
  }

  // Checks for digit
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    errors.push('Richiesta almeno una cifra');
  }

  // Checks for special character. The set comes from `@luke/core` so the form, the indicators and
  // the reset page can ask for the same thing — and can name the characters instead of saying
  // "symbol", which is what left `~` and a space looking acceptable right up to the rejection.
  if (policy.requireSpecialChar && !PASSWORD_SPECIAL_CHAR_REGEX.test(password)) {
    errors.push('Richiesto almeno un carattere speciale');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
