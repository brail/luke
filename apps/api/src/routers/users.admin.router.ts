/**
 * Admin procedures for users
 * revokeUserSessions, forceVerifyEmail, forceLocalAccess, revokeLocalAccess, changeEmail
 */

import { randomBytes } from 'crypto';

import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { UserIdSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { withAuditLog } from '../lib/auditMiddleware';
import { getConfig } from '../lib/configManager';
import { createResetToken, sendVerificationEmail } from '../lib/emailHelpers';
import { isSyntheticLdapEmail } from '../lib/ldapAuth';
import { sendAccountApprovedEmail, sendPasswordResetEmail } from '../lib/mailer';
import { hashPassword } from '../lib/password';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure, invalidateTokenVersionCache } from '../lib/trpc';

export const usersAdminRouter = router({
  /**
   * Lists LDAP users pending admin approval (pendingApproval=true and isActive=true).
   *
   * @auth {users:read}
   * @input {none}
   * @output {{ users: User[], total: number }}
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
   * Approves a pending LDAP user (clears pendingApproval flag), assigns them to the given team
   * in the same transaction, and sends an account-approved email. A pending user is provisioned
   * without a team (`ldapAuth.ts`) — this is the first point a human decides where they belong,
   * so the team is mandatory here rather than defaulted.
   *
   * @auth {users:update}
   * @input {{ id: string (UUID), teamId: string (UUID) }}
   * @output {{ success: true, message: string }}
   */
  approvePending: protectedProcedure
    .use(requirePermission('users:update'))
    .input(z.object({ id: z.string().uuid(), teamId: z.string().uuid() }))
    .use(withAuditLog('USER_APPROVED', 'User'))
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.prisma.$transaction(async tx => {
        const pendingUser = await tx.user.findUnique({ where: { id: input.id } });
        if (!pendingUser || !pendingUser.pendingApproval) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Utente in attesa non trovato',
          });
        }

        const team = await tx.companyTeam.findUnique({ where: { id: input.teamId }, select: { isActive: true } });
        if (!team || !team.isActive) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Team non trovato o non attivo',
          });
        }

        await tx.companyTeamMembership.create({ data: { teamId: input.teamId, userId: input.id } });
        await tx.user.update({ where: { id: input.id }, data: { pendingApproval: false } });

        return pendingUser;
      });

      // Send activation notification email (only if the email isn't synthetic)
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
   * Rejects and permanently deletes a pending LDAP user.
   *
   * @auth {users:delete}
   * @input {UserIdSchema}
   * @output {{ success: true, message: string }}
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
   * Revokes all sessions for a specific user by incrementing their tokenVersion; blocks self-revocation.
   *
   * @auth {users:update}
   * @input {UserIdSchema}
   * @output {{ success: true, message: string }}
   */
  revokeUserSessions: protectedProcedure
    .use(requirePermission('users:update'))
    .input(UserIdSchema)
    .use(withAuditLog('USER_REVOKE_SESSIONS', 'User'))
    .mutation(async ({ ctx, input }) => {
      // Verify the user exists
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

      // Protection: prevent self-revocation (use me.revokeAllSessions instead)
      if (targetUser.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Non puoi revocare le tue stesse sessioni da qui. Usa il profilo personale.',
        });
      }

      // Increment tokenVersion to invalidate all of the user's sessions
      await ctx.prisma.user.update({
        where: { id: input.id },
        data: { tokenVersion: { increment: 1 } },
      });

      // Invalidate the tokenVersion cache for this user
      invalidateTokenVersionCache(input.id);

      // Audit logging handled automatically by the withAuditLog middleware

      return {
        success: true,
        message: `Sessioni revocate per ${targetUser.firstName} ${targetUser.lastName}`,
      };
    }),

  /**
   * Force-sets or clears the emailVerifiedAt timestamp for a user, bypassing the token flow.
   *
   * @auth {users:update}
   * @input {{ userId: string (UUID), verified: boolean }}
   * @output {{ success: true, message: string }}
   */
  forceVerifyEmail: protectedProcedure
    .use(requirePermission('users:update'))
    .input(
      z.object({
        userId: z.string().uuid(),
        verified: z.boolean(),
      })
    )
    .use(withAuditLog('EMAIL_VERIFICATION_FORCED', 'User'))
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
   * Force-provisions a LOCAL identity for a user currently authenticating via LDAP/OIDC, so login
   * keeps working if AD disables or deletes the account. The existing external identity is left
   * untouched — if AD re-enables the account, that login path keeps working too. Delivers access
   * via the existing password-reset flow (`/auth/reset`): the placeholder credential created here
   * is random and never usable on its own.
   *
   * @auth {users:update} + `*:*` — bypassing an external auth provider is admin-only despite
   *   `users:update` being granted to editor, same restriction as the password field in
   *   `users.update` (users.core.router.ts)
   * @input {UserIdSchema}
   * @output {{ success: true, message: string }}
   */
  forceLocalAccess: protectedProcedure
    .use(requirePermission('users:update'))
    .use(requirePermission('*:*'))
    .use(withRateLimit('userMutations'))
    .input(UserIdSchema)
    .use(withAuditLog('USER_LOCAL_ACCESS_FORCED', 'User'))
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
        include: { identities: { select: { provider: true } } },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
      }

      // Mirrors the UI's own gate (button hidden unless the user has an external identity):
      // this action exists to bypass LDAP/OIDC, not to duplicate an ordinary password reset.
      const hasExternalIdentity = user.identities.some(i => i.provider !== 'LOCAL');
      if (!hasExternalIdentity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "L'utente non ha un'identity esterna (LDAP/OIDC): usa il reset password standard invece di forzare l'accesso locale.",
        });
      }

      if (isSyntheticLdapEmail(user.email)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "Imposta prima un'email reale per questo utente (Modifica utente), poi riprova: serve per recapitare il link di accesso locale.",
        });
      }

      const hasLocalIdentity = user.identities.some(i => i.provider === 'LOCAL');

      if (!hasLocalIdentity) {
        // Hashed outside the transaction (argon2 is CPU-bound, must not hold a DB
        // transaction open — same reasoning as users.core.router.ts). The password is
        // random and discarded: it only exists to satisfy LocalCredential's NOT NULL
        // constraint until the user sets a real one via the reset link below.
        const placeholderHash = await hashPassword(randomBytes(32).toString('hex'));

        try {
          await ctx.prisma.$transaction(async tx => {
            const identity = await tx.identity.create({
              data: { userId: user.id, provider: 'LOCAL', providerId: user.username },
            });
            await tx.localCredential.create({
              data: { identityId: identity.id, passwordHash: placeholderHash },
            });
          });
        } catch (err) {
          // `user.identities` was read outside any transaction: a concurrent call for the
          // same user can race this one. The `@@unique([provider, providerId])` constraint
          // is the actual race arbiter — losing that race means the identity now exists
          // (created by the winner), so just proceed to (re)send the link below.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
            throw err;
          }
        }
      }

      // Token generation and `getConfig` are independent reads/writes — run concurrently.
      let userToken;
      try {
        const [{ token, userToken: createdToken }, baseUrl] = await Promise.all([
          createResetToken(ctx.prisma, user.id),
          getConfig(ctx.prisma, 'app.baseUrl', false).then(v => v || 'http://localhost:3000'),
        ]);
        userToken = createdToken;

        await sendPasswordResetEmail(ctx.prisma, user.email, token, baseUrl);
      } catch (error) {
        // The LOCAL identity/credential (if just created) is deliberately left in place —
        // it's unusable without the link and the next call just resends it (see
        // `hasLocalIdentity` above). Only the orphaned token, which nobody received, is
        // cleaned up, mirroring `requestPasswordReset` in `auth.service.ts`.
        if (userToken) {
          await ctx.prisma.userToken.delete({ where: { id: userToken.id } }).catch(e => {
            ctx.logger.warn({ err: e, tokenId: userToken!.id }, 'Failed to delete orphaned reset token');
          });
        }
        ctx.logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error', userId: user.id },
          'forceLocalAccess: reset email failed — check SMTP config in AppConfig'
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            "Credenziale locale pronta ma invio email fallito (verifica configurazione SMTP). Riprova: l'operazione è idempotente.",
          cause: error,
        });
      }

      return {
        success: true,
        message: `Link di accesso locale inviato a ${user.email}`,
      };
    }),

  /**
   * Revokes the LOCAL identity (and its credential) provisioned by `forceLocalAccess`, e.g. once
   * an LDAP/OIDC account is confirmed to work again. Refuses to remove a user's only identity —
   * there must be a remaining external provider to fall back to. Bumps `tokenVersion` to
   * invalidate any session already authenticated via the removed local credential.
   *
   * @auth {users:update} + `*:*` — same class of action as `forceLocalAccess`, admin-only
   *   despite `users:update` being granted to editor
   * @input {UserIdSchema}
   * @output {{ success: true, message: string }}
   */
  revokeLocalAccess: protectedProcedure
    .use(requirePermission('users:update'))
    .use(requirePermission('*:*'))
    .use(withRateLimit('userMutations'))
    .input(UserIdSchema)
    .use(withAuditLog('USER_LOCAL_ACCESS_REVOKED', 'User'))
    .mutation(async ({ input, ctx }) => {
      // Same self-lockout risk as revokeUserSessions (this also bumps tokenVersion,
      // ending the caller's own session mid-action) — same guard.
      if (input.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non puoi revocare il tuo stesso accesso locale.',
        });
      }

      // Read → validate → write entirely inside the transaction: a concurrent second call for
      // the same user must re-read fresh state, not act on a stale pre-transaction snapshot
      // (mirrors the race-safety already applied to `forceLocalAccess` above).
      const result = await ctx.prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({
          where: { id: input.id },
          include: { identities: { select: { id: true, provider: true } } },
        });

        if (!user) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
        }

        const localIdentity = user.identities.find(i => i.provider === 'LOCAL');
        if (!localIdentity) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "L'utente non ha accesso locale attivo",
          });
        }

        const hasExternalIdentity = user.identities.some(i => i.provider !== 'LOCAL');
        if (!hasExternalIdentity) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "Impossibile revocare l'unico metodo di accesso dell'utente: nessuna identity esterna (LDAP/OIDC) di fallback.",
          });
        }

        // Cascade-deletes the LocalCredential row (schema onDelete: Cascade).
        await tx.identity.delete({ where: { id: localIdentity.id } });
        await tx.user.update({
          where: { id: user.id },
          data: { tokenVersion: { increment: 1 } },
        });

        return user;
      });

      invalidateTokenVersionCache(result.id);

      return {
        success: true,
        message: `Accesso locale revocato per ${result.username}`,
      };
    }),

  /**
   * Changes the current user's email, resets emailVerifiedAt, and sends a new verification email.
   *
   * @auth {users:update}
   * @input {{ newEmail: string }}
   * @output {{ success: true, message: string }}
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

      // Verify email uniqueness
      const existing = await ctx.prisma.user.findFirst({
        where: { email: newEmail, id: { not: userId } },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Email già in uso',
        });
      }

      // Update email + reset verification
      await ctx.prisma.user.update({
        where: { id: userId },
        data: { email: newEmail, emailVerifiedAt: null },
      });

      // Audit EMAIL_CHANGED (no PII)
      await logAudit(ctx, {
        action: 'EMAIL_CHANGED',
        targetType: 'User',
        targetId: userId,
        result: 'SUCCESS',
        metadata: {},
      });

      // Send verification using the DRY helper
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
