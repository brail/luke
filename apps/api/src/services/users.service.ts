/**
 * User management service — shared business logic for the users router.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hasPermission, type LockedFields, type Role } from '@luke/core';

/** UUID schema for a user ID — shared across sub-routers. */
export const UserIdSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
});

/**
 * Returns the set of user fields that cannot be edited for the given auth provider.
 * LOCAL users have no locked fields; LDAP users have username, name, and password locked.
 */
export function getLockedFields(provider: string): LockedFields[] {
  if (provider === 'LOCAL') {
    return [];
  }
  // Per provider esterni (LDAP, OIDC), blocca i campi sincronizzati
  if (provider === 'LDAP') {
    // Per LDAP: username non modificabile, firstName/lastName sincronizzati, password gestita da LDAP
    return ['username', 'firstName', 'lastName', 'password'];
  }
  // Per altri provider esterni (OIDC), blocca solo i campi sempre sincronizzati
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
  ctx: any;
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

  // Protezione: impedisci auto-eliminazione
  if (user.id === ctx.session.user.id) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Non puoi disattivare il tuo stesso account',
    });
  }

  // Protezione: impedisci eliminazione dell'ultimo admin
  if (hasPermission({ role: user.role as Role }, '*:*')) {
    const adminCount = await ctx.prisma.user.count({
      where: {
        role: 'admin',
        isActive: true,
      },
    });

    if (adminCount <= 1) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: "Non puoi eliminare l'ultimo amministratore del sistema",
      });
    }
  }

  // Soft delete: imposta isActive = false
  const deletedUser = await ctx.prisma.user.update({
    where: { id: input.id },
    data: {
      isActive: false,
      updatedAt: new Date(),
    },
  });

  // Audit logging gestito automaticamente dal middleware withAuditLog

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
