/**
 * tRPC router for authentication
 * Handles login, logout, and session verification
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

import { logAudit } from '../lib/auditLog';
import { createToken } from '../lib/auth';
import { sendVerificationEmail } from '../lib/emailHelpers';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { isSyntheticLdapEmail } from '../lib/ldapAuth';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from '../lib/trpc';
import {
  authenticateUser,
  logoutAllSessions,
  requestPasswordReset,
  confirmPasswordReset,
  requestEmailVerification,
  confirmEmailVerification,
} from '../services/auth.service';

/**
 * Masks an email address for exposure from an unauthenticated public endpoint
 * (e.g. `a***@luke.com`), keeping the domain visible for recognizability.
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local[0]}***@${domain}`;
}

/**
 * Login schema
 */
const LoginSchema = z.object({
  username: z.string().min(1, 'Username richiesto'),
  password: z.string().min(1, 'Password richiesta'),
});

/**
 * Authentication router
 */
export const authRouter = router({
  /**
   * Authenticates a user using the configured strategy (local-first, ldap-first, etc.).
   *
   * @auth {public}
   * @input {LoginSchema} — username and password.
   * @output {Session token and user info as returned by authenticateUser().}
   */
  login: publicProcedure
    .use(withRateLimit('login'))
    .input(LoginSchema)
    .use(withIdempotency())
    .mutation(async ({ input, ctx }) => {
      return await authenticateUser(ctx, input);
    }),

  /**
   * Logs out the current session; cookie removal is handled by NextAuth on the web layer.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ success: true, message: string }}
   */
  logout: protectedProcedure.mutation(async ({ ctx: _ctx }) => {
    // Cookie API removed: Web handles logout via NextAuth signOut()
    return { success: true, message: 'Logout effettuato con successo' };
  }),

  /**
   * Invalidates all sessions for the current user by incrementing tokenVersion.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {Result from logoutAllSessions().}
   */
  logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
    return await logoutAllSessions(ctx);
  }),

  /**
   * Returns the current authenticated user's session info.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ user: SessionUser }} — user object from the current session.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // The session is already verified by the middleware
    return {
      user: ctx.session.user,
    };
  }),

  /**
   * Re-mints a fresh API access token for the current session.
   * `protectedProcedure` already validates the Bearer (expired → UNAUTHORIZED) and the
   * `tokenVersion` (revoked → UNAUTHORIZED): the web callback uses it to
   * renew the embedded accessToken before it expires, preventing a still-valid
   * NextAuth session from sending an expired API JWT (`jwt expired`).
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ token: string, tokenVersion: number }}
   */
  refreshToken: protectedProcedure.mutation(async ({ ctx }) => {
    // Role and tokenVersion are re-read from the database, not from the session claim.
    // Re-signing from the claim turned refresh into an authority recycle: a
    // demoted user would endlessly renew a token that still said
    // `role: "admin"`, because the source of the new token was the old token.
    const fresh = await ctx.prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: {
        email: true,
        username: true,
        role: true,
        tokenVersion: true,
        isActive: true,
      },
    });

    if (!fresh || !fresh.isActive) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Sessione non più valida',
      });
    }

    const token = createToken({
      id: ctx.session.user.id,
      email: fresh.email,
      username: fresh.username,
      role: fresh.role,
      tokenVersion: fresh.tokenVersion,
    });
    return { token, tokenVersion: fresh.tokenVersion };
  }),

  /**
   * Generates a password-reset token and sends the reset link by email.
   *
   * @auth {public}
   * @input {RequestPasswordResetSchema} — user email address.
   * @output {Success confirmation (always, to prevent email enumeration).}
   */
  requestPasswordReset: publicProcedure
    .use(withRateLimit('passwordReset'))
    .input(RequestPasswordResetSchema)
    .mutation(async ({ input, ctx }) => {
      return await requestPasswordReset(ctx, input.email);
    }),

  /**
   * Validates the reset token and sets the new password.
   *
   * @auth {public}
   * @input {ConfirmPasswordResetSchema} — token and newPassword.
   * @output {Success confirmation.}
   */
  confirmPasswordReset: publicProcedure
    .use(withRateLimit('passwordReset'))
    .input(ConfirmPasswordResetSchema)
    .mutation(async ({ input, ctx }) => {
      // confirmPasswordReset accepts { token, newPassword } and ctx
      return await confirmPasswordReset(ctx, input);
    }),

  /**
   * Generates an email-verification token and sends the verification link.
   *
   * @auth {public}
   * @input {RequestEmailVerificationSchema} — email address to verify.
   * @output {Success confirmation.}
   */
  requestEmailVerification: publicProcedure
    .use(withRateLimit('passwordReset')) // Uses the same policy
    .input(RequestEmailVerificationSchema)
    .mutation(async ({ input, ctx }) => {
      return await requestEmailVerification(ctx, input.email);
    }),

  /**
   * Validates the email-verification token and marks the address as verified.
   *
   * @auth {public}
   * @input {ConfirmEmailVerificationSchema} — verification token.
   * @output {Success confirmation.}
   */
  confirmEmailVerification: publicProcedure
    .use(withRateLimit('passwordReset'))
    .input(ConfirmEmailVerificationSchema)
    .mutation(async ({ input, ctx }) => {
      return await confirmEmailVerification(ctx, input);
    }),

  /**
   * Checks whether a username belongs to an LDAP user awaiting admin approval.
   *
   * @auth {public}
   * @input {{ username: string }} — username to check.
   * @output {{ isPending: boolean, needsEmail: boolean, maskedEmail: string | null }} — pending status,
   *   whether a real email is needed, and (if not) the masked address the verification mail was sent to.
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

      if (!user) return { isPending: false, needsEmail: false, maskedEmail: null };

      const needsEmail = isSyntheticLdapEmail(user.email);

      return {
        isPending: true,
        needsEmail,
        maskedEmail: needsEmail ? null : maskEmail(user.email),
      };
    }),

  /**
   * Saves a real email for an LDAP pending user and sends the verification email.
   *
   * @auth {public}
   * @input {{ username: string, email: string }} — LDAP username and the email to register.
   * @output {{ success: true }}
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

      // Find LDAP user pending approval
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
        // Generic response to prevent enumeration
        return { success: true };
      }

      // Check email uniqueness (excludes the user itself)
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

      // Send verification email to the address just provided
      try {
        await sendVerificationEmail(
          ctx.prisma,
          { userId: user.id, reason: 'user_requested' },
          ctx
        );
      } catch {
        // Don't block the response if SMTP isn't configured
        ctx.logger.warn({ username }, 'Failed to send verification email for pending user');
      }

      return { success: true };
    }),

  /**
   * Admin-triggered email verification for a specific user by userId.
   *
   * @auth {users:update (admin)}
   * @input {RequestEmailVerificationAdminSchema} — userId of the target user.
   * @output {Result from sendVerificationEmail().}
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
          cause: error,
        });
      }
    }),
});
