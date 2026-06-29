'use client';

import { useMemo } from 'react';

/**
 * Validates a password and its confirmation field in real-time.
 * All checks are memoized and re-evaluated only when the inputs change.
 *
 * @param password - The password being entered.
 * @param confirmPassword - The confirmation field value (optional).
 * @returns `{ passwordChecks, passwordErrors, confirmPasswordError, isValid, firstError }`
 *   where `isValid` is `true` when all constraints pass and the passwords match.
 *   An empty password is considered valid (suitable for optional edit-mode fields).
 */
export function usePasswordValidation(
  password: string,
  confirmPassword: string = ''
) {
  // Controlli di validazione
  const passwordChecks = useMemo(
    () => ({
      length: password.length >= 12,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password),
      match: password === confirmPassword && confirmPassword.length > 0,
    }),
    [password, confirmPassword]
  );

  // Messaggi di errore
  const passwordErrors = useMemo(() => {
    if (!password || password.length === 0) {
      return [];
    }

    const errors: string[] = [];

    if (!passwordChecks.length) {
      errors.push('Password deve essere di almeno 12 caratteri');
    }
    if (!passwordChecks.uppercase) {
      errors.push('Password deve contenere almeno una lettera maiuscola');
    }
    if (!passwordChecks.lowercase) {
      errors.push('Password deve contenere almeno una lettera minuscola');
    }
    if (!passwordChecks.number) {
      errors.push('Password deve contenere almeno un numero');
    }
    if (!passwordChecks.symbol) {
      errors.push('Password deve contenere almeno un carattere speciale');
    }

    return errors;
  }, [password, passwordChecks]);

  // Errore per conferma password
  const confirmPasswordError = useMemo(() => {
    if (!confirmPassword || confirmPassword.length === 0) {
      return '';
    }

    if (password !== confirmPassword) {
      return 'Le password non coincidono';
    }

    return '';
  }, [password, confirmPassword]);

  // Validazione completa
  const isValid = useMemo(() => {
    if (!password || password.length === 0) {
      return true; // Password vuota è valida (per edit mode)
    }

    return (
      Object.values(passwordChecks).every(check => check) &&
      !confirmPasswordError
    );
  }, [password, passwordChecks, confirmPasswordError]);

  return {
    passwordChecks,
    passwordErrors,
    confirmPasswordError,
    isValid,
    // Helper per ottenere il primo errore
    firstError: passwordErrors[0] || confirmPasswordError,
  };
}
