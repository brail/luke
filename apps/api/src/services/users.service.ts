/**
 * User management service — shared business logic for the users router.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hasPermission, UserIdSchema, type Role } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { acquireLastAdminLock, assertNotLastAdminWithSettingsAccess } from '../lib/lastAdminGuard';
import { revokingTransaction } from '../lib/sessionRevocation';

import type { Context } from '../lib/trpc';

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
  const deletedUser = await revokingTransaction(ctx.prisma, async (tx, revoke) => {
    // The guard's lock before the role is read: a role change waits on the same lock, so the role
    // read here is the one the deletion acts on.
    await acquireLastAdminLock(tx);
    const current = await tx.user.findUnique({
      where: { id: input.id },
      select: { role: true },
    });
    // Deleted meanwhile by a hard delete that held the lock first.
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
    if (hasPermission({ role: current.role as Role }, '*:*')) {
      await assertNotLastAdminWithSettingsAccess(
        tx,
        input.id,
        "Non puoi eliminare l'ultimo amministratore del sistema"
      );
    }

    // Conditional write: only an active user is deactivated, so the row below records a real change
    // (#222); an already inactive user still answers as before, with no row.
    const { count } = await tx.user.updateMany({
      where: { id: input.id, isActive: true },
      data: { isActive: false, updatedAt: new Date() },
    });
    // Inactive, the user's sessions are refused: their open tabs sign out now.
    revoke.ended(input.id);
    if (count === 1) {
      await logAudit(ctx, {
        action: 'USER_ACCESS_CHANGED',
        targetType: 'User',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { oldIsActive: true, newIsActive: false },
      }, { tx });
    }
    return tx.user.findUniqueOrThrow({ where: { id: input.id } });
  });

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
