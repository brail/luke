/**
 * Admin procedures per utenti
 * revokeUserSessions, forceVerifyEmail, changeEmail
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logAudit } from '../lib/auditLog';
import { withAuditLog } from '../lib/auditMiddleware';
import { getConfig } from '../lib/configManager';
import { sendVerificationEmail } from '../lib/emailHelpers';
import { sendAccountApprovedEmail } from '../lib/mailer';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure, invalidateTokenVersionCache } from '../lib/trpc';
import { UserIdSchema } from '../services/users.service';

export const usersAdminRouter = router({
  /**
   * Lista utenti LDAP in attesa di approvazione admin
   * Richiede permission users:read
   */
  listPending: protectedProcedure
    .use(requirePermission('users:read'))
    .query(async ({ ctx }) => {
      const users = await ctx.prisma.user.findMany({
        where: {
          isActive: true,
          pendingApproval: true,
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
          identities: {
            select: { provider: true, providerId: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      return { users, total: users.length };
    }),

  /**
   * Approva un utente LDAP in attesa — abilita l'accesso
   * Richiede permission users:update
   */
  approvePending: protectedProcedure
    .use(requirePermission('users:update'))
    .use(withAuditLog('USER_APPROVED', 'User'))
    .input(UserIdSchema)
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
      });

      if (!user || !user.pendingApproval) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente in attesa non trovato',
        });
      }

      await ctx.prisma.user.update({
        where: { id: input.id },
        data: { pendingApproval: false },
      });

      // Invia email di notifica attivazione (solo se email non sintetica)
      if (!user.email.endsWith('@ldap.local')) {
        try {
          const baseUrl =
            (await getConfig(ctx.prisma, 'app.baseUrl', false)) ||
            'http://localhost:3000';
          await sendAccountApprovedEmail(
            ctx.prisma,
            user.email,
            user.firstName,
            baseUrl
          );
        } catch {
          ctx.logger.warn(
            { userId: user.id },
            'Failed to send account approved email'
          );
        }
      }

      return { success: true, message: `Utente ${user.username} approvato` };
    }),

  /**
   * Rifiuta e rimuove un utente LDAP in attesa
   * Richiede permission users:delete
   */
  rejectPending: protectedProcedure
    .use(requirePermission('users:delete'))
    .input(UserIdSchema)
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
      });

      if (!user || !user.pendingApproval) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente in attesa non trovato',
        });
      }

      await ctx.prisma.user.delete({ where: { id: input.id } });

      await logAudit(ctx, {
        action: 'USER_REJECTED',
        targetType: 'User',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {
          deletedUsername: user.username,
          deletedEmail: user.email,
        },
      });

      return { success: true, message: `Utente ${user.username} rifiutato ed eliminato` };
    }),


  /**
   * Revoca tutte le sessioni di un utente specifico
   * Richiede permission users:update
   */
  revokeUserSessions: protectedProcedure
    .use(requirePermission('users:update'))
    .use(withAuditLog('USER_REVOKE_SESSIONS', 'User'))
    .input(UserIdSchema)
    .mutation(async ({ ctx, input }) => {
      // Verifica che l'utente esista
      const targetUser = await ctx.prisma.user.findUnique({
        where: { id: input.id },
        select: { id: true, email: true, firstName: true, lastName: true },
      });

      if (!targetUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente non trovato',
        });
      }

      // Protezione: impedisci auto-revoca (usa me.revokeAllSessions invece)
      if (targetUser.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Non puoi revocare le tue stesse sessioni da qui. Usa il profilo personale.',
        });
      }

      // Incrementa tokenVersion per invalidare tutte le sessioni dell'utente
      await ctx.prisma.user.update({
        where: { id: input.id },
        data: { tokenVersion: { increment: 1 } },
      });

      // Invalida la cache tokenVersion per questo utente
      invalidateTokenVersionCache(input.id);

      // Audit logging gestito automaticamente dal middleware withAuditLog

      return {
        success: true,
        message: `Sessioni revocate per ${targetUser.firstName} ${targetUser.lastName}`,
      };
    }),

  /**
   * Forza verifica email per un utente (admin only)
   * Imposta o rimuove emailVerifiedAt bypassando il token
   * Richiede permission users:update
   */
  forceVerifyEmail: protectedProcedure
    .use(requirePermission('users:update'))
    .use(withAuditLog('EMAIL_VERIFICATION_FORCED', 'User'))
    .input(
      z.object({
        userId: z.string().uuid(),
        verified: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { userId, verified } = input;

      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente non trovato',
        });
      }

      await ctx.prisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: verified ? new Date() : null },
      });

      return {
        success: true,
        message: verified ? 'Email verificata' : 'Verifica rimossa',
      };
    }),

  /**
   * Cambio email per utente autenticato
   * Reset automatico di emailVerifiedAt + invio email verifica
   * Richiede permission users:update
   */
  changeEmail: protectedProcedure
    .use(requirePermission('users:update'))
    .use(withRateLimit('userMutations'))
    .input(
      z.object({
        newEmail: z.string().email('Email non valida').toLowerCase().trim(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { newEmail } = input;
      const userId = ctx.session.user.id;

      // Verifica unicità email
      const existing = await ctx.prisma.user.findFirst({
        where: { email: newEmail, id: { not: userId } },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Email già in uso',
        });
      }

      // Aggiorna email + reset verification
      await ctx.prisma.user.update({
        where: { id: userId },
        data: { email: newEmail, emailVerifiedAt: null },
      });

      // Audit EMAIL_CHANGED (senza PII)
      await logAudit(ctx, {
        action: 'EMAIL_CHANGED',
        targetType: 'User',
        targetId: userId,
        result: 'SUCCESS',
        metadata: {},
      });

      // Invia verifica usando helper DRY
      try {
        await sendVerificationEmail(
          ctx.prisma,
          {
            userId,
            reason: 'email_changed',
            actorId: userId,
          },
          ctx
        );

        return {
          success: true,
          message:
            'Email aggiornata. Controlla la nuova casella per verificarla.',
        };
      } catch {
        return {
          success: true,
          message:
            'Email aggiornata ma invio verifica fallito. Richiedi un nuovo link.',
        };
      }
    }),
});
