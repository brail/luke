import { z } from 'zod';

import { Roles } from '../rbac.js';

import { HardDeleteConfirmSchema } from './confirmation.js';
import { passwordPrefilterSchema } from './password.js';
import { SectionOverrideInputSchema } from './rbac.js';

/**
 * A user's email address in the one form Luke stores and compares (#228): trimmed, lowercase, and
 * valid by zod's default pattern, which is ASCII-only — so SQL `lower()` and JavaScript
 * `toLowerCase()` agree on every address it admits. The database refuses any other form
 * (`users_email_normalized`), so every writer of `User.email` goes through this schema.
 */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Email non valida').max(255, 'Email troppo lunga'));

/** Full user record as returned by the API (excludes password hash). */
export const UserSchema = z.object({
  /** Unique user ID (UUID v4) */
  id: z.uuid(),

  /** User email, in the stored form */
  email: EmailSchema,

  /** User username */
  username: z.string(),

  /** User first name */
  firstName: z.string().default(''),

  /** User last name */
  lastName: z.string().default(''),

  /** User role in the system */
  role: z.enum(Roles),

  /** User activation state */
  isActive: z.boolean(),

  /** User creation date */
  createdAt: z.date(),

  /** Last update date */
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
  email: EmailSchema,
  username: z.string().min(3, 'Username deve essere di almeno 3 caratteri'),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  password: passwordPrefilterSchema,
  role: z.enum(Roles),
});

/** Input schema for partially updating a user. All fields are optional except `id`. */
export const UpdateUserInputSchema = z.object({
  id: z.uuid('ID utente non valido'),
  email: EmailSchema.optional(),
  username: z
    .string()
    .min(3, 'Username deve essere di almeno 3 caratteri')
    .optional(),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  role: z.enum(Roles).optional(),
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
 * whole point: a field added to the schema tomorrow is denied to such a caller
 * by default, instead of being writable until somebody remembers to classify it.
 *
 * No built-in role is such a caller today — `users:update` is admin-only — so
 * the list holds only for a future role granted `users:update` without `*:*`.
 *
 * The first version of this fix named the sensitive fields instead — which
 * closed the concrete email takeover while leaving the defect class intact,
 * since every future field would still have defaulted to permitted.
 *
 * `isActive` is here as a deliberate product decision, not by omission: such a
 * caller deactivating a user was an existing capability, bounded by the
 * self-deactivation guard and `assertNotLastAdminWithSettingsAccess`. It is
 * account state, not authentication identity. Removing it from this list would
 * be a behavioural change to make on its own merits.
 */
export const USER_EDITOR_UPDATABLE_FIELDS = [
  'firstName',
  'lastName',
  'isActive',
] as const satisfies readonly UserUpdatableField[];

/** A field a `users:update` holder without `*:*` may change on another account. */
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
  id: z.uuid('ID utente non valido'),
});

/** Input schema for permanently deleting a user — an id alone is not enough. */
export const UserHardDeleteInputSchema = UserIdSchema.extend(HardDeleteConfirmSchema.shape);

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

/**
 * The provider that decides a user's synced fields when the user holds more than one identity
 * (`forceLocalAccess` grants a LOCAL one beside an LDAP one): an external identity always wins over
 * LOCAL, since its sync keeps overwriting those fields at every sign-in. `'LOCAL'` only when there is
 * no external identity. Never read `identities[0]`: the rows come in no guaranteed order.
 */
export function resolveEffectiveProvider<P extends string>(identities: readonly { provider: P }[] = []): P | 'LOCAL' {
  return identities.find(i => i.provider !== 'LOCAL')?.provider ?? 'LOCAL';
}

/**
 * The domain of the address Luke gives a new LDAP user whose directory entry has no mail:
 * `<username>@ldap.local`, or `ldap-<uuid>@ldap.local`. It is Luke's placeholder, never a person's.
 */
export const LDAP_SYNTHETIC_EMAIL_DOMAIN = 'ldap.local';

/** Whether `email` is a synthetic LDAP address (`LDAP_SYNTHETIC_EMAIL_DOMAIN`), which receives no mail. */
export function isSyntheticLdapEmail(email: string): boolean {
  return email.endsWith(`@${LDAP_SYNTHETIC_EMAIL_DOMAIN}`);
}

/**
 * Why a pending user with a synthetic address cannot be approved yet (owner #69 a): an LDAP user
 * cannot change their own address once approved, so an approval without one leaves them unreachable.
 */
export const APPROVAL_NEEDS_EMAIL_MESSAGE =
  'Questo utente non ha ancora un indirizzo email: inseriscilo nella finestra di approvazione (serve un amministratore), attendi che lo inserisca dalla schermata di attesa, oppure rifiuta la richiesta.';

/**
 * An address Luke can mail: the stored form (`EmailSchema`), and not a synthetic LDAP one, which
 * reaches nobody and would leave a pending account as unapprovable as before.
 */
export const MailableEmailSchema = EmailSchema.refine(email => !isSyntheticLdapEmail(email), 'Email non valida');

/** Why an approval's address was refused: the user gave one on the pending screen meanwhile (#272). */
export const APPROVAL_HAS_EMAIL_MESSAGE =
  "L'utente ha inserito nel frattempo un proprio indirizzo email, che resta: riprova l'approvazione.";

/**
 * One approval of a pending user (#272, ADR-044): the team, and — for an administrator (`*:*`) — the
 * address, the role and the section overrides, all applied in the approval's transaction. At most
 * one override per section.
 */
export const ApprovePendingUserInputSchema = UserIdSchema.extend({
  teamId: z.uuid(),
  email: MailableEmailSchema.optional(),
  role: z.enum(Roles).optional(),
  sectionOverrides: z
    .array(SectionOverrideInputSchema)
    .refine(items => new Set(items.map(item => item.section)).size === items.length, 'Sezione ripetuta')
    .optional(),
});

/**
 * The user fields the given provider owns, which nobody edits in Luke: none for LOCAL; username,
 * names and password for LDAP; names and password for any other external provider (OIDC).
 */
export function getLockedFields(provider: string): LockedFields[] {
  if (provider === 'LOCAL') return [];
  if (provider === 'LDAP') return ['username', 'firstName', 'lastName', 'password'];
  return ['firstName', 'lastName', 'password'];
}

/**
 * The fields a user cannot change on their own profile: the provider's (`getLockedFields`) and an
 * LDAP account's address, which the directory writes back at every sign-in (#230). An administrator
 * may still set it, for a directory without mail.
 */
export function getSelfLockedFields(provider: string): LockedFields[] {
  const locked = getLockedFields(provider);
  return provider === 'LDAP' ? [...locked, 'email'] : locked;
}
