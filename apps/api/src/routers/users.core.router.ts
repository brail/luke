/**
 * Core CRUD procedures per utenti
 * list, getById, create, update, softDelete, hardDelete
 */

import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import argon2 from 'argon2';
import { z } from 'zod';

import { CreateUserInputSchema, UpdateUserInputSchema, hasPermission } from '@luke/core';
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
import { deleteUserHandler, getLockedFields, UserIdSchema } from '../services/users.service';

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
        // Il provider non è una colonna ordinabile in DB (deriva dalla prima
        // identity collegata): serve l'intero result set per ordinare
        // correttamente, non solo la pagina — altrimenti l'ordinamento vale
        // solo dentro la pagina già estratta, non a livello globale.
        const all = await ctx.prisma.user.findMany({ where, select: selectFields });
        all.sort((a, b) => {
          const providerA = a.identities?.[0]?.provider || 'LOCAL';
          const providerB = b.identities?.[0]?.provider || 'LOCAL';
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
            orderBy: { [sortBy]: sortOrder },
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
      // RBAC: solo self-profile o admin
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
      // Verifica che email e username non esistano già
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

      // Hash della password con argon2id
      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 1,
      });

      // Crea utente, identità e credenziale in una transazione
      let result;
      try {
        result = await ctx.prisma.$transaction(async tx => {
          // Crea utente
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

          // Crea identità locale
          const identity = await tx.identity.create({
            data: {
              userId: user.id,
              provider: 'LOCAL',
              providerId: input.username,
            },
          });

          // Crea credenziale locale
          await tx.localCredential.create({
            data: {
              identityId: identity.id,
              passwordHash,
            },
          });

          return user;
        });
      } catch (err) {
        // Il check di unicità sopra ha una finestra di race: una seconda
        // richiesta concorrente con la stessa email/username può arrivare
        // qui prima che questa transazione committi. Il vincolo DB tiene
        // comunque — qui traduciamo il P2002 nello stesso CONFLICT del
        // percorso non-race, invece di lasciarlo emergere come 500 generico.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Email o username già esistente',
            cause: err,
          });
        }
        throw err;
      }

      // Audit logging gestito automaticamente dal middleware withAuditLog

      // Invio email gestito via UI dialog post-creazione
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
      // `password` è destructurato separatamente da `updateData`: `User` in Prisma non ha
      // una colonna `password` (vive in `LocalCredential.passwordHash` via `Identity`),
      // lasciarlo dentro `updateData` romperebbe `Prisma.UserUpdateInput` a compile time.
      const { id, password, ...updateData } = input;

      // Verifica che l'utente esista con identities
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
      const lockedFields = getLockedFields(existingUser.identities[0].provider);
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

      // Protezione: impedisci auto-disabilitazione
      if (
        updateData.isActive === false &&
        existingUser.id === ctx.session.user.id
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non puoi disattivare il tuo stesso account',
        });
      }

      // Protezione: impedisci auto-modifica del ruolo
      if (updateData.role && existingUser.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non puoi modificare il tuo stesso ruolo',
        });
      }

      // Protezione: reset password riservato ad admin (`*:*`) — `users:update` (il permesso
      // di questa intera procedura) è concesso anche a `editor`; senza questo guard un
      // editor potrebbe impossessarsi di qualunque account, incluso un admin, resettandone
      // la password e autenticandosi come lui.
      if (
        password !== undefined &&
        !hasPermission({ role: ctx.session.user.role as Role }, '*:*')
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Solo un amministratore può reimpostare la password di un utente',
        });
      }

      // Protezione: impedisci reset della propria password da questo endpoint — un admin
      // che vuole cambiare la propria password usa `me.changePassword` (richiede la password
      // corrente, proprietà di sicurezza che questo path admin-to-admin non ha e non deve
      // bypassare).
      if (password !== undefined && existingUser.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Usa "Cambia password" nel tuo profilo per modificare la tua password',
        });
      }

      // Se si sta aggiornando email o username, verifica che non esistano già
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

      // Hash fuori dalla transazione (argon2 è CPU-bound, non deve tenere aperta
      // una transazione DB). `password` qui è già garantito `undefined` o valido
      // (Zod ha già applicato `.min(12)` a monte, in fase di parsing dell'input).
      const passwordHash =
        password !== undefined ? await hashPassword(password) : undefined;

      // Un cambio di ruolo o una disattivazione devono invalidare i token già
      // emessi. Senza il bump, `verifyTokenVersion` continua a passare e
      // `requirePermission` legge il ruolo dal claim JWT, mai dal database: la
      // retrocessione non aveva alcun effetto fino alla scadenza del token — e
      // `auth.refreshToken`, che rifirmava a partire dallo stesso claim, la
      // rimandava indefinitamente. Un admin declassato restava admin per sempre.
      // Letto dentro la transazione (non da `existingUser`, calcolato prima):
      // una promozione/demozione concorrente sullo stesso utente non deve poter
      // far saltare né questo bump né la guardia ultimo-admin sotto.
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

          // Guard sopra + `getLockedFields` garantiscono, se arriviamo qui con
          // `passwordHash` impostato, che il provider sia LOCAL — `identities[0]` è
          // quindi la credenziale LOCAL da aggiornare.
          if (passwordHash !== undefined) {
            await tx.localCredential.update({
              where: { identityId: existingUser.identities[0].id },
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
        // Stessa finestra di race del check sopra: una seconda richiesta con
        // la stessa email/username può committare fra il findFirst e questo
        // update. Il vincolo DB tiene comunque — traduciamo il P2002 nello
        // stesso CONFLICT del percorso non-race.
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

      // La mutation è già committata: un fallimento della notifica non deve
      // travestirsi da fallimento dell'update stesso.
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
        // Voce di audit dedicata (in aggiunta al generico USER_UPDATE del middleware
        // `withAuditLog`) — `USER_PASSWORD_RESET_BY_ADMIN` è in `CRITICAL_AUDIT_ACTIONS`,
        // quindi `logAudit` qui rilancia se il write fallisce invece di ingoiarlo, stesso
        // pattern di `PASSWORD_CHANGED` in `auth.service.ts`.
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

      // Audit logging gestito automaticamente dal middleware withAuditLog

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
   * @auth {users:delete}
   * @input {UserIdSchema}
   * @output {{ success: true, message: string }}
   */
  hardDelete: protectedProcedure
    .use(requirePermission('users:delete'))
    .use(withRateLimit('userMutations'))
    .input(UserIdSchema)
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

      // Protezione: impedisci auto-eliminazione definitiva
      if (user.id === ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Non puoi eliminare definitivamente il tuo stesso account',
        });
      }

      // Hard delete: elimina utente e tutte le relazioni (cascade)
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

        // Log SUCCESS dopo delete riuscita — snapshot letto dentro la
        // transazione (non quello pre-transazione fuori): riflette lo stato
        // realmente cancellato anche se un'update concorrente sullo stesso
        // utente è avvenuta nel frattempo. Fallback allo snapshot esterno
        // solo nell'improbabile caso in cui `current` sia null (l'utente
        // sarebbe comunque già sparito, e la delete sopra avrebbe lanciato).
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
