/**
 * Router tRPC per autenticazione
 * Gestisce login, logout e verifica sessione
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  RequestPasswordResetSchema,
  ConfirmPasswordResetSchema,
  RequestEmailVerificationSchema,
  ConfirmEmailVerificationSchema,
  RequestEmailVerificationAdminSchema,
} from '@luke/core';

import {
  authenticateUser,
  logoutAllSessions,
  requestPasswordReset,
  confirmPasswordReset,
  requestEmailVerification,
  confirmEmailVerification,
} from '../services/auth.service';
import { logAudit } from '../lib/auditLog';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { withRateLimit } from '../lib/ratelimit';
import { requirePermission } from '../lib/permissions';
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from '../lib/trpc';
import { sendVerificationEmail } from '../lib/emailHelpers';

/**
 * Schema per login
 */
const LoginSchema = z.object({
  username: z.string().min(1, 'Username richiesto'),
  password: z.string().min(1, 'Password richiesta'),
});

/**
 * Router per autenticazione
 */
export const authRouter = router({
  /**
   * Login utente con fallback LDAP configurabile
   */
  login: publicProcedure
    .use(withRateLimit('login'))
    .use(withIdempotency())
    .input(LoginSchema)
    .mutation(async ({ input, ctx }) => {
      return await authenticateUser(ctx, input);
    }),

  /**
   * Logout utente (soft logout)
   * Rimuove solo la sessione corrente, mantiene altre sessioni attive
   */
  logout: protectedProcedure.mutation(async ({ ctx: _ctx }) => {
    // Cookie API rimosso: Web gestisce logout tramite NextAuth signOut()
    return { success: true, message: 'Logout effettuato con successo' };
  }),

  /**
   * Logout hard - Revoca tutte le sessioni dell'utente
   * Invalida tokenVersion per forzare re-login su tutti i dispositivi
   */
  logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
    return await logoutAllSessions(ctx);
  }),

  /**
   * Verifica sessione corrente
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // La sessione è già verificata dal middleware
    return {
      user: ctx.session.user,
    };
  }),

  /**
   * Richiesta reset password
   * Genera token e invia email con link di reset
   */
  requestPasswordReset: publicProcedure
    .use(withRateLimit('passwordReset'))
    .input(RequestPasswordResetSchema)
    .mutation(async ({ input, ctx }) => {
      return await requestPasswordReset(ctx, input.email);
    }),

  /**
   * Conferma reset password
   * Valida token e aggiorna password
   */
  confirmPasswordReset: publicProcedure
    .input(ConfirmPasswordResetSchema)
    .mutation(async ({ input, ctx }) => {
      // confirmPasswordReset accetta { token, newPassword } e il ctx
      return await confirmPasswordReset(ctx, input);
    }),

  /**
   * Richiesta verifica email
   * Genera token e invia email con link di verifica
   */
  requestEmailVerification: publicProcedure
    .use(withRateLimit('passwordReset')) // Usa stessa policy
    .input(RequestEmailVerificationSchema)
    .mutation(async ({ input, ctx }) => {
      return await requestEmailVerification(ctx, input.email);
    }),

  /**
   * Conferma verifica email
   * Valida token e marca email come verificata
   */
  confirmEmailVerification: publicProcedure
    .input(ConfirmEmailVerificationSchema)
    .mutation(async ({ input, ctx }) => {
      return await confirmEmailVerification(ctx, input);
    }),

  /**
   * Controlla se un username corrisponde a un utente LDAP in attesa di approvazione.
   * Usato dal login page dopo un CredentialsSignin fallito per distinguere
   * "credenziali errate" da "account pending". Non richiede password.
   */
  getPendingStatus: publicProcedure
    .use(withRateLimit('pendingEmail'))
    .input(z.object({ username: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const user = await ctx.prisma.user.findFirst({
        where: {
          username: input.username,
          isActive: true,
          pendingApproval: true,
        },
        select: { email: true },
      });

      if (!user) return { isPending: false, needsEmail: false };

      return {
        isPending: true,
        needsEmail: user.email.endsWith('@ldap.local'),
      };
    }),

  /**
   * Salva l'email fornita da un utente LDAP in attesa di approvazione
   * Endpoint pubblico — usato dalla pagina /auth/pending
   */
  submitPendingEmail: publicProcedure
    .use(withRateLimit('pendingEmail'))
    .input(
      z.object({
        username: z.string().min(1),
        email: z.string().email('Email non valida').toLowerCase().trim(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { username, email } = input;

      // Trova utente LDAP in attesa di approvazione
      const user = await ctx.prisma.user.findFirst({
        where: {
          username,
          isActive: true,
          pendingApproval: true,
        },
        include: {
          identities: { where: { provider: 'LDAP' } },
        },
      });

      if (!user || user.identities.length === 0) {
        // Risposta generica per evitare enumerazione
        return { success: true };
      }

      // Verifica unicità email (esclude l'utente stesso)
      const existing = await ctx.prisma.user.findFirst({
        where: { email, id: { not: user.id } },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Email già in uso da un altro account',
        });
      }

      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { email },
      });

      await logAudit(ctx, {
        action: 'PENDING_USER_EMAIL_SUBMITTED',
        targetType: 'User',
        targetId: user.id,
        result: 'SUCCESS',
        metadata: { username },
      });

      // Invia email di verifica all'indirizzo appena fornito
      try {
        await sendVerificationEmail(
          ctx.prisma,
          { userId: user.id, reason: 'user_requested' },
          ctx
        );
      } catch {
        // Non bloccare la risposta se SMTP non è configurato
        ctx.logger.warn({ username }, 'Failed to send verification email for pending user');
      }

      return { success: true };
    }),

  /**
   * Richiesta verifica email da admin (by userId)
   * Usa helper DRY per evitare duplicazione codice
   */
  requestEmailVerificationAdmin: adminProcedure
    .use(requirePermission('users:update'))
    .use(withRateLimit('userMutations'))
    .input(RequestEmailVerificationAdminSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId } = input;

      try {
        const result = await sendVerificationEmail(
          ctx.prisma,
          {
            userId,
            reason: 'admin_initiated',
            actorId: ctx.session.user.id,
          },
          ctx
        );

        return result;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            error instanceof Error ? error.message : 'Errore invio email',
        });
      }
    }),
});
