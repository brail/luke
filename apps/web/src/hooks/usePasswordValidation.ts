'use client';

import { useMemo } from 'react';

import {
  FALLBACK_PASSWORD_POLICY,
  evaluatePassword,
  type ClientPasswordPolicy,
  type PasswordEvaluation,
} from '../lib/passwordChecks';
import { trpc } from '../lib/trpc';

/**
 * The password policy the server will actually apply.
 *
 * Public endpoint: the reset page has no session by definition, and it is the page that most needed
 * this — it announced a hardcoded minimum, showed no complexity requirements, and then relayed a
 * rejection listing rules it had never mentioned.
 *
 * Falls back to the same values the server uses when nothing is configured, so a slow or failed
 * fetch shows the common case rather than the client's own idea of strict.
 */
export function usePasswordPolicy(): ClientPasswordPolicy {
  const { data } = trpc.public.passwordPolicy.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return data ?? FALLBACK_PASSWORD_POLICY;
}

/**
 * Evaluates a password and its confirmation against the configured policy, live.
 *
 * @param confirmPassword - Omit where there is no confirmation field.
 * @returns The requirements to display, the errors, and whether the pair is acceptable. An empty
 *   password is valid: in edit mode it means the existing one stays.
 */
export function usePasswordValidation(
  password: string,
  confirmPassword?: string
): PasswordEvaluation {
  const policy = usePasswordPolicy();
  return useMemo(
    () => evaluatePassword(password, confirmPassword, policy),
    [password, confirmPassword, policy]
  );
}
