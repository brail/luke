/**
 * Schema Zod per autenticazione e email transazionali
 */

import { z } from 'zod';

/**
 * Schema per richiesta reset password
 */
export const RequestPasswordResetSchema = z.object({
  email: z
    .string()
    .min(1, 'Email richiesta')
    .email('Email non valida')
    .toLowerCase()
    .trim(),
});

/**
 * Schema per conferma reset password
 * Il token deve essere di 64 caratteri hex (32 byte)
 * La password sarà validata contro la password policy al momento della conferma
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

/**
 * Schema per richiesta verifica email
 */
export const RequestEmailVerificationSchema = z.object({
  email: z
    .string()
    .min(1, 'Email richiesta')
    .email('Email non valida')
    .toLowerCase()
    .trim(),
});

/**
 * Schema per conferma verifica email
 */
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
 * Schema per richiesta verifica email da admin (by userId)
 */
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
