/**
 * Validation and payload shaping for the user form, lifted out of the component.
 *
 * `apps/web` has no DOM test tier by design (see `vitest.config.mts`), and none of this needs one:
 * which identities are accepted, what leaves the form, and what a blank password means are all
 * decided by data. Same move as `linkedDateRange.ts` — the logic that is worth pinning lives here,
 * the component keeps the rendering.
 */

import { z } from 'zod';

import { CreateUserInputSchema, type LockedFields } from '@luke/core';

/**
 * The identity fields come from `users.core.create`'s own input, so the form and the endpoint
 * cannot end up with different ideas of what a username or an email is. Only what the endpoint has
 * no opinion about is declared here: `confirmPassword`, which never leaves the browser, and
 * `isActive`, which belongs to the update input rather than the create one.
 *
 * The password rules are the exception, and knowingly so: create requires 12 characters, edit adds
 * four complexity checks, and the server applies neither — it has a configurable policy
 * (`security.password.*`) that only the reset flow consults. Unifying that is a decision about
 * behaviour, not a schema move, and it is the next phase of this batch.
 */
export const CreateUserSchema = CreateUserInputSchema.extend({
  confirmPassword: z.string().min(1, 'Conferma password richiesta'),
  isActive: z.boolean(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Le password non coincidono',
  path: ['confirmPassword'],
});

export const EditUserSchema = CreateUserInputSchema
  .extend({
    password: z
      .string()
      .min(12, 'Password deve essere di almeno 12 caratteri')
      .regex(/[A-Z]/, 'Password deve contenere almeno una lettera maiuscola')
      .regex(/[a-z]/, 'Password deve contenere almeno una lettera minuscola')
      .regex(/[0-9]/, 'Password deve contenere almeno un numero')
      .regex(
        /[^A-Za-z0-9]/,
        'Password deve contenere almeno un carattere speciale'
      )
      .optional()
      .or(z.literal('')), // empty string retains the existing password
    confirmPassword: z.string().optional().or(z.literal('')), // empty string allowed
    isActive: z.boolean(),
  })
  .refine(
    data => {
      // No new password means no confirmation either.
      if (!data.password || data.password.trim() === '') {
        return !data.confirmPassword || data.confirmPassword.trim() === '';
      }
      return data.password === data.confirmPassword;
    },
    {
      message: 'Le password non coincidono',
      path: ['confirmPassword'],
    }
  );

export type CreateUserData = z.infer<typeof CreateUserSchema>;
export type EditUserData = z.infer<typeof EditUserSchema>;
export type UserFormData = CreateUserData | EditUserData;

export type UserFormMode = 'create' | 'edit';

/**
 * Fields an external provider (LDAP) owns: rendered read-only and stripped from the payload.
 *
 * An alias, not a second list. `users.core.update` uses `LockedFields` to *reject* an edit to one
 * of these, so a local copy would be the same allowlist maintained on both sides of the same wire:
 * drift one way and the form strips a field the server would have taken, drift the other and it
 * sends one the server refuses.
 */
export type SyncedField = LockedFields;

/**
 * What actually leaves the form.
 *
 * Every field except `isActive` is optional here, and that is not laziness: `syncedFields` can drop
 * any of them, `confirmPassword` is always removed, and in edit mode a blank password means "keep
 * the one on record" — which has to be an absent key, since sending an empty string would read as
 * "set the password to nothing". The component used to end this path with `as UserFormData`, which
 * claimed the opposite of all three.
 */
export type UserSubmitPayload = Partial<Omit<CreateUserData, 'confirmPassword' | 'isActive'>> & {
  isActive: boolean;
};

export type BuildUserPayloadResult =
  | { ok: true; payload: UserSubmitPayload }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates the form state for the given mode and shapes what should be sent.
 *
 * @param values - Raw form state.
 * @param syncedFields - Fields owned by an external provider, removed from the payload. Required
 *   rather than defaulted: a default would let the argument be dropped at the call site without a
 *   compile error and without a test going red, while LDAP-owned fields started reaching the server.
 * @returns The payload, or the per-field error messages keyed by field name.
 */
export function buildUserPayload(
  mode: UserFormMode,
  values: unknown,
  syncedFields: readonly SyncedField[]
): BuildUserPayloadResult {
  const schema = mode === 'create' ? CreateUserSchema : EditUserSchema;
  const result = schema.safeParse(values);

  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      if (issue.path[0]) errors[issue.path[0] as string] = issue.message;
    }
    return { ok: false, errors };
  }

  const { confirmPassword: _confirmPassword, ...payload } = result.data;

  // Edit mode with the password left blank: the key goes away entirely rather than travelling as
  // an empty string, which `users.core.update` would otherwise try to hash.
  if (mode === 'edit' && (!payload.password || payload.password.trim() === '')) {
    delete (payload as { password?: string }).password;
  }

  for (const field of syncedFields) {
    delete (payload as Record<string, unknown>)[field];
  }

  return { ok: true, payload };
}
