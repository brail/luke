import { z } from 'zod';

/**
 * Schema Zod per aggiornamento profilo utente
 * Definisce i campi modificabili nel profilo utente
 */
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

/**
 * Schema Zod per aggiornamento parziale profilo (solo timezone)
 * Permette di aggiornare solo il timezone senza richiedere tutti i campi
 */
export const UpdateTimezoneSchema = z.object({
  /** Timezone dell'utente (es. Europe/Rome, America/New_York) */
  timezone: z
    .string()
    .trim()
    .min(1, 'Timezone obbligatorio')
    .max(64, 'Timezone troppo lungo'),
});

/**
 * Schema Zod per cambio password
 * Include validazione policy password e conferma
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

/**
 * Tipo TypeScript per input aggiornamento profilo
 */
export type UserProfileInput = z.infer<typeof UserProfileSchema>;

/**
 * Tipo TypeScript per input aggiornamento timezone
 */
export type UpdateTimezoneInput = z.infer<typeof UpdateTimezoneSchema>;

/**
 * Tipo TypeScript per input cambio password
 */
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
