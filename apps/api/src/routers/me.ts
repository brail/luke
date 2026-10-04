/**
 * tRPC router for current user profile operations
 * Handles reading and updating personal profile
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  UserProfileSchema,
  ChangePasswordSchema,
  UpdateTimezoneSchema,
} from '@luke/core';
import { Prisma } from '@luke/db';

import { logAudit } from '../lib/auditLog';
import { sendVerificationEmail } from '../lib/emailHelpers';
import { getTimeBasedGreeting, GREETING_INTROS, selectGreetingContent } from '../lib/greetingPhrases';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { hashPassword, verifyPassword } from '../lib/password';
import { pickRandom } from '../lib/random';
import { withRateLimit } from '../lib/ratelimit';
import { invalidateTokenVersionCache } from '../lib/tokenVersionCache';
import { selfProcedure, router } from '../lib/trpc';
import { resolveUserTimeZone } from '../lib/userTimeZone';
import { getUserPreferenceValue, setUserPreferenceValue } from '../services/context.service';
import { assertPasswordMeetsPolicy } from '../services/passwordPolicy.service';

const DAILY_GREETING_ENABLED_KEY = 'dailyGreetingEnabled';

export const meRouter = router({
  /**
   * Returns the current user's full profile including provider info and profile completion percentage.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {User with provider, profileCompletion, loginCount, lastLoginAt. `timezone` is the zone
   *   the server renders in (`resolveUserTimeZone`): the business zone when the stored value is not
   *   an IANA name.}
   */
  get: selfProcedure.query(async ({ ctx }) => {
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
        emailVerifiedAt: true,
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

    // Determines the main provider (first identity)
    const provider = user.identities[0]?.provider || 'LOCAL';

    // The zone the server renders this user's dates in, not the raw column: the web formats with
    // it and the profile form saves it back, which a legacy non-IANA value would fail.
    const timezone = await resolveUserTimeZone(ctx.prisma, user, ctx.logger);

    // Calculates profile completion percentage
    const profileCompletion = calculateProfileCompletion({
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      timezone,
    });

    const dailyGreetingEnabled = await getUserPreferenceValue(
      user.id,
      DAILY_GREETING_ENABLED_KEY,
      false,
      ctx.prisma
    );

    return {
      ...user,
      timezone,
      provider,
      profileCompletion,
      dailyGreetingEnabled,
      // Remove identities from output (not needed in frontend)
      identities: undefined,
    };
  }),

  /**
   * Updates the current user's editable profile fields; blocks sync-locked fields for LDAP/OIDC users.
   *
   * @auth {authenticated}
   * @input {UserProfileSchema} — firstName, lastName, locale, timezone. The email changes only
   *   through `me.changeEmail`.
   * @output {Partial User with updated fields.}
   */
  updateProfile: selfProcedure
    .input(UserProfileSchema)
    .mutation(async ({ ctx, input }) => {
      // Check the user's provider
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

      // For external providers (LDAP/OIDC), block changes to synced fields
      if (provider !== 'LOCAL') {
        // Check whether the user is trying to change synced fields
        const currentUser = await ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
          select: {
            firstName: true,
            lastName: true,
          },
        });

        if (!currentUser) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
        }

        if (
          input.firstName !== currentUser.firstName ||
          input.lastName !== currentUser.lastName
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'Nome e cognome sono sincronizzati dal provider esterno e non possono essere modificati',
          });
        }
      }

      // Update the allowed fields
      const updated = await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: {
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

      // Audit the update
      await logAudit(ctx, {
        action: 'USER_UPDATE_PROFILE',
        targetType: 'User',
        targetId: ctx.session.user.id,
        result: 'SUCCESS',
      });

      return updated;
    }),

  /**
   * Changes the current user's email address and sends a verification email to the new address.
   *
   * @auth {authenticated}
   * @input {{ newEmail: string }} — the new email address (must be unique).
   * @output {{ success: true, message: string }}
   * @throws {TRPCError} CONFLICT if another account holds the address — the unique constraint's
   *   answer at the write, with no read before it.
   */
  changeEmail: selfProcedure
    .use(withRateLimit('userMutations'))
    .input(
      z.object({
        newEmail: z.string().email('Email non valida').toLowerCase().trim(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { newEmail } = input;
      const userId = ctx.session.user.id;

      try {
        await ctx.prisma.user.update({
          where: { id: userId },
          data: { email: newEmail, emailVerifiedAt: null },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Email già in uso' });
        }
        throw err;
      }

      await logAudit(ctx, {
        action: 'EMAIL_CHANGED',
        targetType: 'User',
        targetId: userId,
        result: 'SUCCESS',
        metadata: {},
      });

      try {
        await sendVerificationEmail(
          ctx.prisma,
          { userId, reason: 'email_changed', actorId: userId },
          ctx
        );
        return {
          success: true,
          message: 'Email aggiornata. Controlla la nuova casella per verificarla.',
        };
      } catch {
        return {
          success: true,
          message: 'Email aggiornata. Invio verifica non riuscito: aggiornala dalla pagina profilo.',
        };
      }
    }),

  /**
   * Changes the current user's password; only available for LOCAL provider users.
   *
   * @auth {authenticated}
   * @input {ChangePasswordSchema} — currentPassword, newPassword.
   * @output {{ ok: true }}
   */
  changePassword: selfProcedure
    .use(withRateLimit('passwordChange'))
    .input(ChangePasswordSchema)
    .use(withIdempotency())
    .mutation(async ({ ctx, input }) => {
      // Check that the user has a LOCAL provider
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

      // Verify the current password
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

      // Verify the new password isn't the same as the current one
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

      await assertPasswordMeetsPolicy(ctx.prisma, input.newPassword);

      // Generate hash for the new password
      const newPasswordHash = await hashPassword(input.newPassword);

      // Update the password and bump tokenVersion in a transaction
      await ctx.prisma.$transaction(async trx => {
        // Update the password hash
        await trx.localCredential.update({
          where: { identityId: localIdentity.id },
          data: { passwordHash: newPasswordHash },
        });

        // Bump tokenVersion to invalidate all previous sessions
        await trx.user.update({
          where: { id: ctx.session.user.id },
          data: { tokenVersion: { increment: 1 } },
        });
      });

      // Invalidate the tokenVersion cache for this user
      invalidateTokenVersionCache(ctx.session.user.id);

      // Audit log for the password change
      await logAudit(ctx, {
        action: 'USER_PASSWORD_CHANGE',
        targetType: 'User',
        targetId: ctx.session.user.id,
        result: 'SUCCESS',
        metadata: {
          success: true,
        },
      });

      return { ok: true };
    }),

  /**
   * Returns the current user's recent login history from the audit log.
   *
   * @auth {authenticated}
   * @input {{ limit?: number }} — max entries to return (default 10).
   * @output {Array<{ id, timestamp, success, ipAddress, location }>}
   */
  loginHistory: selfProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      // Filtered by `targetId`, not `actorId`: login events are recorded before a session
      // exists, so they always store `actorId: null` and point at the account through
      // `targetId` instead. Filtering by actor matched 0 rows out of every login ever
      // recorded, which is why this history always came back empty.
      const logs = await ctx.prisma.auditLog.findMany({
        where: {
          targetId: ctx.session.user.id,
          targetType: 'Auth',
          action: { in: ['AUTH_LOGIN', 'AUTH_LOGIN_FAILED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: input?.limit || 10,
      });

      return logs.map(log => {
        const metadata = log.metadata;
        const location =
          metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata) &&
          typeof (metadata as Record<string, unknown>).location === 'string'
            ? ((metadata as Record<string, unknown>).location as string)
            : 'Unknown';

        return {
          id: log.id,
          timestamp: log.createdAt,
          success: log.action === 'AUTH_LOGIN',
          ipAddress: log.ip,
          location,
        };
      });
    }),

  /**
   * Revokes all sessions for the current user by incrementing tokenVersion.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ success: true }}
   */
  revokeAllSessions: selfProcedure.mutation(async ({ ctx }) => {
    // Bump tokenVersion to invalidate all sessions
    await ctx.prisma.user.update({
      where: { id: ctx.session.user.id },
      data: { tokenVersion: { increment: 1 } },
    });

    // Invalidate the tokenVersion cache for this user
    invalidateTokenVersionCache(ctx.session.user.id);

    // Log audit
    await logAudit(ctx, {
      action: 'USER_REVOKE_ALL_SESSIONS',
      targetType: 'User',
      targetId: ctx.session.user.id,
      result: 'SUCCESS',
      metadata: {
        success: true,
      },
    });

    return { success: true };
  }),

  /**
   * Updates only the timezone field for the current user.
   *
   * @auth {authenticated}
   * @input {UpdateTimezoneSchema} — timezone (IANA timezone identifier).
   * @output {{ id, timezone, updatedAt }}
   */
  updateTimezone: selfProcedure
    .input(UpdateTimezoneSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: {
          timezone: input.timezone,
        },
        select: {
          id: true,
          timezone: true,
          updatedAt: true,
        },
      });

      // Log audit
      await logAudit(ctx, {
        action: 'USER_UPDATE_TIMEZONE',
        targetType: 'User',
        targetId: ctx.session.user.id,
        result: 'SUCCESS',
        metadata: {
          newTimezone: input.timezone,
        },
      });

      return updated;
    }),

  /**
   * Returns the daily greeting content for the current user (time-based greeting, random intro,
   * and a quote or fact), or `{ enabled: false }` if the user disabled the feature.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ enabled: false } | { enabled: true, greeting, userName, intro, type, content, author }}
   */
  getDailyGreeting: selfProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const enabled = await getUserPreferenceValue(userId, DAILY_GREETING_ENABLED_KEY, false, ctx.prisma);
    if (!enabled) {
      return { enabled: false as const };
    }

    const [user, content] = await Promise.all([
      ctx.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, timezone: true } }),
      selectGreetingContent(),
    ]);

    const timeZone = await resolveUserTimeZone(ctx.prisma, { id: userId, timezone: user?.timezone ?? '' }, ctx.logger);
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date())
    );

    return {
      enabled: true as const,
      greeting: getTimeBasedGreeting(hour),
      userName: user?.firstName ?? '',
      intro: pickRandom(GREETING_INTROS),
      ...content,
    };
  }),

  /**
   * Persists the current user's daily greeting kill-switch preference.
   *
   * @auth {authenticated}
   * @input {{ enabled: boolean }}
   * @output {{ enabled: boolean }}
   */
  updateGreetingPreference: selfProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const enabled = await setUserPreferenceValue(
        ctx.session.user.id,
        DAILY_GREETING_ENABLED_KEY,
        input.enabled,
        ctx.prisma
      );
      return { enabled };
    }),
});

/**
 * Calculates the user profile's completion percentage
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
