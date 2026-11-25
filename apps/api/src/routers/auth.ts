/**
 * tRPC router for authentication
 * Handles login, API token refresh, logout, password reset, email verification and the LDAP
 * pending-approval email flow. Logout ends the caller's API sessions; the web then calls Auth.js
 * `signOut()`.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  RequestPasswordResetSchema,
  ConfirmPasswordResetSchema,
  ConfirmEmailVerificationSchema,
  RequestEmailVerificationAdminSchema,
  SubmitPendingEmailSchema,
  isSyntheticLdapEmail,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { createToken } from '../lib/auth';
import { moveUserEmail, sendVerificationEmail } from '../lib/emailHelpers';
import { isUniqueViolation, SessionEndedError } from '../lib/error';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { revokingTransaction } from '../lib/sessionRevocation';
import {
  router,
  protectedProcedure,
  publicProcedure,
  selfProcedure,
} from '../lib/trpc';
import {
  authenticateUser,
  requestPasswordReset,
  confirmPasswordReset,
  confirmEmailVerification,
  verifyCredentials,
} from '../services/auth.service';

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
    // Public: no session yet, so the key is not scoped to a user.
    .use(withIdempotency({ scope: 'anonymous' }))
    .mutation(async ({ input, ctx }) => {
      return await authenticateUser(ctx, input);
    }),

  /**
   * Re-mints a fresh API access token for the current session.
   * `selfProcedure` — a `protectedProcedure` — already validates the Bearer
   * (expired, or past its absolute lifetime → UNAUTHORIZED) and the `tokenVersion`
   * (revoked → UNAUTHORIZED): the web callback uses it to
   * renew the embedded accessToken before it expires, preventing a still-valid
   * NextAuth session from sending an expired API JWT (`jwt expired`). The new token keeps the
   * bearer's `authTime`, so refreshing never extends the session past 12 h from its login.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ token: string, tokenVersion: number }}
   * @throws {TRPCError} UNAUTHORIZED for a session without `authTime`, an inactive or missing
   *   user, or a version that is no longer the user's.
   */
  refreshToken: selfProcedure.mutation(async ({ ctx }) => {
    const { authTime } = ctx.session.user;
    // A request's session always has one (`createUserSession`); a hand-built one may not, and a
    // refresh has no login time of its own to put in its place.
    if (authTime === undefined) {
      throw new SessionEndedError();
    }

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

    // The version read here must still be the bearer's: a refresh that passed authentication
    // before a logout or any other revocation must not mint a token at the new version.
    if (!fresh || !fresh.isActive || fresh.tokenVersion !== ctx.session.user.tokenVersion) {
      throw new SessionEndedError();
    }

    const token = createToken(
      {
        id: ctx.session.user.id,
        email: fresh.email,
        username: fresh.username,
        role: fresh.role,
        tokenVersion: fresh.tokenVersion,
      },
      authTime
    );
    return { token, tokenVersion: fresh.tokenVersion };
  }),

  /**
   * Ends every API session of the caller, the bearer it is called with included (`tokenVersion`).
   * The web's one sign-out path (`serverLogout`, ADR-048) calls it, then clears the browser session
   * whatever it answered. Like every own-data endpoint it is blocked by an active maintenance window
   * for whoever cannot bypass it.
   *
   * @auth {authenticated — own account}
   * @input {none}
   * @output {{ success: true }}
   */
  logout: selfProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    await revokingTransaction(ctx.prisma, (tx, revoke) =>
      tx.user.update({ where: { id: userId }, data: { tokenVersion: revoke.user(userId) } })
    );

    await logAudit(ctx, { action: 'AUTH_LOGOUT', targetType: 'Auth', targetId: userId, result: 'SUCCESS' });

    return { success: true };
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
   * Sends the caller a link to verify their own email address.
   *
   * Takes no address. It used to take one from anyone, and its answers told an unknown address from
   * a verified one, a sent mail or a failed send. On the caller's own account the real outcome,
   * a failed send included, is the answer.
   *
   * @auth {authenticated — own account}
   * @input {none}
   * @output {Result from sendVerificationEmail().}
   * @throws {TRPCError} BAD_REQUEST for an LDAP account still on its synthetic address, which
   *   reaches nobody; PRECONDITION_FAILED with a fixed text if the email cannot be sent.
   */
  requestEmailVerification: selfProcedure
    // Per user: every caller is signed in, and a shared office IP must not throttle colleagues.
    .use(withRateLimit('userMutations'))
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      return sendVerificationEmail(ctx.prisma, { userId, reason: 'user_requested', actorId: userId }, ctx);
    }),

  /**
   * Sends a new verification link to an account that login refuses until its email is verified
   * (`auth.requireEmailVerification`), the one way back that needs no session. It proves the
   * password first, as a login does (`verifyCredentials`: strategy, the per-account bucket shared
   * with login, the failure audit), so it tells a caller without it nothing about the account.
   *
   * @auth {public — password-verified}
   * @input {LoginSchema} — username and password.
   * @output {Result from sendVerificationEmail().}
   * @throws {TRPCError} UNAUTHORIZED for wrong credentials; PRECONDITION_FAILED for an address
   *   already verified; whatever `verifyCredentials` and `sendVerificationEmail` throw.
   */
  resendVerification: publicProcedure
    .use(withRateLimit('passwordReset'))
    .input(LoginSchema)
    .mutation(async ({ input, ctx }) => {
      const { user } = await verifyCredentials(ctx, input);
      if (user.emailVerifiedAt) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Email già verificata: puoi accedere.' });
      }
      // Pre-session: no actor; the helper's audit row carries the account as its target.
      return sendVerificationEmail(ctx.prisma, { userId: user.id, reason: 'user_requested' }, ctx);
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
   * Saves a real email for an LDAP user awaiting approval whose directory entry has none, and sends
   * the verification email to it. The caller proves the password first, exactly as a login does
   * (`verifyCredentials`: strategy, the per-account bucket shared with login, the failure audit).
   *
   * Before the password is proven, every refusal that depends on the account reads like a wrong
   * password. After it, a refusal says what it is and is audited: an account whose address cannot
   * be set here is a PRECONDITION_FAILED (an address already set is changed by an administrator),
   * and an address another account holds is a CONFLICT.
   *
   * @auth {public — password-verified}
   * @input {SubmitPendingEmailSchema} — username, password and the email to register.
   * @output {{ success: true }}
   * @throws {TRPCError} BAD_REQUEST for a synthetic new address, before any credential check;
   *   UNAUTHORIZED for wrong credentials; PRECONDITION_FAILED for an account that is not (or
   *   stopped being, before the write) an active pending LDAP one with a synthetic address;
   *   CONFLICT for a taken address; whatever else `verifyCredentials` throws.
   */
  submitPendingEmail: publicProcedure
    .use(withRateLimit('pendingEmail'))
    .input(SubmitPendingEmailSchema)
    .mutation(async ({ input, ctx }) => {
      const { username, email } = input;
      // A synthetic address is not one to be contacted at, and saving one would leave the account
      // as eligible as before, so the flow could run again.
      if (isSyntheticLdapEmail(email)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Email non valida' });
      }
      const { user } = await verifyCredentials(ctx, input);

      // The password is proven from here on: a refusal can say what it is, and leaves a row.
      const notSettable = async (reason: 'address_already_set' | 'account_changed', message: string) => {
        await logAudit(ctx, {
          action: 'PENDING_USER_EMAIL_SUBMITTED',
          targetType: 'User',
          targetId: user.id,
          result: 'FAILURE',
          metadata: { username, reason },
        });
        return new TRPCError({ code: 'PRECONDITION_FAILED', message });
      };
      if (!isSyntheticLdapEmail(user.email)) {
        throw await notSettable(
          'address_already_set',
          'Indirizzo email già registrato: per cambiarlo contatta un amministratore.'
        );
      }

      // Conditional write (rule 3), which is also the eligibility check: an account that is not
      // active, pending and LDAP — or stopped being one, or got an address from another submit,
      // since the user above was read — matches nothing. The address's uniqueness is the
      // database's constraint, not a read before the write; `null` when nothing was written.
      let resetTokensRevoked: number | null;
      try {
        resetTokensRevoked = await ctx.prisma.$transaction(tx =>
          moveUserEmail(tx, user.id, email, {
            isActive: true,
            pendingApproval: true,
            email: user.email,
            identities: { some: { provider: 'LDAP' } },
          })
        );
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_key')) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Email già in uso da un altro account' });
        }
        throw err;
      }
      if (resetTokensRevoked === null) {
        throw await notSettable('account_changed', "L'account è cambiato nel frattempo: accedi di nuovo.");
      }

      await logAudit(ctx, {
        action: 'PENDING_USER_EMAIL_SUBMITTED',
        targetType: 'User',
        targetId: user.id,
        result: 'SUCCESS',
        metadata: { username, resetTokensRevoked },
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
   * Sends a user a link to verify their email address, on behalf of whoever manages users. It
   * mails the address the account already has, changes nothing on it and returns no token, which is
   * why `users:update` is enough.
   *
   * @auth {users:update}
   * @input {RequestEmailVerificationAdminSchema} — userId of the target user.
   * @output {Result from sendVerificationEmail().}
   * @throws {TRPCError} NOT_FOUND for an unknown or inactive user, BAD_REQUEST for a synthetic
   *   LDAP address, PRECONDITION_FAILED with a fixed text if the email cannot be sent.
   */
  requestEmailVerificationAdmin: protectedProcedure
    .use(requirePermission('users:update'))
    .use(withRateLimit('userMutations'))
    .input(RequestEmailVerificationAdminSchema)
    .mutation(async ({ input, ctx }) => {
      return sendVerificationEmail(ctx.prisma, {
        userId: input.userId,
        reason: 'admin_initiated',
        actorId: ctx.session.user.id,
      }, ctx);
    }),
});
