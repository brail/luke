/**
 * What a password must satisfy, evaluated against the policy the server actually applies.
 *
 * The checks used to be five hardcoded regexes with five hardcoded messages, written here and
 * again in the form schema and again in `ChangePasswordSchema`. They said 12 characters and "a
 * symbol" whatever the installation had configured, so an admin who relaxed a requirement still saw it
 * demanded, and one who tightened `minLength` saw the old number — and "a symbol" covered
 * characters the server does not accept.
 *
 * Pure and under `src/lib/` on purpose: it is the part worth testing, and the unit tier only
 * collects `src/lib/**`. The hook around it does nothing but fetch the policy.
 */

import {
  DEFAULT_PASSWORD_POLICY,
  PASSWORD_SPECIAL_CHARS,
  checkPassword,
  type PasswordPolicy,
  type PasswordRequirementKey,
} from '@luke/core';

/**
 * The policy as the client receives it from `public.passwordPolicy`: what the server enforces, plus
 * the characters it counts as special so the UI can name them instead of saying "a symbol".
 */
export type ClientPasswordPolicy = PasswordPolicy & { specialChars: string };

/**
 * Used until the policy arrives, and if it never does.
 *
 * The same values `getPasswordPolicy` falls back to server-side when nothing is configured, so the
 * two agree on the unconfigured case rather than the client inventing its own idea of "strict".
 */
export const FALLBACK_PASSWORD_POLICY: ClientPasswordPolicy = {
  ...DEFAULT_PASSWORD_POLICY,
  specialChars: PASSWORD_SPECIAL_CHARS,
};

export interface PasswordCheck {
  key: PasswordRequirementKey | 'match';
  /** What to show the user, already phrased with the configured values. */
  label: string;
  met: boolean;
}

export interface PasswordEvaluation {
  /** Only the requirements the policy actually asks for; a disabled one is absent, not unmet. */
  checks: PasswordCheck[];
  errors: string[];
  confirmError: string;
  isValid: boolean;
}

/** The text for each requirement, phrased with the configured values. Only the wording is here. */
function labelFor(key: PasswordRequirementKey, policy: ClientPasswordPolicy): string {
  switch (key) {
    case 'length':
      return `Almeno ${policy.minLength} caratteri`;
    case 'uppercase':
      return 'Una lettera maiuscola';
    case 'lowercase':
      return 'Una lettera minuscola';
    case 'digit':
      return 'Un numero';
    case 'special':
      // Named, not "a symbol": the set is an allowlist, so `~` or a space look acceptable under a
      // vaguer label and are refused on submit.
      return `Un carattere fra ${policy.specialChars}`;
  }
}

/**
 * Evaluates a password, and its confirmation, against the configured policy.
 *
 * The verdict comes from `checkPassword` in `@luke/core` — the same function the server validates
 * with — so the two cannot disagree about what a password must contain. What is client-side is the
 * wording and the confirmation field, which the server has no opinion about.
 *
 * @param confirmPassword - Pass `undefined` where there is no confirmation field.
 */
export function evaluatePassword(
  password: string,
  confirmPassword: string | undefined,
  policy: ClientPasswordPolicy
): PasswordEvaluation {
  const checks: PasswordCheck[] = checkPassword(password, policy).map(r => ({
    key: r.key,
    label: labelFor(r.key, policy),
    met: r.met,
  }));

  if (confirmPassword !== undefined) {
    checks.push({
      key: 'match',
      label: 'Le password coincidono',
      met: password === confirmPassword && confirmPassword.length > 0,
    });
  }

  const confirmError =
    confirmPassword && password !== confirmPassword ? 'Le password non coincidono' : '';

  // `errors` and `isValid` share one list, so `!isValid` always implies something to show. They did
  // not: `errors` skipped the `match` check while `isValid` counted it, and the reset page rendered
  // "Password non valida: " with nothing after the colon.
  const errors = checks.filter(c => !c.met).map(c => c.label);

  return {
    checks,
    errors,
    confirmError,
    // No exemption for an empty password. Only the reset page reads this verdict, and there an empty
    // password is not valid; "blank means keep the existing one" is an edit-mode rule owned by
    // `EditUserSchema` and `buildUserPayload`.
    isValid: errors.length === 0 && !confirmError,
  };
}
