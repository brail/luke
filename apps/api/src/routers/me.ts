/**
 * Router tRPC per operazioni sul profilo utente corrente
 * Gestisce lettura e aggiornamento del profilo personale
 */

import { protectedProcedure, router } from '../lib/trpc';
import { UserProfileSchema, ChangePasswordSchema } from '@luke/core';
import { TRPCError } from '@trpc/server';
import { hashPassword, verifyPassword } from '../lib/password';
import { logAudit } from '../lib/auditLog';

export const meRouter = router({
  /**
   * Ottiene i dati del profilo utente corrente
   * Include informazioni sul provider per determinare campi modificabili
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        locale: true,
        timezone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        identities: {
          select: {
            provider: true,
          },
        },
      },
    });

    if (!user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Utente non trovato',
      });
    }

    // Determina il provider principale (primo identity)
    const provider = user.identities[0]?.provider || 'LOCAL';

    return {
      ...user,
      provider,
      // Rimuovi identities dall'output (non necessario nel frontend)
      identities: undefined,
    };
  }),

  /**
   * Aggiorna il profilo utente corrente
   * Blocca la modifica di campi sincronizzati per provider esterni
   */
  updateProfile: protectedProcedure
    .input(UserProfileSchema)
    .mutation(async ({ ctx, input }) => {
      // Verifica il provider dell'utente
      const userWithProvider = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: {
          id: true,
          identities: {
            select: {
              provider: true,
            },
          },
        },
      });

      if (!userWithProvider) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Utente non trovato',
        });
      }

      const provider = userWithProvider.identities[0]?.provider || 'LOCAL';

      // Per provider esterni (LDAP/OIDC), blocca la modifica di campi sincronizzati
      if (provider !== 'LOCAL') {
        // Verifica se l'utente sta tentando di modificare campi sincronizzati
        const currentUser = await ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
          select: {
            firstName: true,
            lastName: true,
          },
        });

        if (
          currentUser &&
          (input.firstName !== currentUser.firstName ||
            input.lastName !== currentUser.lastName)
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'Nome e cognome sono sincronizzati dal provider esterno e non possono essere modificati',
          });
        }
      }

      // Aggiorna i campi consentiti
      const updated = await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale,
          timezone: input.timezone,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          locale: true,
          timezone: true,
          updatedAt: true,
        },
      });

      // Log audit per l'aggiornamento
      await logAudit(ctx, {
        action: 'me.updateProfile',
        resource: 'user',
        targetUserId: ctx.session.user.id,
        changes: {
          email: { old: userWithProvider.id, new: input.email }, // Placeholder per old value
          firstName: { old: userWithProvider.id, new: input.firstName },
          lastName: { old: userWithProvider.id, new: input.lastName },
          locale: { old: userWithProvider.id, new: input.locale },
          timezone: { old: userWithProvider.id, new: input.timezone },
        },
      });

      return updated;
    }),

  /**
   * Cambia la password dell'utente corrente
   * Disponibile solo per utenti con provider LOCAL
   */
  changePassword: protectedProcedure
    .input(ChangePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      // Verifica che l'utente abbia provider LOCAL
      const userWithProvider = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: {
          id: true,
          identities: {
            select: {
              id: true,
              provider: true,
              localCredential: {
                select: {
                  passwordHash: true,
                },
              },
            },
          },
        },
      });

      if (!userWithProvider) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Utente non trovato',
        });
      }

      const localIdentity = userWithProvider.identities.find(
        identity => identity.provider === 'LOCAL'
      );

      if (!localIdentity || !localIdentity.localCredential) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cambio password non consentito per provider esterni',
        });
      }

      // Verifica la password corrente
      const isCurrentPasswordValid = await verifyPassword(
        input.currentPassword,
        localIdentity.localCredential.passwordHash
      );

      if (!isCurrentPasswordValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Password corrente non valida',
        });
      }

      // Genera hash per la nuova password
      const newPasswordHash = await hashPassword(input.newPassword);

      // Aggiorna la password nel database
      await ctx.prisma.localCredential.update({
        where: { identityId: localIdentity.id },
        data: { passwordHash: newPasswordHash },
      });

      // Log audit per il cambio password
      await logAudit(ctx, {
        action: 'me.changePassword',
        resource: 'user',
        targetUserId: ctx.session.user.id,
        metadata: {
          success: true,
        },
      });

      return { ok: true };
    }),
});
