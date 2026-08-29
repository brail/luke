/**
 * Core CRUD procedures for users
 * list, getById, create, update, softDelete, hardDelete
 */

import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import argon2 from 'argon2';
import { z } from 'zod';

import { CreateUserInputSchema, UpdateUserInputSchema, UserHardDeleteInputSchema, UserIdSchema, hasPermission } from '@luke/core';
import type { LockedFields, Role } from '@luke/core';
import { invalidateRbacCache } from '@luke/core/server';

import { logAudit } from '../lib/auditLog';
import { withAuditLog } from '../lib/auditMiddleware';
import { toErrorCode, toErrorMessage } from '../lib/error';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { assertNotLastAdminWithSettingsAccess } from '../lib/lastAdminGuard';
import { createNotification } from '../lib/notifications';
import { hashPassword } from '../lib/password';
import { requirePermission } from '../lib/permissions';
import { getOnlineUserIds, updatePresence } from '../lib/presenceStore';
import { withRateLimit } from '../lib/ratelimit';
import { invalidateTokenVersionCache } from '../lib/tokenVersionCache';
import { router, protectedProcedure } from '../lib/trpc';
import { deleteUserHandler, getLockedFields, resolveEffectiveProvider } from '../services/users.service';

export const usersCoreRouter = router({
  /**
   * Lists all non-pending users with optional filters, sorting, and offset pagination; includes online presence status.
   *
   * @auth {users:read}
   * @input {optional: { page, limit, search, role, sortBy, sortOrder }}
   * @output {{ users: User[], total: number, page: number, limit: number, totalPages: number }}
   */
  list: protectedProcedure
    .use(requirePermission('users:read'))
    .input(
      z
        .object({
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(10),
          search: z.string().optional(),
          role: z.enum(['admin', 'editor', 'viewer']).optional(),
          sortBy: z
            .enum([
              'email',
              'username',
              'firstName',
              'lastName',
              'role',
              'isActive',
              'emailVerifiedAt',
              'createdAt',
              'lastLoginAt',
              'provider',
            ])
            .default('createdAt'),
          sortOrder: z.enum(['asc', 'desc']).default('desc'),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const {
        page = 1,
        limit = 10,
        search,
        role,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = input || {};
      const skip = (page - 1) * limit;

      const where: Prisma.UserWhereInput = { pendingApproval: false };

      if (search && search.trim()) {
        where.OR = [
          { email: { contains: search } },
          { username: { contains: search } },
          { firstName: { contains: search } },
          { lastName: { contains: search } },
        ];
      }

      if (role) {
        where.role = role;
      }

      const selectFields = {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        // Null means the account has never completed a login — the users table renders that
        // as an explicit "Mai" rather than an empty cell.
        lastLoginAt: true,
        identities: {
          select: {
            id: true,
            provider: true,
            providerId: true,
            // NO localCredential, NO metadata
          },
        },
      } satisfies Prisma.UserSelect;

      let users: Prisma.UserGetPayload<{ select: typeof selectFields }>[];
      let total: number;

      if (sortBy === 'provider') {
        // Provider isn't a sortable DB column (it's derived from the first
        // linked identity): sorting correctly needs the entire result set,
        // not just the page — otherwise the ordering only holds within the
        // already-extracted page, not globally.
        const all = await ctx.prisma.user.findMany({ where, select: selectFields });
        all.sort((a, b) => {
          // A user may hold more than one identity (e.g. after `forceLocalAccess`) — sort/display
          // by the effective (external-first) provider, not an arbitrary/unordered `[0]`.
          const providerA = resolveEffectiveProvider(a.identities ?? []);
          const providerB = resolveEffectiveProvider(b.identities ?? []);
          const comparison = providerA.localeCompare(providerB);
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        total = all.length;
        users = all.slice(skip, skip + limit);
      } else {
        const [pageUsers, count] = await ctx.prisma.$transaction([
          ctx.prisma.user.findMany({
            where,
            skip,
            take: limit,
            select: selectFields,
            // `lastLoginAt` is nullable and Postgres sorts NULLs first on DESC, which would
            // put every never-logged-in account above the most recently active ones.
            orderBy:
              sortBy === 'lastLoginAt'
                ? { lastLoginAt: { sort: sortOrder, nulls: 'last' } }
                : { [sortBy]: sortOrder },
          }),
          ctx.prisma.user.count({ where }),
        ]);
        users = pageUsers;
        total = count;
      }

      const onlineIds = getOnlineUserIds();

      return {
        users: users.map(u => ({ ...u, isOnline: onlineIds.has(u.id) })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  /**
   * Returns a user by ID; non-admin users may only fetch their own profile.
   *
   * @auth {users:read}
   * @input {UserIdSchema}
   * @output {User with identities}
   */
  getById: protectedProcedure
    .use(requirePermission('users:read'))
    .input(UserIdSchema)
    .query(async ({ input, ctx }) => {
      // RBAC: self-profile or admin only
      if (
        input.id !== ctx.session.user.id &&
        !hasPermission({ role: ctx.session.user.role as Role }, '*:*')
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Puoi visualizzare solo il tuo profilo',
        });
      }

      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          identities: {
            select: {
              id: true,
              provider: true,
              providerId: true,
            },
          },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente non trovato',
        });
      }

      return user;
    }),

  /**
   * Creates a new user with a local identity and hashed password within a transaction.
   *
   * @auth {users:create}
   * @input {CreateUserInputSchema}
   * @output {User (without sensitive fields)}
   */
  create: protectedProcedure
    .use(requirePermission('users:create'))
    .use(withRateLimit('userMutations'))
    .input(CreateUserInputSchema)
    .use(withIdempotency())
    .use(withAuditLog('USER_CREATE', 'User'))
    .mutation(async ({ input, ctx }) => {
      // Verify that email and username don't already exist
      const existingUser = await ctx.prisma.user.findFirst({
        where: {
          OR: [{ email: input.email }, { username: input.username }],
        },
      });

      if (existingUser) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            existingUser.email === input.email
              ? 'Email già esistente'
              : 'Username già esistente',
        });
      }

      // Hash the password with argon2id
      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 1,
      });

      // Create user, identity, and credential in a transaction
      let result;
      try {
        result = await ctx.prisma.$transaction(async tx => {
          // Create user
          const user = await tx.user.create({
            data: {
              email: input.email,
              username: input.username,
              firstName: input.firstName || '',
              lastName: input.lastName || '',
              role: input.role,
              isActive: true,
              pendingApproval: true,
            },
          });

          // Create local identity
          const identity = await tx.identity.create({
            data: {
              userId: user.id,
              provider: 'LOCAL',
              providerId: input.username,
            },
          });

          // Create local credential
          await tx.localCredential.create({
            data: {
              identityId: identity.id,
              passwordHash,
            },
          });

          return user;
        });
      } catch (err) {
        // The uniqueness check above has a race window: a second concurrent
        // request with the same email/username can arrive here before this
        // transaction commits. The DB constraint still holds — here we
        // translate the P2002 into the same CONFLICT as the non-race path,
        // instead of letting it surface as a generic 500.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Email o username già esistente',
            cause: err,
          });
        }
        throw err;
      }

      // Audit logging handled automatically by the withAuditLog middleware

      // Email sending handled via a post-creation UI dialog
      return {
        id: result.id,
        email: result.email,
        username: result.username,
        firstName: result.firstName,
        lastName: result.lastName,
        role: result.role,
        isActive: result.isActive,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
    }),

  /**
   * Updates an existing user's fields, enforcing role/self-modification guards and uniqueness constraints.
   *
   * @auth {users:update}
   * @input {UpdateUserInputSchema}
   * @output {User (without sensitive fields)}
   */
  update: protectedProcedure
    .use(requirePermission('users:update'))
    .use(withRateLimit('userMutations'))
    .input(UpdateUserInputSchema)
    .use(withIdempotency())
    .use(withAuditLog('USER_UPDATE', 'User'))
    .mutation(async ({ input, ctx }) => {
      // `password` is destructured separately from `updateData`: Prisma's `User` has no
      // `password` column (it lives in `LocalCredential.passwordHash` via `Identity`),
      // leaving it inside `updateData` would break `Prisma.UserUpdateInput` at compile time.
      const { id, password, ...updateData } = input;

      // Verify the user exists, with identities
      const existingUser = await ctx.prisma.user.findUnique({
        where: { id },
        include: {
          identities: true,
        },
      });

      if (!existingUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente non trovato',
        });
      }

      if (existingUser.identities.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'User has no identity record — data integrity error',
        });
      }
      // `existingUser` may hold more than one identity (e.g. after `forceLocalAccess` granted a
      // LOCAL identity alongside an existing LDAP one) — `resolveEffectiveProvider` picks the
      // external one deterministically instead of trusting an arbitrary/unordered `identities[0]`.
      const lockedFields = getLockedFields(resolveEffectiveProvider(existingUser.identities));
      const attemptedLockedFields = Object.keys(updateData).filter(field =>
        lockedFields.includes(field as LockedFields)
      );
      if (password !== undefined && lockedFields.includes('password')) {
        attemptedLockedFields.push('password');
      }

      if (attemptedLockedFields.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Campo ${attemptedLockedFields.join(', ')} sincronizzato esternamente e non modificabile`,
        });
      }

      // Protection: prevent self-deactivation
      if (
        updateData.isActive === false &&
        existingUser.id === ctx.session.user.id
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non puoi disattivare il tuo stesso account',
        });
      }

      // Protection: prevent self role-modification
      if (updateData.role && existingUser.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non puoi modificare il tuo stesso ruolo',
        });
      }

      // Protection: password reset restricted to admin (`*:*`) — `users:update` (the
      // permission for this entire procedure) is also granted to `editor`; without this
      // guard an editor could take over any account, including an admin's, by resetting
      // its password and authenticating as it.
      if (
        password !== undefined &&
        !hasPermission({ role: ctx.session.user.role as Role }, '*:*')
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Solo un amministratore può reimpostare la password di un utente',
        });
      }

      // Protection: prevent resetting one's own password from this endpoint — an admin
      // who wants to change their own password uses `me.changePassword` (which requires
      // the current password, a security property this admin-to-admin path doesn't have
      // and must not bypass).
      if (password !== undefined && existingUser.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Usa "Cambia password" nel tuo profilo per modificare la tua password',
        });
      }

      // If updating email or username, verify they don't already exist
      if (updateData.email || updateData.username) {
        const conflictingUser = await ctx.prisma.user.findFirst({
          where: {
            AND: [
              { id: { not: id } },
              {
                OR: [
                  ...(updateData.email ? [{ email: updateData.email }] : []),
                  ...(updateData.username
                    ? [{ username: updateData.username }]
                    : []),
                ],
              },
            ],
          },
        });

        if (conflictingUser) {
          if (conflictingUser.email === updateData.email) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Email già esistente',
            });
          }
          if (conflictingUser.username === updateData.username) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Username già esistente',
            });
          }
        }
      }

      // Hash outside the transaction (argon2 is CPU-bound, it must not hold a
      // DB transaction open). `password` here is already guaranteed to be
      // `undefined` or valid (Zod already applied `.min(12)` upstream, during
      // input parsing).
      const passwordHash =
        password !== undefined ? await hashPassword(password) : undefined;

      // A role change or a deactivation must invalidate already-issued tokens.
      // Without the bump, `verifyTokenVersion` keeps passing and
      // `requirePermission` reads the role from the JWT claim, never from the
      // database: the demotion had no effect until the token expired — and
      // `auth.refreshToken`, which re-signed from that same claim, kept
      // postponing it indefinitely. A demoted admin stayed admin forever.
      // Read inside the transaction (not from `existingUser`, computed earlier):
      // a concurrent promotion/demotion on the same user must not be able to
      // skip either this bump or the last-admin guard below.
      let txResult;
      try {
        txResult = await ctx.prisma.$transaction(async tx => {
          const current = await tx.user.findUnique({
            where: { id },
            select: { role: true, isActive: true },
          });

          if (
            updateData.role !== undefined &&
            updateData.role !== current?.role &&
            !hasPermission({ role: ctx.session.user.role as Role }, '*:*')
          ) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Solo un amministratore può modificare il ruolo di un utente',
            });
          }

          const revokesSessions =
            (updateData.role !== undefined && updateData.role !== current?.role) ||
            (updateData.isActive !== undefined &&
              updateData.isActive !== current?.isActive) ||
            passwordHash !== undefined;

          const removesAdminPrivilege =
            current?.role === 'admin' &&
            ((updateData.role !== undefined && updateData.role !== 'admin') ||
              updateData.isActive === false);

          if (removesAdminPrivilege) {
            await assertNotLastAdminWithSettingsAccess(
              tx,
              id,
              "Non puoi rimuovere i privilegi amministrativi dall'ultimo amministratore del sistema"
            );
          }

          // The guard above + `getLockedFields`/`resolveEffectiveProvider` guarantee that, if we
          // get here with `passwordHash` set, the user has no external identity — but look up the
          // LOCAL identity explicitly rather than indexing `identities[0]`, since that assumption
          // no longer holds for every user (see `resolveEffectiveProvider`).
          if (passwordHash !== undefined) {
            const localIdentity = existingUser.identities.find(i => i.provider === 'LOCAL');
            if (!localIdentity) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'User has no LOCAL identity record — data integrity error',
              });
            }
            await tx.localCredential.update({
              where: { identityId: localIdentity.id },
              data: { passwordHash, updatedAt: new Date() },
            });
          }

          const updated = await tx.user.update({
            where: { id },
            data: {
              ...updateData,
              updatedAt: new Date(),
              ...(revokesSessions ? { tokenVersion: { increment: 1 } } : {}),
            },
          });

          return { updated, revokesSessions, current };
        });
      } catch (err) {
        // Same race window as the check above: a second request with the
        // same email/username can commit between the findFirst and this
        // update. The DB constraint still holds — we translate the P2002
        // into the same CONFLICT as the non-race path.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Email o username già esistente',
            cause: err,
          });
        }
        throw err;
      }
      const { updated: updatedUser, revokesSessions, current } = txResult;

      if (revokesSessions) {
        invalidateTokenVersionCache(id);
      }

      // The mutation is already committed: a notification failure must not
      // masquerade as a failure of the update itself.
      if (updateData.role && updateData.role !== current?.role) {
        invalidateRbacCache();
        try {
          await createNotification(ctx.prisma, {
            userId: input.id,
            category: 'WORKFLOW',
            title: 'Ruolo aggiornato',
            message: `Il tuo ruolo è cambiato da "${current?.role}" a "${updateData.role}"`,
            data: { oldRole: current?.role, newRole: updateData.role },
          });
        } catch (err) {
          ctx.logger.error({ err, userId: input.id }, 'Notifica cambio ruolo fallita dopo update riuscito');
        }
      }

      if (typeof updateData.isActive === 'boolean' && updateData.isActive !== current?.isActive) {
        try {
          await createNotification(ctx.prisma, {
            userId: input.id,
            category: 'WORKFLOW',
            title: updateData.isActive ? 'Account attivato' : 'Account disattivato',
            message: updateData.isActive ? 'Il tuo account è stato attivato' : 'Il tuo account è stato disattivato',
            data: { isActive: updateData.isActive },
          });
        } catch (err) {
          ctx.logger.error({ err, userId: input.id }, 'Notifica cambio stato attivo fallita dopo update riuscito');
        }
      }

      if (passwordHash !== undefined) {
        // Dedicated audit entry (in addition to the generic USER_UPDATE from the
        // `withAuditLog` middleware) — `USER_PASSWORD_RESET_BY_ADMIN` is in
        // `CRITICAL_AUDIT_ACTIONS`, so `logAudit` here rethrows if the write fails
        // instead of swallowing it, same pattern as `PASSWORD_CHANGED` in
        // `auth.service.ts`.
        await logAudit(ctx, {
          action: 'USER_PASSWORD_RESET_BY_ADMIN',
          targetType: 'User',
          targetId: id,
          result: 'SUCCESS',
          metadata: { resetBy: ctx.session.user.id },
        });
        try {
          await createNotification(ctx.prisma, {
            userId: input.id,
            category: 'WORKFLOW',
            title: 'Password reimpostata',
            message: 'La tua password è stata reimpostata da un amministratore',
          });
        } catch (err) {
          ctx.logger.error({ err, userId: input.id }, 'Notifica reset password fallita dopo update riuscito');
        }
      }

      // Audit logging handled automatically by the withAuditLog middleware

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      };
    }),

  /**
   * Soft-deletes a user by setting isActive to false without removing the record.
   *
   * @auth {users:delete}
   * @input {UserIdSchema}
   * @output {void}
   */
  softDelete: protectedProcedure
    .use(requirePermission('users:delete'))
    .use(withRateLimit('userMutations'))
    .input(UserIdSchema)
    .use(withAuditLog('USER_DELETE', 'User'))
    .mutation(deleteUserHandler),

  /**
   * Presence heartbeat: updates the online timestamp for the currently authenticated user.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ ok: true }}
   */
  heartbeat: protectedProcedure.mutation(({ ctx }) => {
    updatePresence(ctx.session.user.id);
    return { ok: true };
  }),

  /**
   * Permanently deletes a user and all cascade relations; blocked for self or last remaining admin.
   *
   * A wrong or missing `confirmPhrase` is rejected in input validation, so it never reaches this
   * body and never reaches the audit log — the same as any other malformed field.
   *
   * @auth {users:delete}
   * @input {UserHardDeleteInputSchema} — user UUID plus the typed confirmation.
   * @output {{ success: true, message: string }}
   */
  hardDelete: protectedProcedure
    .use(requirePermission('users:delete'))
    .use(withRateLimit('userMutations'))
    .input(UserHardDeleteInputSchema)
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente non trovato',
        });
      }

      // Protection: prevent permanent self-deletion
      if (user.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non puoi eliminare definitivamente il tuo stesso account',
        });
      }

      // Hard delete: deletes user and all relations (cascade)
      try {
        const deletedSnapshot = await ctx.prisma.$transaction(async tx => {
          const current = await tx.user.findUnique({
            where: { id: input.id },
            select: { role: true, email: true, username: true },
          });
          if (current && hasPermission({ role: current.role as Role }, '*:*')) {
            await assertNotLastAdminWithSettingsAccess(
              tx,
              input.id,
              "Non puoi eliminare definitivamente l'ultimo amministratore del sistema"
            );
          }

          await tx.user.delete({
            where: { id: input.id },
          });

          return current;
        });

        invalidateTokenVersionCache(input.id);

        // Log SUCCESS after a successful delete — snapshot read inside the
        // transaction (not the outer pre-transaction one): reflects the
        // actually-deleted state even if a concurrent update on the same
        // user happened in the meantime. Falls back to the outer snapshot
        // only in the unlikely case that `current` is null (the user would
        // already be gone anyway, and the delete above would have thrown).
        await logAudit(ctx, {
          action: 'USER_HARD_DELETE',
          targetType: 'User',
          targetId: input.id,
          result: 'SUCCESS',
          metadata: {
            deletedEmail: deletedSnapshot?.email ?? user.email,
            deletedUsername: deletedSnapshot?.username ?? user.username,
            deletedRole: deletedSnapshot?.role ?? user.role,
          },
        });

        return { success: true, message: 'Utente eliminato definitivamente' };
      } catch (error) {
        // Log FAILURE in catch
        await logAudit(ctx, {
          action: 'USER_HARD_DELETE',
          targetType: 'User',
          targetId: input.id,
          result: 'FAILURE',
          metadata: {
            errorCode: toErrorCode(error),
            errorMessage: toErrorMessage(error).substring(0, 100),
          },
        });
        throw error;
      }
    }),
});
