import { z } from 'zod';

import { HardDeleteConfirmSchema } from './confirmation';
import { passwordPrefilterSchema } from './password';

/** Full user record as returned by the API (excludes password hash). */
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
 * Input schema for creating a user.
 *
 * `password` is only prefiltered here (8-128). The effective minimum and the complexity rules come
 * from the configured policy and are applied server-side — a schema compiled into the bundle cannot
 * know what an installation chose.
 */
export const CreateUserInputSchema = z.object({
  email: z.string().email('Email non valida'),
  username: z.string().min(3, 'Username deve essere di almeno 3 caratteri'),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  password: passwordPrefilterSchema,
  role: z.enum(['admin', 'editor', 'viewer']),
});

/** Input schema for partially updating a user. All fields are optional except `id`. */
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
  password: passwordPrefilterSchema.optional(),
});

/** Schema for identifying a single user by UUID — shared across the users sub-routers. */
export const UserIdSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
});

/** Input schema for permanently deleting a user — an id alone is not enough. */
export const UserHardDeleteInputSchema = UserIdSchema.merge(HardDeleteConfirmSchema);

export type User = z.infer<typeof UserSchema>;
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

/**
 * User fields that may be locked when the account is managed by an external provider (e.g. LDAP).
 * Locked fields cannot be edited by the user in their profile settings.
 */
export type LockedFields =
  | 'email'
  | 'username'
  | 'role'
  | 'firstName'
  | 'lastName'
  | 'password';
