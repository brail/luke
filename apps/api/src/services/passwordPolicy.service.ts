/**
 * Applies the configured password policy.
 *
 * Every path that sets a password goes through here, which is the point: the policy used to be
 * consulted by the password-reset flow alone while `users.core.create`, `users.core.update` and
 * `me.changePassword` each carried their own static copy of the rules. Raising `minLength` left
 * user creation accepting the old one; relaxing a requirement left the self-service change
 * refusing anyway. It failed open in one direction and closed in the other, and each path looked
 * correct on its own.
 *
 * A service rather than a function in `lib/password.ts`: the policy comes from `configManager`,
 * which imports `PasswordPolicy` back from there, and keeping the value import one-directional
 * avoids building a cycle around a type.
 */

import { TRPCError } from '@trpc/server';

import { getPasswordPolicy } from '../lib/configManager';
import { validatePassword, type PasswordValidationResult } from '../lib/password';

import type { PrismaClient } from '@prisma/client';

/**
 * Checks a password against the configured policy and returns why it failed.
 *
 * For callers that need the individual reasons — the reset flow records them in the audit log,
 * since a weak-password attempt there happens before any session exists.
 */
export async function checkPasswordAgainstPolicy(
  prisma: PrismaClient,
  password: string
): Promise<PasswordValidationResult> {
  return validatePassword(password, await getPasswordPolicy(prisma));
}

/**
 * Refuses a password that does not meet the configured policy.
 *
 * @throws {TRPCError} BAD_REQUEST listing every unmet requirement.
 */
export async function assertPasswordMeetsPolicy(
  prisma: PrismaClient,
  password: string
): Promise<void> {
  const { isValid, errors } = await checkPasswordAgainstPolicy(prisma, password);
  if (!isValid) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Password non valida: ${errors.join(', ')}`,
    });
  }
}
