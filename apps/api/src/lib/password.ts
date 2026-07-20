/**
 * Password management utilities using Argon2id.
 * Provides hashing, verification, and policy validation.
 */

import argon2 from 'argon2';

/**
 * Configurazione Argon2 per hash password
 * Usa argon2id per sicurezza ottimale
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16, // 64 MB
  timeCost: 3, // 3 iterazioni
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
      `Errore durante l'hash della password: ${error instanceof Error ? error.message : 'Errore sconosciuto'}`
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
    // In caso di errore (hash malformato, ecc.), considera la password non valida
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

  // Verifica lunghezza minima
  if (password.length < policy.minLength) {
    errors.push(`Lunghezza minima: ${policy.minLength} caratteri`);
  }

  // Verifica maiuscola
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Richiesta almeno una lettera maiuscola');
  }

  // Verifica minuscola
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Richiesta almeno una lettera minuscola');
  }

  // Verifica cifra
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    errors.push('Richiesta almeno una cifra');
  }

  // Verifica carattere speciale
  if (
    policy.requireSpecialChar &&
    !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
  ) {
    errors.push('Richiesto almeno un carattere speciale');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
