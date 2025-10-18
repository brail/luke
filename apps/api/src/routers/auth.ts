/**
 * Router tRPC per autenticazione
 * Gestisce login, logout e verifica sessione
 */

import { z } from 'zod';
import argon2 from 'argon2';
import { router, publicProcedure, protectedProcedure } from '../lib/trpc';
import { createToken } from '../lib/auth';
import { getConfig } from '../lib/configManager';
import { authenticateViaLdap } from '../lib/ldapAuth';
import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { TRPCError } from '@trpc/server';
import type { PrismaClient, User } from '@prisma/client';

/**
 * Autentica un utente con credenziali locali
 * @param prisma - Client Prisma
 * @param username - Username dell'utente
 * @param password - Password dell'utente
 * @returns User object se autenticazione riuscita, null altrimenti
 */
async function authenticateLocal(
  prisma: PrismaClient,
  username: string,
  password: string
): Promise<User | null> {
  // Trova l'utente e la sua identità locale
  const user = await prisma.user.findFirst({
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
    return null;
  }

  // Verifica la password
  const isValidPassword = await argon2.verify(
    user.identities[0].localCredential.passwordHash,
    password
  );

  if (!isValidPassword) {
    return null;
  }

  return user;
}

/**
 * Schema per login
 */
const LoginSchema = z.object({
  username: z.string().min(1, 'Username richiesto'),
  password: z.string().min(1, 'Password richiesta'),
});

/**
 * Router per autenticazione
 */
export const authRouter = router({
  /**
   * Login utente con fallback LDAP configurabile
   */
  login: publicProcedure
    .use(withRateLimit('login'))
    .use(withIdempotency())
    .input(LoginSchema)
    .mutation(async ({ input, ctx }) => {
      const { username, password } = input;

      // Recupera la strategia di autenticazione
      const strategy =
        (await getConfig(ctx.prisma, 'auth.strategy', false)) || 'local-first';

      console.log(`Authentication strategy: ${strategy} for user: ${username}`);

      let authenticatedUser = null;
      let authMethod = '';

      try {
        switch (strategy) {
          case 'local-only':
            authenticatedUser = await authenticateLocal(
              ctx.prisma,
              username,
              password
            );
            authMethod = 'local';
            break;

          case 'ldap-only':
            authenticatedUser = await authenticateViaLdap(
              ctx.prisma,
              username,
              password
            );
            authMethod = 'ldap';
            break;

          case 'local-first':
            // Prova prima autenticazione locale
            authenticatedUser = await authenticateLocal(
              ctx.prisma,
              username,
              password
            );
            authMethod = 'local';

            // Se fallisce, prova LDAP
            if (!authenticatedUser) {
              console.log(`Local auth failed for ${username}, trying LDAP...`);
              try {
                authenticatedUser = await authenticateViaLdap(
                  ctx.prisma,
                  username,
                  password
                );
                authMethod = 'ldap';
              } catch (ldapError: unknown) {
                const errorMessage =
                  ldapError instanceof Error
                    ? ldapError.message
                    : 'Unknown LDAP error';
                console.log(
                  `LDAP connection error for ${username}:`,
                  errorMessage
                );
                // Se LDAP non è raggiungibile, mantieni null (autenticazione fallita)
              }
            }
            break;

          case 'ldap-first':
            // Prova prima LDAP
            try {
              authenticatedUser = await authenticateViaLdap(
                ctx.prisma,
                username,
                password
              );
              authMethod = 'ldap';

              // Se fallisce, prova autenticazione locale
              if (!authenticatedUser) {
                console.log(
                  `LDAP auth failed for ${username}, trying local...`
                );
                authenticatedUser = await authenticateLocal(
                  ctx.prisma,
                  username,
                  password
                );
                authMethod = 'local';
              }
            } catch (ldapError: unknown) {
              const errorMessage =
                ldapError instanceof Error
                  ? ldapError.message
                  : 'Unknown LDAP error';
              console.log(
                `LDAP connection error for ${username}, falling back to local:`,
                errorMessage
              );
              // Se LDAP non è raggiungibile, fallback a locale
              authenticatedUser = await authenticateLocal(
                ctx.prisma,
                username,
                password
              );
              authMethod = 'local';
            }
            break;

          default:
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Strategia di autenticazione non valida: ${strategy}`,
            });
        }

        if (!authenticatedUser) {
          // Log tentativo di login fallito
          await logAudit(ctx, {
            action: 'login_failed',
            resource: 'auth',
            ipAddress: ctx.req.ip,
            metadata: {
              username: input.username,
              reason: 'invalid_credentials',
              strategy,
            },
          });

          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Credenziali non valide',
          });
        }

        // Aggiorna statistiche login
        await ctx.prisma.user.update({
          where: { id: authenticatedUser.id },
          data: {
            lastLoginAt: new Date(),
            loginCount: { increment: 1 },
          },
        });

        // Log accesso in AuditLog
        await logAudit(ctx, {
          action: 'login',
          resource: 'auth',
          targetUserId: authenticatedUser.id,
          ipAddress: ctx.req.ip,
          metadata: {
            provider: authMethod,
            success: true,
            userAgent: ctx.req.headers['user-agent'],
            strategy,
          },
        });

        // Crea il token JWT con tokenVersion
        const token = createToken({
          id: authenticatedUser.id,
          email: authenticatedUser.email,
          username: authenticatedUser.username,
          role: authenticatedUser.role,
          tokenVersion: authenticatedUser.tokenVersion,
        });

        // Cookie API rimosso: Web usa solo Authorization header

        console.log(
          `Authentication successful for ${username} via ${authMethod}`
        );

        // Restituisce i dati utente per la sessione
        return {
          user: {
            id: authenticatedUser.id,
            email: authenticatedUser.email,
            username: authenticatedUser.username,
            firstName: authenticatedUser.firstName,
            lastName: authenticatedUser.lastName,
            role: authenticatedUser.role,
            isActive: authenticatedUser.isActive,
          },
          token,
          authMethod,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error(`Authentication error for ${username}:`, error);
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Credenziali non valide',
        });
      }
    }),

  /**
   * Logout utente (soft logout)
   * Rimuove solo la sessione corrente, mantiene altre sessioni attive
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // Cookie API rimosso: Web gestisce logout tramite NextAuth signOut()
    return { success: true, message: 'Logout effettuato con successo' };
  }),

  /**
   * Logout hard - Revoca tutte le sessioni dell'utente
   * Invalida tokenVersion per forzare re-login su tutti i dispositivi
   */
  logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
    // Incrementa tokenVersion per invalidare tutte le sessioni
    await ctx.prisma.user.update({
      where: { id: ctx.session.user.id },
      data: { tokenVersion: { increment: 1 } },
    });

    // Invalida la cache tokenVersion per questo utente
    const { invalidateTokenVersionCache } = await import('../lib/trpc');
    invalidateTokenVersionCache(ctx.session.user.id);

    // Log audit per revoca sessioni
    await logAudit(ctx, {
      action: 'logout_all_sessions',
      resource: 'security',
      targetUserId: ctx.session.user.id,
      metadata: {
        success: true,
        reason: 'user_initiated',
      },
    });

    return {
      success: true,
      message:
        'Tutte le sessioni sono state revocate. Effettua nuovamente il login.',
    };
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
});
