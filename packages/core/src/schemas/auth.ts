/**
 * Zod schemas for authentication flows and transactional emails
 * (password reset, email verification).
 */

import { z } from 'zod';

/** Input schema for requesting a password reset email. Email is normalized to lowercase. */
export const RequestPasswordResetSchema = z.object({
  email: z
    .string()
    .min(1, 'Email richiesta')
    .email('Email non valida')
    .toLowerCase()
    .trim(),
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

/** Input schema for requesting an email verification link. */
export const RequestEmailVerificationSchema = z.object({
  email: z
    .string()
    .min(1, 'Email richiesta')
    .email('Email non valida')
    .toLowerCase()
    .trim(),
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

/** Input schema for an admin to trigger email verification for a user by userId. */
export const RequestEmailVerificationAdminSchema = z.object({
  userId: z.string().uuid('ID utente non valido'),
});

// Export types
export type RequestPasswordResetInput = z.infer<
  typeof RequestPasswordResetSchema
>;
export type ConfirmPasswordResetInput = z.infer<
  typeof ConfirmPasswordResetSchema
>;
export type RequestEmailVerificationInput = z.infer<
  typeof RequestEmailVerificationSchema
>;
export type ConfirmEmailVerificationInput = z.infer<
  typeof ConfirmEmailVerificationSchema
>;
export type RequestEmailVerificationAdminInput = z.infer<
  typeof RequestEmailVerificationAdminSchema
>;
