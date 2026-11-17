/**
 * Admin procedures for users: pending LDAP user approval, session revocation,
 * email-verification override, and the local-access bypass for LDAP/OIDC users.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { APPROVAL_NEEDS_EMAIL_MESSAGE, isSyntheticLdapEmail, LDAP_SYNTHETIC_EMAIL_DOMAIN, UserIdSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { withAuditLog } from '../lib/auditMiddleware';
import { getConfigOrDefault } from '../lib/configManager';
import { issueUserToken, lockUserEmail } from '../lib/emailHelpers';
import { isUniqueViolation } from '../lib/error';
import { acquireLastAdminLock } from '../lib/lastAdminGuard';
import { sendAccountApprovedEmail, sendPasswordResetEmail } from '../lib/mailer';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { invalidateTokenVersionCache } from '../lib/tokenVersionCache';
import { router, protectedProcedure } from '../lib/trpc';
import {
  LocalAccessRefused,
  assertOwnLocalIdentity,
  prepareLocalIdentityLocked,
} from '../services/localAccess.service';

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
            select: { provider: true },
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
   * so the team is mandatory here rather than defaulted. A user still on a synthetic LDAP address
   * is refused with `PRECONDITION_FAILED` (#266): the address comes first.
   *
   * @auth {users:update}
   * @input {{ id: string (UUID), teamId: string (UUID) }}
   * @output {{ success: true, message: string }}
   */
  approvePending: protectedProcedure
    .use(requirePermission('users:update'))
    .input(z.object({ id: z.uuid(), teamId: z.uuid() }))
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

        // Row lock (CLAUDE.md "Raw SQL" exception, `FOR NO KEY UPDATE`, the lock a team update takes):
        // the team stays active until the membership commits.
        await tx.$executeRaw`SELECT 1 FROM company_teams WHERE id = ${input.teamId} FOR NO KEY UPDATE`;
        const team = await tx.companyTeam.findUnique({ where: { id: input.teamId }, select: { isActive: true } });
        if (!team || !team.isActive) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Team non trovato o non attivo',
          });
        }

        // Conditional write (rule 3): of two approvals of the same user, only one finds it pending,
        // so the user joins one team and the trail records one approval. A synthetic address stays
        // pending (#266, owner #69 a): once approved, an LDAP user can no longer give one themselves.
        const { count } = await tx.user.updateMany({
          where: { id: input.id, pendingApproval: true, NOT: { email: { endsWith: `@${LDAP_SYNTHETIC_EMAIL_DOMAIN}` } } },
          data: { pendingApproval: false },
        });
        if (count === 0) {
          // The read above names the refusal; the write's condition is what holds it.
          if (isSyntheticLdapEmail(pendingUser.email)) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: APPROVAL_NEEDS_EMAIL_MESSAGE });
          }
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente in attesa non trovato' });
        }
        const membership = await tx.companyTeamMembership.create({ data: { teamId: input.teamId, userId: input.id } });
        // Access changes, recorded in the transaction; `USER_APPROVED` stays the post-commit event row.
        await logAudit(ctx, {
          action: 'USER_ACCESS_CHANGED',
          targetType: 'User',
          targetId: input.id,
          result: 'SUCCESS',
          metadata: { oldPendingApproval: true, newPendingApproval: false },
        }, { tx });
        await logAudit(ctx, {
          action: 'COMPANY_TEAM_MEMBER_ADDED',
          targetType: 'CompanyTeamMembership',
          targetId: `${input.teamId}:${input.id}`,
          result: 'SUCCESS',
          metadata: { teamId: input.teamId, userId: input.id, role: membership.role },
        }, { tx });

        return pendingUser;
      });

      // Send activation notification email (only if the email isn't synthetic)
      if (!isSyntheticLdapEmail(user.email)) {
        try {
          const baseUrl =
            await getConfigOrDefault(ctx.prisma, 'app.baseUrl');
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
      // Conditional delete (rule 3): an approval landing first makes the user no longer pending, and
      // the rejection then deletes nothing. The guard does not count a pending admin, so rejecting
      // one never touches its lock. `user` is only the audit's snapshot.
      const user = await ctx.prisma.user.findFirst({ where: { id: input.id, pendingApproval: true } });
      const { count } = await ctx.prisma.user.deleteMany({ where: { id: input.id, pendingApproval: true } });

      if (!user || count === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente in attesa non trovato',
        });
      }

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
        userId: z.uuid(),
        verified: z.boolean(),
      })
    )
    .use(withAuditLog('EMAIL_VERIFICATION_FORCED', 'User'))
    .mutation(async ({ input, ctx }) => {
      const { userId, verified } = input;

      // Unverifying an administrator can lower the break-glass count a strategy change reads under
      // the last-admin lock (#246): the two wait for each other. The write is the existence check.
      const { count } = await ctx.prisma.$transaction(async tx => {
        await acquireLastAdminLock(tx);
        return tx.user.updateMany({ where: { id: userId }, data: { emailVerifiedAt: verified ? new Date() : null } });
      });
      if (count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
      }

      return {
        success: true,
        message: verified ? 'Email verificata' : 'Verifica rimossa',
      };
    }),

  /**
   * Force-provisions a LOCAL identity for a user currently authenticating via LDAP/OIDC, so login
   * keeps working if AD disables or deletes the account. The existing external identity is left
   * untouched — if AD re-enables the account, that login path keeps working too. Delivers access
   * via the existing password-reset flow (`/auth/reset`): no password is written here, the link
   * creates the credential when the user sets one.
   *
   * @auth {users:update} + `*:*` — bypassing an external auth provider is admin-only even for a
   *   `users:update` holder, same restriction as the password field in `users.update`
   *   (users.core.router.ts)
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
        select: {
          id: true,
          username: true,
          email: true,
          identities: { select: { provider: true, providerId: true } },
        },
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

      // A LOCAL identity under the current username, created if missing. No password: the link below
      // creates the credential when the user sets one.
      const local = user.identities.find(i => i.provider === 'LOCAL');
      if (!local || local.providerId !== user.username) {
        try {
          try {
            await ctx.prisma.$transaction(tx => prepareLocalIdentityLocked(tx, user.id));
          } catch (err) {
            // The identity's `(provider, providerId)` decided against this write: held by another
            // account, or created meanwhile. The identity that won is acceptable only if it is this user's.
            if (!isUniqueViolation(err, 'identities_provider_providerId_key')) throw err;
            await assertOwnLocalIdentity(ctx.prisma, user.id);
          }
        } catch (err) {
          if (!(err instanceof LocalAccessRefused)) throw err;
          ctx.logger.warn({ userId: user.id, reason: err.message }, 'forceLocalAccess: unusable LOCAL identity');
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "L'identità locale di questo utente non è utilizzabile: è registrata con un altro username o appartiene a un altro account.",
          });
        }
      }

      // Token generation and `getConfig` are independent reads/writes — run concurrently. The link
      // is issued under the user row lock, so it goes to the address the account has now, which may
      // differ from `user.email` read above; earlier links stay valid.
      const [issued, baseUrl] = await Promise.all([
        ctx.prisma.$transaction(tx => issueUserToken(tx, user.id, 'RESET', { revokePrevious: false })),
        getConfigOrDefault(ctx.prisma, 'app.baseUrl'),
      ]);
      if (!issued) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
      }

      try {
        await sendPasswordResetEmail(ctx.prisma, issued.email, issued.token, baseUrl);
      } catch (error) {
        // The LOCAL identity (if just created) is deliberately left in place — it holds no
        // password until a link is used, and the next call finds it ready and just resends the
        // link. Only the orphaned token, which nobody received, is cleaned up, mirroring
        // `requestPasswordReset` in `auth.service.ts`; a link sent earlier is never touched.
        await ctx.prisma.userToken.delete({ where: { id: issued.userToken.id } }).catch(e => {
          ctx.logger.warn({ err: e, tokenId: issued.userToken.id }, 'Failed to delete orphaned reset token');
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            "Accesso locale predisposto ma invio email fallito (verifica configurazione SMTP). Riprova: l'operazione è idempotente.",
          cause: error,
        });
      }

      return {
        success: true,
        message: `Link di accesso locale inviato a ${issued.email}`,
      };
    }),

  /**
   * Revokes the LOCAL identity (and its credential) provisioned by `forceLocalAccess`, e.g. once
   * an LDAP/OIDC account is confirmed to work again. Refuses to remove a user's only identity —
   * there must be a remaining external provider to fall back to. Bumps `tokenVersion` to
   * invalidate any session already authenticated via the removed local credential.
   *
   * @auth {users:update} + `*:*` — same class of action as `forceLocalAccess`, admin-only
   *   even for a `users:update` holder
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
        // Revoking an administrator's LOCAL credential can lower the break-glass count a strategy
        // change checks under this lock (#246): the two wait for each other.
        await acquireLastAdminLock(tx);
        // The user row next, before the identity delete: every writer of a user's identities and
        // credential takes it first (`lockUserEmail`), so a reset link consumed meanwhile waits here.
        await lockUserEmail(tx, input.id);
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
});
