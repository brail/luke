import { z } from 'zod';

/**
 * The one description of what a password must look like, shared by the server that enforces it and
 * the client that has to tell the user about it.
 *
 * It exists because the two disagreed. The server counts as special only the characters below,
 * while the form schema, the indicator hook and `ChangePasswordSchema` all asked for "any
 * non-alphanumeric" — so a password with `~`, a backtick or a space earned a row of green ticks and
 * a rejection. (The reset page is a separate case: it asked for no complexity at all.)
 */

/**
 * Characters that satisfy the "special character" requirement.
 *
 * An explicit allowlist rather than "not a letter or a digit": it is the set the server has always
 * enforced, and widening it silently at the moment the policy became authoritative would have
 * relaxed the reset path for every existing installation. Listed as a string so a UI can show the
 * user exactly which characters count, instead of the word "symbol".
 */
export const PASSWORD_SPECIAL_CHARS = '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?';

/**
 * Matches a password containing at least one character from {@link PASSWORD_SPECIAL_CHARS}.
 *
 * Built from the constant so the two cannot drift; the escapes cover the characters that carry
 * meaning inside a character class.
 */
export const PASSWORD_SPECIAL_CHAR_REGEX = new RegExp(
  `[${PASSWORD_SPECIAL_CHARS.replace(/[\\\]^-]/g, '\\$&')}]`
);

/**
 * The static check every password input applies before the configured policy runs.
 *
 * Deliberately not the policy: complexity and the real minimum live in AppConfig and are applied
 * server-side by `validatePassword`, because a schema compiled into the bundle cannot know what an
 * installation configured. What stays here is only what is true regardless — 8 is the floor
 * `AppConfigRegistry` refuses to go below, and 128 caps what gets handed to argon2.
 *
 * These schemas used to carry `min(12)` and, in one of the three, four complexity regexes. That was
 * the divergence: raising the configured minimum left them accepting the old one, and relaxing a
 * configured requirement left them refusing anyway.
 */
export const passwordPrefilterSchema = z
  .string()
  .min(8, 'Password deve essere di almeno 8 caratteri')
  .max(128, 'Password troppo lunga');

/**
 * Password complexity requirements, as configured in AppConfig.
 *
 * Here rather than beside the server's hashing utilities because both sides need it: the server to
 * enforce it, the client to tell the user what will be asked of them.
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
}

/**
 * What `getPasswordPolicy` returns when nothing is configured, and what a client shows until the
 * policy arrives.
 *
 * One declaration for a default that used to be written three times — in the per-key `.catch()`
 * fallbacks, in the seed, and in the browser. The seed copy is the one an installation actually
 * runs on, so a drift between them was not cosmetic.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecialChar: true,
};

/** Which requirement a check refers to. Stable across languages; the text is the caller's. */
export type PasswordRequirementKey = 'length' | 'uppercase' | 'lowercase' | 'digit' | 'special';

export interface PasswordRequirement {
  key: PasswordRequirementKey;
  met: boolean;
}

/**
 * Evaluates a password against the policy, once.
 *
 * Returns keys rather than messages, which is what lets both sides share it: the server turns an
 * unmet key into an error string, the client into a checklist label, and neither has to agree with
 * the other about wording. The five predicates themselves used to be written twice — the same four
 * regexes in `apps/api` and in `apps/web`, plus two different mechanisms for the symbol class (a
 * compiled RegExp against a per-character scan), which is the kind of pair that drifts while both
 * halves still look right.
 *
 * Requirements the policy does not ask for are absent, not unmet: a caller rendering this must not
 * show a tick that can never turn green.
 */
export function checkPassword(password: string, policy: PasswordPolicy): PasswordRequirement[] {
  const requirements: PasswordRequirement[] = [
    { key: 'length', met: password.length >= policy.minLength },
  ];
  if (policy.requireUppercase) requirements.push({ key: 'uppercase', met: /[A-Z]/.test(password) });
  if (policy.requireLowercase) requirements.push({ key: 'lowercase', met: /[a-z]/.test(password) });
  if (policy.requireDigit) requirements.push({ key: 'digit', met: /[0-9]/.test(password) });
  if (policy.requireSpecialChar) {
    requirements.push({ key: 'special', met: PASSWORD_SPECIAL_CHAR_REGEX.test(password) });
  }
  return requirements;
}
