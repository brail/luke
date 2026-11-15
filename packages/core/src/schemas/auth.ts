/**
 * Zod schemas for authentication flows and transactional emails
 * (password reset, email verification).
 */

import { z } from 'zod';

/**
 * Absolute lifetime of an API session, in seconds from the login it descends from (`authTime`):
 * no bearer is accepted past it, however often it was refreshed.
 */
export const SESSION_ABSOLUTE_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * The one answer to a sign-in refused before the password is proven, whatever the cause: a wrong
 * password, an unknown user, a full per-account bucket, a directory that could not judge the
 * credentials. The API sends it as the `UNAUTHORIZED` text, and the login page shows it for every
 * refusal that is not about a proven account, so no screen before sign-in tells them apart.
 */
export const SIGN_IN_REFUSED_MESSAGE =
  "Accesso non riuscito: controlla le credenziali o riprova tra qualche minuto. Se il problema continua, contatta l'amministratore.";

/**
 * The text of a password check LDAP could not complete, where it may be told: after the password
 * is proven, or to a signed-in user. Shared because production masks the text of every 5xx, so the
 * web shows its own copy for the `SERVICE_UNAVAILABLE` code.
 */
export const AUTH_UNAVAILABLE_MESSAGE = 'Servizio di autenticazione non disponibile. Riprova più tardi.';

/** Input schema for requesting a password reset email. Email is normalized to lowercase. */
export const RequestPasswordResetSchema = z.object({
  email: z
    .string()
    .min(1, 'Email richiesta')
    .pipe(z.email('Email non valida').toLowerCase().trim()),
});

/**
 * Input schema for confirming a password reset.
 * `token` must be a 64-character hex string (32 bytes). Password policy is validated server-side on confirm.
 */
export const ConfirmPasswordResetSchema = z.object({
  token: z
    .string()
    .min(64, 'Token non valido')
    .max(64, 'Token non valido')
    .regex(
      /^[a-f0-9]{64}$/,
      'Token deve essere una stringa hex di 64 caratteri'
    ),
  newPassword: z.string().min(1, 'Password richiesta'),
});

/** Input schema for confirming email verification with a 64-character hex token. */
export const ConfirmEmailVerificationSchema = z.object({
  token: z
    .string()
    .min(64, 'Token non valido')
    .max(64, 'Token non valido')
    .regex(
      /^[a-f0-9]{64}$/,
      'Token deve essere una stringa hex di 64 caratteri'
    ),
});

/**
 * Input schema for an LDAP user awaiting approval to register a real email. The password is the
 * proof of identity, verified exactly as a login's.
 */
export const SubmitPendingEmailSchema = z.object({
  username: z.string().min(1, 'Username richiesto'),
  password: z.string().min(1, 'Password richiesta'),
  email: z.string().trim().toLowerCase().pipe(z.email('Email non valida')),
});

/** Input schema for an admin to trigger email verification for a user by userId. */
export const RequestEmailVerificationAdminSchema = z.object({
  userId: z.uuid('ID utente non valido'),
});

// Export types
export type RequestPasswordResetInput = z.infer<
  typeof RequestPasswordResetSchema
>;
export type ConfirmPasswordResetInput = z.infer<
  typeof ConfirmPasswordResetSchema
>;
export type ConfirmEmailVerificationInput = z.infer<
  typeof ConfirmEmailVerificationSchema
>;
export type RequestEmailVerificationAdminInput = z.infer<
  typeof RequestEmailVerificationAdminSchema
>;
