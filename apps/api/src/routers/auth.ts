/**
 * Router tRPC per autenticazione
 * Gestisce login, logout e verifica sessione
 */

import { z } from 'zod';
import argon2 from 'argon2';
import { router, publicProcedure, protectedProcedure } from '../lib/trpc';
import { createToken, setSessionCookie, clearSessionCookie } from '../lib/auth';
import { TRPCError } from '@trpc/server';

/**
 * Schema per login
 */
const LoginSchema = z.object({
  username: z.string().min(1, 'Username richiesto'),
  password: z.string().min(1, 'Password richiesta'),
});

/**
 * Schema per cambio password
 */
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Password attuale richiesta'),
  newPassword: z
    .string()
    .min(8, 'Nuova password deve essere di almeno 8 caratteri'),
});

/**
 * Router per autenticazione
 */
export const authRouter = router({
  /**
   * Login utente
   */
  login: publicProcedure.input(LoginSchema).mutation(async ({ input, ctx }) => {
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
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Credenziali non valide',
      });
    }

    // Verifica la password
    const isValidPassword = await argon2.verify(
      user.identities[0].localCredential.passwordHash,
      password
    );

    if (!isValidPassword) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Credenziali non valide',
      });
    }

    // Crea il token JWT
    const token = createToken({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    });

    // Imposta il cookie di sessione
    setSessionCookie(ctx.res, token);

    // Restituisce i dati utente per la sessione
    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
      },
      token,
    };
  }),

  /**
   * Logout utente
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // Rimuovi il cookie di sessione
    clearSessionCookie(ctx.res);

    return { success: true, message: 'Logout effettuato con successo' };
  }),

  /**
   * Verifica sessione corrente
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // La sessione è già verificata dal middleware
    return {
      user: ctx.session.user,
    };
  }),

  /**
   * Cambia password utente
   */
  changePassword: protectedProcedure
    .input(ChangePasswordSchema)
    .mutation(async ({ input, ctx }) => {
      const { currentPassword, newPassword } = input;
      const userId = ctx.session.user.id;

      // Trova l'utente e la sua identità locale
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        include: {
          identities: {
            where: {
              provider: 'LOCAL',
            },
            include: {
              localCredential: true,
            },
          },
        },
      });

      if (!user || !user.identities[0]?.localCredential) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Utente non trovato',
        });
      }

      // Verifica la password attuale
      const isValidPassword = await argon2.verify(
        user.identities[0].localCredential.passwordHash,
        currentPassword
      );

      if (!isValidPassword) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Password attuale non corretta',
        });
      }

      // Hash della nuova password
      const newPasswordHash = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 1,
      });

      // Aggiorna la password
      await ctx.prisma.localCredential.update({
        where: {
          id: user.identities[0].localCredential.id,
        },
        data: {
          passwordHash: newPasswordHash,
          updatedAt: new Date(),
        },
      });

      return { success: true, message: 'Password aggiornata con successo' };
    }),
});
