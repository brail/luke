/**
 * Router tRPC per operazioni sul profilo utente corrente
 * Gestisce lettura e aggiornamento del profilo personale
 */

import {
  protectedProcedure,
  router,
  invalidateTokenVersionCache,
} from '../lib/trpc';
import {
  UserProfileSchema,
  ChangePasswordSchema,
  UpdateTimezoneSchema,
} from '@luke/core';
import { TRPCError } from '@trpc/server';
import { hashPassword, verifyPassword } from '../lib/password';
import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { z } from 'zod';

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
        lastLoginAt: true,
        loginCount: true,
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

    // Calcola percentuale completamento profilo
    const profileCompletion = calculateProfileCompletion({
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      timezone: user.timezone,
    });

    return {
      ...user,
      provider,
      profileCompletion,
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
          // Aggiorna lastLoginAt quando cambia timezone per mostrare la differenza
          lastLoginAt: new Date(),
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
    .use(withRateLimit('passwordChange'))
    .use(withIdempotency())
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

      // Verifica che la nuova password non sia uguale alla password attuale
      const isSamePassword = await verifyPassword(
        input.newPassword,
        localIdentity.localCredential.passwordHash
      );

      if (isSamePassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'La nuova password deve essere diversa dalla password attuale',
        });
      }

      // Genera hash per la nuova password
      const newPasswordHash = await hashPassword(input.newPassword);

      // Aggiorna la password e incrementa tokenVersion in transazione
      await ctx.prisma.$transaction(async trx => {
        // Aggiorna password hash
        await trx.localCredential.update({
          where: { identityId: localIdentity.id },
          data: { passwordHash: newPasswordHash },
        });

        // Incrementa tokenVersion per invalidare tutte le sessioni precedenti
        await trx.user.update({
          where: { id: ctx.session.user.id },
          data: { tokenVersion: { increment: 1 } },
        });
      });

      // Invalida la cache tokenVersion per questo utente
      invalidateTokenVersionCache(ctx.session.user.id);

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

  /**
   * Ottiene la cronologia degli accessi dell'utente corrente
   * Utilizza AuditLog per recuperare i login recenti
   */
  loginHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const logs = await ctx.prisma.auditLog.findMany({
        where: {
          userId: ctx.session.user.id,
          action: { in: ['login', 'login_failed'] },
        },
        orderBy: { timestamp: 'desc' },
        take: input?.limit || 10,
      });

      return logs.map(log => ({
        id: log.id,
        timestamp: log.timestamp,
        success: log.action === 'login',
        ipAddress: log.ipAddress,
        // Estrai location da metadata se disponibile
        location: (log.metadata as any)?.location || 'Unknown',
      }));
    }),

  /**
   * Revoca tutte le sessioni dell'utente corrente
   * Incrementa tokenVersion per invalidare tutti i token esistenti
   */
  revokeAllSessions: protectedProcedure.mutation(async ({ ctx }) => {
    // Incrementa tokenVersion per invalidare tutte le sessioni
    await ctx.prisma.user.update({
      where: { id: ctx.session.user.id },
      data: { tokenVersion: { increment: 1 } },
    });

    // Invalida la cache tokenVersion per questo utente
    invalidateTokenVersionCache(ctx.session.user.id);

    // Log audit
    await logAudit(ctx, {
      action: 'revoke_all_sessions',
      resource: 'security',
      targetUserId: ctx.session.user.id,
      metadata: {
        success: true,
      },
    });

    return { success: true };
  }),

  /**
   * Aggiorna solo il timezone dell'utente
   * Endpoint specifico per aggiornamenti parziali del timezone
   */
  updateTimezone: protectedProcedure
    .input(UpdateTimezoneSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: {
          timezone: input.timezone,
          // Aggiorna lastLoginAt quando cambia timezone per mostrare la differenza
          lastLoginAt: new Date(),
        },
        select: {
          id: true,
          timezone: true,
          updatedAt: true,
        },
      });

      // Log audit
      await logAudit(ctx, {
        action: 'update_timezone',
        resource: 'user',
        targetUserId: ctx.session.user.id,
        metadata: {
          newTimezone: input.timezone,
        },
      });

      return updated;
    }),
});

/**
 * Calcola la percentuale di completamento del profilo utente
 */
function calculateProfileCompletion(profile: {
  firstName: string;
  lastName: string;
  locale: string;
  timezone: string;
}): number {
  const fields = [
    profile.firstName,
    profile.lastName,
    profile.locale,
    profile.timezone,
  ];

  const completedFields = fields.filter(
    field => field && field.trim() !== ''
  ).length;
  return Math.round((completedFields / fields.length) * 100);
}
