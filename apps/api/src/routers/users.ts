/**
 * Router tRPC per gestione utenti
 * Implementa CRUD completo per User, Identity e LocalCredential
 */

import { z } from 'zod';
import argon2 from 'argon2';
import { router, loggedProcedure, publicProcedure } from '../lib/trpc';
import { UserSchema, Role } from '@luke/core';

/**
 * Schema per creazione utente
 */
const CreateUserSchema = z.object({
  email: z.string().email('Email non valida'),
  username: z.string().min(3, 'Username deve essere di almeno 3 caratteri'),
  password: z.string().min(8, 'Password deve essere di almeno 8 caratteri'),
  role: z.enum(['admin', 'editor', 'viewer'] as const),
});

/**
 * Schema per aggiornamento utente
 */
const UpdateUserSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
  email: z.string().email('Email non valida').optional(),
  username: z
    .string()
    .min(3, 'Username deve essere di almeno 3 caratteri')
    .optional(),
  role: z.enum(['admin', 'editor', 'viewer'] as const).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Schema per ID utente
 */
const UserIdSchema = z.object({
  id: z.string().uuid('ID utente non valido'),
});

/**
 * Schema per autenticazione
 */
const AuthenticateSchema = z.object({
  username: z.string().min(1, 'Username richiesto'),
  password: z.string().min(1, 'Password richiesta'),
});

/**
 * Router per gestione utenti
 */
export const usersRouter = router({
  /**
   * Autentica un utente con username e password
   */
  authenticate: publicProcedure
    .input(AuthenticateSchema)
    .mutation(async ({ input, ctx }) => {
      const { username, password } = input;

      // Trova l'utente e la sua identità locale
      const user = await ctx.prisma.user.findFirst({
        where: {
          username,
          isActive: true, // Solo utenti attivi possono autenticarsi
        },
        include: {
          identities: {
            where: {
              provider: 'LOCAL',
              providerId: username,
            },
            include: {
              localCredential: true,
            },
          },
        },
      });

      if (!user || !user.identities[0]?.localCredential) {
        throw new Error('Credenziali non valide');
      }

      // Verifica la password
      const isValidPassword = await argon2.verify(
        user.identities[0].localCredential.passwordHash,
        password
      );

      if (!isValidPassword) {
        throw new Error('Credenziali non valide');
      }

      // Restituisce i dati utente per la sessione
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
      };
    }),

  /**
   * Lista tutti gli utenti con paginazione e filtri
   */
  list: publicProcedure
    .input(
      z
        .object({
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(10),
          search: z.string().optional(),
          role: z.enum(['admin', 'editor', 'viewer']).optional(),
          sortBy: z
            .enum(['email', 'username', 'role', 'isActive', 'createdAt'])
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

      const where = {
        ...(search && {
          OR: [
            { email: { contains: search } },
            { username: { contains: search } },
          ],
        }),
        ...(role && { role }),
      };

      const [users, total] = await ctx.prisma.$transaction([
        ctx.prisma.user.findMany({
          where,
          skip,
          take: limit,
          include: {
            identities: {
              include: {
                localCredential: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        users: users.map(user => ({
          ...user,
          // Nascondi password hash dalla risposta
          identities: user.identities.map(identity => ({
            ...identity,
            localCredential: identity.localCredential
              ? {
                  id: identity.localCredential.id,
                  createdAt: identity.localCredential.createdAt,
                  updatedAt: identity.localCredential.updatedAt,
                  // Non esporre passwordHash
                }
              : null,
          })),
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  /**
   * Ottiene un utente per ID
   */
  getById: loggedProcedure.input(UserIdSchema).query(async ({ input, ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: input.id },
      include: {
        identities: {
          include: {
            localCredential: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('Utente non trovato');
    }

    return {
      ...user,
      // Nascondi password hash dalla risposta
      identities: user.identities.map(identity => ({
        ...identity,
        localCredential: identity.localCredential
          ? {
              id: identity.localCredential.id,
              createdAt: identity.localCredential.createdAt,
              updatedAt: identity.localCredential.updatedAt,
              // Non esporre passwordHash
            }
          : null,
      })),
    };
  }),

  /**
   * Crea un nuovo utente con identità locale
   */
  create: loggedProcedure
    .input(CreateUserSchema)
    .mutation(async ({ input, ctx }) => {
      // Verifica che email e username non esistano già
      const existingUser = await ctx.prisma.user.findFirst({
        where: {
          OR: [{ email: input.email }, { username: input.username }],
        },
      });

      if (existingUser) {
        throw new Error(
          existingUser.email === input.email
            ? 'Email già esistente'
            : 'Username già esistente'
        );
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

      return {
        id: result.id,
        email: result.email,
        username: result.username,
        role: result.role,
        isActive: result.isActive,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
    }),

  /**
   * Aggiorna un utente esistente
   */
  update: loggedProcedure
    .input(UpdateUserSchema)
    .mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input;

      // Verifica che l'utente esista
      const existingUser = await ctx.prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new Error('Utente non trovato');
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
            throw new Error('Email già esistente');
          }
          if (conflictingUser.username === updateData.username) {
            throw new Error('Username già esistente');
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

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      };
    }),

  /**
   * Elimina un utente (soft delete)
   */
  delete: loggedProcedure
    .input(UserIdSchema)
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
      });

      if (!user) {
        throw new Error('Utente non trovato');
      }

      // Soft delete: imposta isActive = false
      const deletedUser = await ctx.prisma.user.update({
        where: { id: input.id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      return {
        id: deletedUser.id,
        email: deletedUser.email,
        username: deletedUser.username,
        role: deletedUser.role,
        isActive: deletedUser.isActive,
        createdAt: deletedUser.createdAt,
        updatedAt: deletedUser.updatedAt,
      };
    }),

  /**
   * Hard delete di un utente (elimina completamente dal database)
   * ATTENZIONE: Questa operazione è irreversibile
   */
  hardDelete: loggedProcedure
    .input(UserIdSchema)
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
      });

      if (!user) {
        throw new Error('Utente non trovato');
      }

      // Hard delete: elimina utente e tutte le relazioni (cascade)
      await ctx.prisma.user.delete({
        where: { id: input.id },
      });

      return { success: true, message: 'Utente eliminato definitivamente' };
    }),
});
