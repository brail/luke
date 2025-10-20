/**
 * Router tRPC per gestione utenti
 * Implementa CRUD completo per User, Identity e LocalCredential
 */

import { randomBytes, createHash } from 'crypto';

import { TRPCError } from '@trpc/server';
import argon2 from 'argon2';
import { z } from 'zod';

import {
  // UserSchema,
  CreateUserInputSchema,
  UpdateUserInputSchema,
  type LockedFields,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { withAuditLog } from '../lib/auditMiddleware';
import { getConfig } from '../lib/configManager';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { sendEmailVerificationEmail } from '../lib/mailer';
import { withRateLimit } from '../lib/ratelimit';
import {
  router,
  // publicProcedure,
  protectedProcedure,
  adminProcedure,
  adminOrEditorProcedure,
  invalidateTokenVersionCache,
} from '../lib/trpc';

/**
 * Helper per determinare i campi bloccati in base al provider
 */
function getLockedFields(provider: string): LockedFields[] {
  if (provider === 'LOCAL') {
    return [];
  }
  // Per provider esterni (LDAP, OIDC), blocca i campi sincronizzati
  if (provider === 'LDAP') {
    // Per LDAP: username non modificabile, firstName/lastName sincronizzati, password gestita da LDAP
    return ['username', 'firstName', 'lastName', 'password'];
  }
  // Per altri provider esterni (OIDC), blocca solo i campi sempre sincronizzati
  return ['firstName', 'lastName', 'password'];
}

// /**
//  * Verifica se un campo è bloccato per l'utente
//  */
// function _isFieldLocked(user: any, field: string): boolean {
//   const provider = user?.identities?.[0]?.provider || 'LOCAL';
//   const lockedFields = getLockedFields(provider);
//   return lockedFields.includes(field as LockedFields);
// }

/**
 * Handler comune per soft delete utente
 * Imposta isActive = false invece di eliminare il record
 */
async function deleteUserHandler({
  input,
  ctx,
}: {
  input: z.infer<typeof UserIdSchema>;
  ctx: any;
}) {
  const user = await ctx.prisma.user.findUnique({
    where: { id: input.id },
  });

  if (!user) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Utente non trovato',
    });
  }

  // Protezione: impedisci auto-eliminazione
  if (user.id === ctx.session.user.id) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Non puoi disattivare il tuo stesso account',
    });
  }

  // Protezione: impedisci eliminazione dell'ultimo admin
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
        message: "Non puoi eliminare l'ultimo amministratore del sistema",
      });
    }
  }

  // Soft delete: imposta isActive = false
  const deletedUser = await ctx.prisma.user.update({
    where: { id: input.id },
    data: {
      isActive: false,
      updatedAt: new Date(),
    },
  });

  // Audit logging gestito automaticamente dal middleware withAuditLog

  return {
    id: deletedUser.id,
    email: deletedUser.email,
    username: deletedUser.username,
    firstName: deletedUser.firstName,
    lastName: deletedUser.lastName,
    role: deletedUser.role,
    isActive: deletedUser.isActive,
    createdAt: deletedUser.createdAt,
    updatedAt: deletedUser.updatedAt,
  };
}

/**
 * Schema per ID utente
 */
const UserIdSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
});

/**
 * Router per gestione utenti
 */
export const usersRouter = router({
  /**
   * Lista tutti gli utenti con paginazione e filtri
   * Richiede ruolo admin o editor
   */
  list: adminOrEditorProcedure
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

      const where: any = {};

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

      return {
        users,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  /**
   * Ottiene un utente per ID
   * Richiede autenticazione - solo self-profile o admin
   */
  getById: protectedProcedure
    .input(UserIdSchema)
    .query(async ({ input, ctx }) => {
      // RBAC: solo self-profile o admin
      if (
        input.id !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
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
   * Richiede ruolo admin
   */
  create: adminProcedure
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

      // Invio automatico email di verifica (best effort, non blocca se fallisce)
      let emailSent = false;
      try {
        // Genera token random (32 byte = 64 caratteri hex)
        const token = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(token).digest('hex');

        // Calcola scadenza: 24 ore
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // Salva token hash in DB
        await ctx.prisma.userToken.create({
          data: {
            userId: result.id,
            type: 'VERIFY',
            tokenHash,
            expiresAt,
          },
        });

        // Recupera base URL
        const baseUrl =
          (await getConfig(ctx.prisma, 'app.baseUrl', false)) ||
          process.env.APP_BASE_URL ||
          'http://localhost:3000';

        // Invia email di verifica
        await sendEmailVerificationEmail(
          ctx.prisma,
          result.email,
          token,
          baseUrl
        );

        emailSent = true;

        ctx.logger.info('✉️ Email di verifica inviata automaticamente', {
          userId: result.id,
          email: result.email,
        });

        // Log audit SUCCESS
        await logAudit(ctx, {
          action: 'EMAIL_VERIFICATION_SENT',
          targetType: 'Auth',
          targetId: result.id,
          result: 'SUCCESS',
          metadata: {
            automatic: true,
            expiresAt: expiresAt.toISOString(),
          },
        });
      } catch (error) {
        // Silent fail: non blocca la creazione utente
        ctx.logger.warn(
          '⚠️ Email di verifica non inviata (SMTP non configurato o errore)',
          {
            userId: result.id,
            email: result.email,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );

        // Log audit WARNING (non FAILURE)
        await logAudit(ctx, {
          action: 'EMAIL_VERIFICATION_SENT',
          targetType: 'Auth',
          targetId: result.id,
          result: 'FAILURE',
          metadata: {
            automatic: true,
            reason: 'smtp_not_configured_or_error',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }

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
        emailVerificationSent: emailSent, // Indica se l'email è stata inviata
      };
    }),

  /**
   * Aggiorna un utente esistente
   * Richiede ruolo admin
   */
  update: adminProcedure
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

      // Verifica campi bloccati per provider esterni
      const lockedFields = getLockedFields(
        existingUser.identities[0]?.provider || 'LOCAL'
      );
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
   * @deprecated Usa `softDelete` per evitare conflitti con checker tRPC
   * Richiede ruolo admin
   */
  delete: adminProcedure
    .use(withRateLimit('userMutations'))
    .input(UserIdSchema)
    .mutation(deleteUserHandler),

  /**
   * Elimina un utente (soft delete)
   * Imposta isActive = false invece di eliminare il record
   * Richiede ruolo admin
   */
  softDelete: adminProcedure
    .use(withRateLimit('userMutations'))
    .use(withAuditLog('USER_DELETE', 'User'))
    .input(UserIdSchema)
    .mutation(deleteUserHandler),

  /**
   * Hard delete di un utente (elimina completamente dal database)
   * ATTENZIONE: Questa operazione è irreversibile
   * Richiede ruolo admin
   */
  hardDelete: adminProcedure
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

  /**
   * Revoca tutte le sessioni di un utente specifico
   * Richiede ruolo admin
   */
  revokeUserSessions: adminProcedure
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
});
