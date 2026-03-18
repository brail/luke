/**
 * Service per gestione utenti
 * Contiene logica di business comune per il router users
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { type LockedFields } from '@luke/core';

/**
 * Schema per ID utente — condiviso tra i sub-router
 */
export const UserIdSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
});

/**
 * Helper per determinare i campi bloccati in base al provider
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
 * Handler comune per soft delete utente
 * Imposta isActive = false invece di eliminare il record
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
  if (user.role === 'admin') {
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
