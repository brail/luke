/**
 * What a password must satisfy, evaluated against the policy the server actually applies.
 *
 * The checks used to be five hardcoded regexes with five hardcoded messages, written here and
 * again in the form schema and again on the reset page. They said 12 characters and "a symbol"
 * whatever the installation had configured, so an admin who relaxed a requirement still saw it
 * demanded, and one who tightened `minLength` saw the old number — and "a symbol" covered
 * characters the server does not accept.
 *
 * Pure and under `src/lib/` on purpose: it is the part worth testing, and the unit tier only
 * collects `src/lib/**`. The hook around it does nothing but fetch the policy.
 */

/** The policy as the client receives it from `public.passwordPolicy`. */
export interface ClientPasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
  /** The exact characters that count as special, so the UI can name them. */
  specialChars: string;
}

/**
 * Used until the policy arrives, and if it never does.
 *
 * The same values `getPasswordPolicy` falls back to server-side when nothing is configured, so the
 * two agree on the unconfigured case rather than the client inventing its own idea of "strict".
 */
export const FALLBACK_PASSWORD_POLICY: ClientPasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecialChar: true,
  specialChars: '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?',
};

export interface PasswordCheck {
  key: 'length' | 'uppercase' | 'lowercase' | 'digit' | 'special' | 'match';
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

function containsSpecial(password: string, specialChars: string): boolean {
  return [...password].some(ch => specialChars.includes(ch));
}

/**
 * Evaluates a password, and its confirmation, against the configured policy.
 *
 * @param confirmPassword - Pass `undefined` where there is no confirmation field.
 * @returns The requirements to display, the errors, and whether the pair is acceptable. An empty
 *   password is valid: in edit mode it means "keep the existing one".
 */
export function evaluatePassword(
  password: string,
  confirmPassword: string | undefined,
  policy: ClientPasswordPolicy
): PasswordEvaluation {
  const checks: PasswordCheck[] = [
    {
      key: 'length',
      label: `Almeno ${policy.minLength} caratteri`,
      met: password.length >= policy.minLength,
    },
  ];

  if (policy.requireUppercase) {
    checks.push({ key: 'uppercase', label: 'Una lettera maiuscola', met: /[A-Z]/.test(password) });
  }
  if (policy.requireLowercase) {
    checks.push({ key: 'lowercase', label: 'Una lettera minuscola', met: /[a-z]/.test(password) });
  }
  if (policy.requireDigit) {
    checks.push({ key: 'digit', label: 'Un numero', met: /[0-9]/.test(password) });
  }
  if (policy.requireSpecialChar) {
    checks.push({
      // Naming the characters rather than saying "a symbol": the set is an allowlist, so `~` or a
      // space look acceptable under a vaguer label and are refused on submit.
      key: 'special',
      label: `Un carattere fra ${policy.specialChars}`,
      met: containsSpecial(password, policy.specialChars),
    });
  }

  if (confirmPassword !== undefined) {
    checks.push({
      key: 'match',
      label: 'Le password coincidono',
      met: password === confirmPassword && confirmPassword.length > 0,
    });
  }

  const confirmError =
    confirmPassword && password !== confirmPassword ? 'Le password non coincidono' : '';

  // An empty password is not "failing every requirement": in edit mode it means the existing one
  // stays, so it reports no errors and no verdict.
  const errors = password.length === 0
    ? []
    : checks.filter(c => c.key !== 'match' && !c.met).map(c => c.label);

  return {
    checks,
    errors,
    confirmError,
    isValid: password.length === 0 || (checks.every(c => c.met) && !confirmError),
  };
}
