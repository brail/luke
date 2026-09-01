import { z } from 'zod';

import { HardDeleteConfirmSchema } from './confirmation.js';
import { passwordPrefilterSchema } from './password.js';

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

/**
 * Every field of `UpdateUserInputSchema` that a cross-user update can carry.
 *
 * `id` addresses the target rather than mutating it. `password` is excluded
 * because it structurally never reaches the router's `updateData`: it lives on
 * `LocalCredential`, not `User`, so it is destructured out and keeps its own
 * `*:*` guard. It is privileged — it is simply enforced on a different path,
 * named here rather than omitted silently.
 */
type UserUpdatableField = Exclude<keyof UpdateUserInput, 'id' | 'password'>;

/**
 * The fields a caller holding `users:update` **but not** `*:*` may change on
 * someone else's account. This is the allow-list, and it is the only list.
 *
 * Everything else in `UpdateUserInputSchema` is privileged **by derivation**
 * (`privilegedUserUpdateFields`), not by enumeration. That direction is the
 * whole point: a field added to the schema tomorrow is denied to editors by
 * default, instead of being writable until somebody remembers to classify it.
 *
 * The first version of this fix named the sensitive fields instead — which
 * closed the concrete email takeover while leaving the defect class intact,
 * since every future field would still have defaulted to permitted.
 *
 * `isActive` is here as a deliberate product decision, not by omission: an
 * editor deactivating a user is an existing capability, already bounded by the
 * self-deactivation guard and `assertNotLastAdminWithSettingsAccess`. It is
 * account state, not authentication identity. Removing it from this list would
 * be a behavioural change to make on its own merits.
 */
export const USER_EDITOR_UPDATABLE_FIELDS = [
  'firstName',
  'lastName',
  'isActive',
] as const satisfies readonly UserUpdatableField[];

/** A field an `editor` may change on another account. */
export type UserEditorUpdatableField = (typeof USER_EDITOR_UPDATABLE_FIELDS)[number];

/** A field whose mutation on another account requires `*:*`. */
export type PrivilegedUserUpdateField = Exclude<
  UserUpdatableField,
  UserEditorUpdatableField
>;

/**
 * The privileged complement, derived from the schema rather than listed.
 *
 * Reading the shape at runtime is what makes the default deny: a new key in
 * `UpdateUserInputSchema` appears here automatically, with no edit to this file
 * and nothing to remember. The router and the regression matrix both consume
 * this, so neither can drift from the schema or from each other.
 */
export function privilegedUserUpdateFields(): PrivilegedUserUpdateField[] {
  const editorPermitted = USER_EDITOR_UPDATABLE_FIELDS as readonly string[];
  return Object.keys(UpdateUserInputSchema.shape).filter(
    (field): field is PrivilegedUserUpdateField =>
      field !== 'id' && field !== 'password' && !editorPermitted.includes(field)
    // The predicate mirrors `UserUpdatableField` minus the allow-list, which is
    // exactly `PrivilegedUserUpdateField`; TypeScript cannot narrow a string
    // key of a Zod shape to that union on its own.
  );
}

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
