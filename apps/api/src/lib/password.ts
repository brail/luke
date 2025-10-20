/**
 * Helper per gestione password con Argon2
 * Wrapper per le operazioni di hash e verifica password
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
 * Genera hash di una password usando Argon2
 * @param password - Password in chiaro
 * @returns Hash della password
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
 * Verifica una password contro il suo hash
 * @param password - Password in chiaro da verificare
 * @param hash - Hash della password memorizzato
 * @returns true se la password è corretta, false altrimenti
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch (error) {
    // In caso di errore (hash malformato, ecc.), considera la password non valida
    return false;
  }
}

/**
 * Interfaccia per password policy
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
}

/**
 * Risultato della validazione password
 */
export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Valida una password contro una policy
 * @param password - Password da validare
 * @param policy - Password policy da applicare
 * @returns Risultato validazione con lista errori
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
    !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  ) {
    errors.push('Richiesto almeno un carattere speciale');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
