/**
 * User management service — shared business logic for the users router.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hasPermission, type LockedFields, type Role } from '@luke/core';

import { assertNotLastAdminWithSettingsAccess } from '../lib/lastAdminGuard';
import { invalidateTokenVersionCache } from '../lib/tokenVersionCache';

import type { Context } from '../lib/trpc';
import type { Prisma } from '@prisma/client';

/** UUID schema for a user ID — shared across sub-routers. */
export const UserIdSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
});

/**
 * Resolves the provider to use for lock/display decisions when a user may hold more than one
 * `Identity` (e.g. after `forceLocalAccess` grants a LOCAL identity alongside an existing LDAP
 * one). An external identity always takes precedence over LOCAL: LDAP sync
 * (`ldapAuth.ts::createOrUpdateUser`) keeps overwriting firstName/lastName on every successful
 * LDAP login regardless of whether a LOCAL identity also exists, so those fields must stay
 * locked. Falls back to `'LOCAL'` only when no external identity is present.
 */
export function resolveEffectiveProvider(identities: { provider: string }[]): string {
  return identities.find(i => i.provider !== 'LOCAL')?.provider ?? 'LOCAL';
}

/**
 * Returns the set of user fields that cannot be edited for the given auth provider.
 * LOCAL users have no locked fields; LDAP users have username, name, and password locked.
 */
export function getLockedFields(provider: string): LockedFields[] {
  if (provider === 'LOCAL') {
    return [];
  }
  // For external providers (LDAP, OIDC), lock synchronized fields
  if (provider === 'LDAP') {
    // For LDAP: username immutable, firstName/lastName synchronized, password managed by LDAP
    return ['username', 'firstName', 'lastName', 'password'];
  }
  // For other external providers (OIDC), lock only always-synchronized fields
  return ['firstName', 'lastName', 'password'];
}

/**
 * Soft-deletes a user by setting `isActive = false`.
 * Guards against self-deactivation and deletion of the last admin.
 *
 * @throws {TRPCError} NOT_FOUND if the user does not exist.
 * @throws {TRPCError} FORBIDDEN if the caller targets their own account or the last admin.
 */
export async function deleteUserHandler({
  input,
  ctx,
}: {
  input: z.infer<typeof UserIdSchema>;
  ctx: Context & { session: NonNullable<Context['session']> };
}) {
  const user = await ctx.prisma.user.findUnique({
    where: { id: input.id },
  });

  if (!user) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Utente non trovato',
    });
  }

  // Protection: prevent self-deactivation
  if (user.id === ctx.session.user.id) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Non puoi disattivare il tuo stesso account',
    });
  }

  // Soft delete: sets isActive = false
  const deletedUser = await ctx.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.user.findUnique({
      where: { id: input.id },
      select: { role: true },
    });
    if (current && hasPermission({ role: current.role as Role }, '*:*')) {
      await assertNotLastAdminWithSettingsAccess(
        tx,
        input.id,
        "Non puoi eliminare l'ultimo amministratore del sistema"
      );
    }

    return tx.user.update({
      where: { id: input.id },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });
  });

  invalidateTokenVersionCache(input.id);

  // Audit logging handled automatically by withAuditLog middleware

  return {
    id: deletedUser.id,
    email: deletedUser.email,
    username: deletedUser.username,
    firstName: deletedUser.firstName,
    lastName: deletedUser.lastName,
    role: deletedUser.role,
    isActive: deletedUser.isActive,
    createdAt: deletedUser.createdAt,
    updatedAt: deletedUser.updatedAt,
  };
}
