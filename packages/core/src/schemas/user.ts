import { z } from 'zod';

/**
 * Schema Zod per il modello User
 * Definisce la struttura di un utente con validazione dei campi
 */
export const UserSchema = z.object({
  /** ID univoco dell'utente (UUID v4) */
  id: z.string().uuid(),

  /** Email dell'utente (validata come formato email) */
  email: z.string().email(),

  /** Username dell'utente */
  username: z.string(),

  /** Nome dell'utente */
  firstName: z.string().default(''),

  /** Cognome dell'utente */
  lastName: z.string().default(''),

  /** Ruolo dell'utente nel sistema */
  role: z.enum(['admin', 'editor', 'viewer']),

  /** Stato di attivazione dell'utente */
  isActive: z.boolean(),

  /** Data di creazione dell'utente */
  createdAt: z.date(),

  /** Data dell'ultimo aggiornamento */
  updatedAt: z.date(),
});

/**
 * Schema per creazione utente
 */
export const CreateUserInputSchema = z.object({
  email: z.string().email('Email non valida'),
  username: z.string().min(3, 'Username deve essere di almeno 3 caratteri'),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  password: z.string().min(8, 'Password deve essere di almeno 8 caratteri'),
  role: z.enum(['admin', 'editor', 'viewer']),
});

/**
 * Schema per aggiornamento utente
 */
export const UpdateUserInputSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
  email: z.string().email('Email non valida').optional(),
  username: z
    .string()
    .min(3, 'Username deve essere di almeno 3 caratteri')
    .optional(),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Tipo TypeScript inferito dallo schema User
 */
export type User = z.infer<typeof UserSchema>;

/**
 * Tipo TypeScript per input creazione utente
 */
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

/**
 * Tipo TypeScript per input aggiornamento utente
 */
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

/**
 * Campi che possono essere bloccati per provider esterni
 */
export type LockedFields =
  | 'email'
  | 'username'
  | 'role'
  | 'firstName'
  | 'lastName'
  | 'password';
