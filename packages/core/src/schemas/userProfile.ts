import { z } from 'zod';

/** Input schema for updating the authenticated user's profile (all editable fields). */
export const UserProfileSchema = z.object({
  /** Email dell'utente */
  email: z
    .string()
    .email('Email non valida')
    .trim()
    .min(1, 'Email obbligatoria')
    .max(255, 'Email troppo lunga'),

  /** Nome dell'utente */
  firstName: z
    .string()
    .trim()
    .min(1, 'Nome obbligatorio')
    .max(64, 'Nome troppo lungo'),

  /** Cognome dell'utente */
  lastName: z
    .string()
    .trim()
    .min(1, 'Cognome obbligatorio')
    .max(64, 'Cognome troppo lungo'),

  /** Locale dell'utente (es. it-IT, en-US) */
  locale: z
    .string()
    .trim()
    .min(2, 'Locale non valido')
    .max(10, 'Locale troppo lungo'),

  /** Timezone dell'utente (es. Europe/Rome, America/New_York) */
  timezone: z
    .string()
    .trim()
    .min(1, 'Timezone obbligatorio')
    .max(64, 'Timezone troppo lungo'),
});

/** Input schema for updating only the user's timezone without requiring other profile fields. */
export const UpdateTimezoneSchema = z.object({
  /** Timezone dell'utente (es. Europe/Rome, America/New_York) */
  timezone: z
    .string()
    .trim()
    .min(1, 'Timezone obbligatorio')
    .max(64, 'Timezone troppo lungo'),
});

/**
 * Input schema for changing the authenticated user's password.
 * Enforces the full password policy (length, case, digit, special char) and requires confirmation match.
 */
export const ChangePasswordSchema = z
  .object({
    /** Password corrente (per verifica) */
    currentPassword: z
      .string()
      .min(1, 'Password corrente obbligatoria')
      .max(128, 'Password troppo lunga'),

    /** Nuova password con policy forte */
    newPassword: z
      .string()
      .min(12, 'Password deve essere di almeno 12 caratteri')
      .max(128, 'Password troppo lunga')
      .regex(/[A-Z]/, 'Deve contenere almeno una lettera maiuscola')
      .regex(/[a-z]/, 'Deve contenere almeno una lettera minuscola')
      .regex(/[0-9]/, 'Deve contenere almeno una cifra')
      .regex(/[^A-Za-z0-9]/, 'Deve contenere almeno un simbolo speciale'),

    /** Conferma nuova password */
    confirmNewPassword: z
      .string()
      .min(12, 'Conferma password obbligatoria')
      .max(128, 'Password troppo lunga'),
  })
  .refine(data => data.newPassword === data.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: 'Le password non coincidono',
  });

export type UserProfileInput = z.infer<typeof UserProfileSchema>;
export type UpdateTimezoneInput = z.infer<typeof UpdateTimezoneSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
