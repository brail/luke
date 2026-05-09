/**
 * Core CRUD procedures per utenti
 * list, getById, create, update, softDelete, hardDelete
 */

import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { z } from 'zod';

import { CreateUserInputSchema, UpdateUserInputSchema, hasPermission } from '@luke/core';
import type { LockedFields, Role } from '@luke/core';
import { invalidateRbacCache } from '@luke/core/server';

import { logAudit } from '../lib/auditLog';
import { withAuditLog } from '../lib/auditMiddleware';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { requirePermission } from '../lib/permissions';
import { getOnlineUserIds, updatePresence } from '../lib/presenceStore';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

import { deleteUserHandler, getLockedFields, UserIdSchema } from '../services/users.service';

export const usersCoreRouter = router({
  /**
   * Lista tutti gli utenti con paginazione e filtri
   * Richiede permission users:read
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

      const [users, total] = await ctx.prisma.$transaction([
        ctx.prisma.user.findMany({
          where,
          skip,
          take: limit,
          select: {
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
          },
          orderBy:
            sortBy === 'provider'
              ? undefined // Ordinamento per provider gestito dopo
              : {
                  [sortBy]: sortOrder,
                },
        }),
        ctx.prisma.user.count({ where }),
      ]);

      // Ordinamento per provider se richiesto
      if (sortBy === 'provider') {
        users.sort((a, b) => {
          const providerA = a.identities?.[0]?.provider || 'LOCAL';
          const providerB = b.identities?.[0]?.provider || 'LOCAL';
          const comparison = providerA.localeCompare(providerB);
          return sortOrder === 'asc' ? comparison : -comparison;
        });
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
   * Ottiene un utente per ID
   * Richiede permission users:read - solo self-profile o admin
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
   * Crea un nuovo utente con identità locale
   * Richiede permission users:create
   */
  create: protectedProcedure
    .use(requirePermission('users:create'))
    .use(withRateLimit('userMutations'))
    .use(withIdempotency())
    .use(withAuditLog('USER_CREATE', 'User'))
    .input(CreateUserInputSchema)
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
      const result = await ctx.prisma.$transaction(async tx => {
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
   * Aggiorna un utente esistente
   * Richiede permission users:update
   */
  update: protectedProcedure
    .use(requirePermission('users:update'))
    .use(withRateLimit('userMutations'))
    .use(withIdempotency())
    .use(withAuditLog('USER_UPDATE', 'User'))
    .input(UpdateUserInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input;

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

      // Protezione: impedisci rimozione ruolo admin dall'ultimo admin
      if (
        existingUser.role === 'admin' &&
        updateData.role &&
        updateData.role !== 'admin'
      ) {
        const adminCount = await ctx.prisma.user.count({
          where: {
            role: 'admin',
            isActive: true,
          },
        });

        if (adminCount <= 1) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              "Non puoi rimuovere il ruolo admin dall'ultimo amministratore del sistema",
          });
        }
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

      const updatedUser = await ctx.prisma.user.update({
        where: { id },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
      });

      if (updateData.role && updateData.role !== existingUser.role) {
        invalidateRbacCache();
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
   * Elimina un utente (soft delete)
   * Imposta isActive = false invece di eliminare il record
   * Richiede permission users:delete
   */
  softDelete: protectedProcedure
    .use(requirePermission('users:delete'))
    .use(withRateLimit('userMutations'))
    .use(withAuditLog('USER_DELETE', 'User'))
    .input(UserIdSchema)
    .mutation(deleteUserHandler),

  /**
   * Heartbeat di presenza: aggiorna il timestamp online dell'utente corrente.
   * Chiamato ogni 60s dal client autenticato.
   */
  heartbeat: protectedProcedure.mutation(({ ctx }) => {
    updatePresence(ctx.session.user.id);
    return { ok: true };
  }),

  /**
   * Hard delete di un utente (elimina completamente dal database)
   * ATTENZIONE: Questa operazione è irreversibile
   * Richiede permission users:delete
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

      // Protezione: impedisci eliminazione definitiva dell'ultimo admin
      if (user.role === 'admin') {
        const adminCount = await ctx.prisma.user.count({
          where: {
            role: 'admin',
            isActive: true,
          },
        });

        if (adminCount <= 1) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              "Non puoi eliminare definitivamente l'ultimo amministratore del sistema",
          });
        }
      }

      // Hard delete: elimina utente e tutte le relazioni (cascade)
      try {
        await ctx.prisma.user.delete({
          where: { id: input.id },
        });

        // Log SUCCESS dopo delete riuscita
        await logAudit(ctx, {
          action: 'USER_HARD_DELETE',
          targetType: 'User',
          targetId: input.id,
          result: 'SUCCESS',
          metadata: {
            deletedEmail: user.email,
            deletedUsername: user.username,
            deletedRole: user.role,
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
            errorCode: (error as any).code || 'UNKNOWN',
            errorMessage: (error as any).message?.substring(0, 100),
          },
        });
        throw error;
      }
    }),
});
