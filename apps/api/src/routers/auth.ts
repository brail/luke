/**
 * Router tRPC per autenticazione
 * Gestisce login, logout e verifica sessione
 */

import { randomBytes, createHash } from 'crypto';

import { TRPCError } from '@trpc/server';
import argon2 from 'argon2';
import { z } from 'zod';

import {
  RequestPasswordResetSchema,
  ConfirmPasswordResetSchema,
  RequestEmailVerificationSchema,
  ConfirmEmailVerificationSchema,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { createToken } from '../lib/auth';
import { getConfig, getPasswordPolicy } from '../lib/configManager';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { authenticateViaLdap } from '../lib/ldapAuth';
import {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} from '../lib/mailer';
import { validatePassword } from '../lib/password';
import { withRateLimit } from '../lib/ratelimit';
import { router, publicProcedure, protectedProcedure } from '../lib/trpc';

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
                if (ldapError instanceof TRPCError) {
                  if (
                    ldapError.code === 'SERVICE_UNAVAILABLE' ||
                    ldapError.code === 'BAD_GATEWAY'
                  ) {
                    console.log(
                      `LDAP unavailable for ${username}, skipping fallback`
                    );
                    // LDAP down - mantieni null (autenticazione fallita)
                  } else {
                    // UNAUTHORIZED, BAD_REQUEST, etc. - non fare fallback per sicurezza
                    throw ldapError;
                  }
                } else {
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
              if (ldapError instanceof TRPCError) {
                // SOLO fallback per errori infrastrutturali
                if (
                  ldapError.code === 'SERVICE_UNAVAILABLE' ||
                  ldapError.code === 'BAD_GATEWAY'
                ) {
                  console.log(
                    `LDAP unavailable for ${username}, falling back to local`
                  );
                  authenticatedUser = await authenticateLocal(
                    ctx.prisma,
                    username,
                    password
                  );
                  authMethod = 'local';
                } else {
                  // UNAUTHORIZED, BAD_REQUEST, etc. - NON fare fallback per sicurezza
                  throw ldapError;
                }
              } else {
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
            action: 'AUTH_LOGIN_FAILED',
            targetType: 'Auth',
            result: 'FAILURE',
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

        // Verifica se l'email è verificata (solo per utenti LOCAL)
        const requireEmailVerification =
          (await getConfig(
            ctx.prisma,
            'auth.requireEmailVerification',
            false
          )) === 'true';

        if (
          requireEmailVerification &&
          authMethod === 'local' &&
          !authenticatedUser.emailVerifiedAt
        ) {
          await logAudit(ctx, {
            action: 'AUTH_LOGIN_FAILED',
            targetType: 'Auth',
            targetId: authenticatedUser.id,
            result: 'FAILURE',
            metadata: {
              username: input.username,
              reason: 'email_not_verified',
              strategy,
            },
          });

          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'Email non verificata. Controlla la tua casella di posta per il link di verifica.',
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
          action: 'AUTH_LOGIN',
          targetType: 'Auth',
          targetId: authenticatedUser.id,
          result: 'SUCCESS',
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
            tokenVersion: authenticatedUser.tokenVersion,
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
  logout: protectedProcedure.mutation(async ({ ctx: _ctx }) => {
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
      action: 'AUTH_LOGOUT_ALL',
      targetType: 'Auth',
      targetId: ctx.session.user.id,
      result: 'SUCCESS',
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

  /**
   * Richiesta reset password
   * Genera token e invia email con link di reset
   */
  requestPasswordReset: publicProcedure
    .use(withRateLimit('passwordReset'))
    .input(RequestPasswordResetSchema)
    .mutation(async ({ input, ctx }) => {
      const { email } = input;

      // Trova l'utente con identity LOCAL
      const user = await ctx.prisma.user.findFirst({
        where: {
          email: email.toLowerCase(),
          isActive: true,
        },
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

      // Per sicurezza, rispondiamo sempre con successo anche se l'utente non esiste
      // Questo previene attacchi di enumerazione utenti
      if (!user || user.identities.length === 0) {
        // Log audit con FAILURE
        await logAudit(ctx, {
          action: 'PASSWORD_RESET_REQUESTED',
          targetType: 'Auth',
          result: 'FAILURE',
          metadata: {
            reason: 'user_not_found',
          },
        });

        // Restituiamo successo per non rivelare se l'email esiste
        return {
          success: true,
          message:
            "Se l'email esiste nel sistema, riceverai un link per il reset della password.",
        };
      }

      // Genera token random di 32 byte (64 caratteri hex)
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');

      // Calcola scadenza: 30 minuti da ora
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      // Salva token hash in DB
      await ctx.prisma.userToken.create({
        data: {
          userId: user.id,
          type: 'RESET',
          tokenHash,
          expiresAt,
        },
      });

      // Recupera base URL
      const baseUrl =
        (await getConfig(ctx.prisma, 'app.baseUrl', false)) ||
        process.env.APP_BASE_URL ||
        'http://localhost:3000';

      // Invia email con token in chiaro
      try {
        await sendPasswordResetEmail(ctx.prisma, email, token, baseUrl);

        // Log audit SUCCESS
        await logAudit(ctx, {
          action: 'PASSWORD_RESET_REQUESTED',
          targetType: 'Auth',
          targetId: user.id,
          result: 'SUCCESS',
          metadata: {
            expiresAt: expiresAt.toISOString(),
          },
        });

        return {
          success: true,
          message: 'Email di reset password inviata con successo.',
        };
      } catch (error) {
        // Log audit FAILURE
        await logAudit(ctx, {
          action: 'PASSWORD_RESET_REQUESTED',
          targetType: 'Auth',
          targetId: user.id,
          result: 'FAILURE',
          metadata: {
            reason: 'email_send_failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Impossibile inviare email. Riprova più tardi.',
        });
      }
    }),

  /**
   * Conferma reset password
   * Valida token e aggiorna password
   */
  confirmPasswordReset: publicProcedure
    .input(ConfirmPasswordResetSchema)
    .mutation(async ({ input, ctx }) => {
      const { token, newPassword } = input;

      // Hash del token per lookup
      const tokenHash = createHash('sha256').update(token).digest('hex');

      // Trova token valido (non scaduto)
      const userToken = await ctx.prisma.userToken.findFirst({
        where: {
          type: 'RESET',
          tokenHash,
          expiresAt: {
            gt: new Date(),
          },
        },
        include: {
          user: {
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
          },
        },
      });

      if (!userToken || !userToken.user.identities[0]?.localCredential) {
        await logAudit(ctx, {
          action: 'PASSWORD_CHANGED',
          targetType: 'Auth',
          result: 'FAILURE',
          metadata: {
            reason: 'invalid_or_expired_token',
          },
        });

        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Token non valido o scaduto.',
        });
      }

      // Valida password con policy
      const passwordPolicy = await getPasswordPolicy(ctx.prisma);
      const passwordValidation = validatePassword(newPassword, passwordPolicy);

      if (!passwordValidation.isValid) {
        await logAudit(ctx, {
          action: 'PASSWORD_CHANGED',
          targetType: 'Auth',
          targetId: userToken.userId,
          result: 'FAILURE',
          metadata: {
            reason: 'weak_password',
            errors: passwordValidation.errors,
          },
        });

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Password non valida: ${passwordValidation.errors.join(', ')}`,
        });
      }

      // Hash nuova password
      const passwordHash = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 1,
      });

      // Aggiorna password e incrementa tokenVersion in transazione
      await ctx.prisma.$transaction([
        // Aggiorna password
        ctx.prisma.localCredential.update({
          where: {
            identityId: userToken.user.identities[0].id,
          },
          data: {
            passwordHash,
            updatedAt: new Date(),
          },
        }),
        // Incrementa tokenVersion per invalidare tutte le sessioni
        ctx.prisma.user.update({
          where: { id: userToken.userId },
          data: {
            tokenVersion: { increment: 1 },
          },
        }),
        // Elimina il token usato
        ctx.prisma.userToken.delete({
          where: { id: userToken.id },
        }),
      ]);

      // Invalida cache tokenVersion
      const { invalidateTokenVersionCache } = await import('../lib/trpc');
      invalidateTokenVersionCache(userToken.userId);

      // Log audit SUCCESS
      await logAudit(ctx, {
        action: 'PASSWORD_CHANGED',
        targetType: 'Auth',
        targetId: userToken.userId,
        result: 'SUCCESS',
        metadata: {
          method: 'reset',
          sessionsInvalidated: true,
        },
      });

      return {
        success: true,
        message:
          'Password reimpostata con successo. Tutte le sessioni sono state invalidate.',
      };
    }),

  /**
   * Richiesta verifica email
   * Genera token e invia email con link di verifica
   */
  requestEmailVerification: publicProcedure
    .use(withRateLimit('passwordReset')) // Usa stessa policy
    .input(RequestEmailVerificationSchema)
    .mutation(async ({ input, ctx }) => {
      const { email } = input;

      // Trova l'utente con identity LOCAL
      const user = await ctx.prisma.user.findFirst({
        where: {
          email: email.toLowerCase(),
          isActive: true,
        },
        include: {
          identities: {
            where: {
              provider: 'LOCAL',
            },
          },
        },
      });

      // Per sicurezza, rispondiamo sempre con successo
      if (!user || user.identities.length === 0) {
        await logAudit(ctx, {
          action: 'EMAIL_VERIFICATION_SENT',
          targetType: 'Auth',
          result: 'FAILURE',
          metadata: {
            reason: 'user_not_found',
          },
        });

        return {
          success: true,
          message:
            "Se l'email esiste nel sistema, riceverai un link di verifica.",
        };
      }

      // Se già verificata, non inviare email
      if (user.emailVerifiedAt) {
        await logAudit(ctx, {
          action: 'EMAIL_VERIFICATION_SENT',
          targetType: 'Auth',
          targetId: user.id,
          result: 'FAILURE',
          metadata: {
            reason: 'already_verified',
          },
        });

        return {
          success: true,
          message: 'Email già verificata.',
        };
      }

      // Genera token random di 32 byte (64 caratteri hex)
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');

      // Calcola scadenza: 24 ore da ora
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Salva token hash in DB
      await ctx.prisma.userToken.create({
        data: {
          userId: user.id,
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

      // Invia email con token in chiaro
      try {
        await sendEmailVerificationEmail(ctx.prisma, email, token, baseUrl);

        // Log audit SUCCESS
        await logAudit(ctx, {
          action: 'EMAIL_VERIFICATION_SENT',
          targetType: 'Auth',
          targetId: user.id,
          result: 'SUCCESS',
          metadata: {
            expiresAt: expiresAt.toISOString(),
          },
        });

        return {
          success: true,
          message: 'Email di verifica inviata con successo.',
        };
      } catch (error) {
        // Log audit FAILURE
        await logAudit(ctx, {
          action: 'EMAIL_VERIFICATION_SENT',
          targetType: 'Auth',
          targetId: user.id,
          result: 'FAILURE',
          metadata: {
            reason: 'email_send_failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Impossibile inviare email. Riprova più tardi.',
        });
      }
    }),

  /**
   * Conferma verifica email
   * Valida token e marca email come verificata
   */
  confirmEmailVerification: publicProcedure
    .input(ConfirmEmailVerificationSchema)
    .mutation(async ({ input, ctx }) => {
      const { token } = input;

      // Hash del token per lookup
      const tokenHash = createHash('sha256').update(token).digest('hex');

      // Trova token valido (non scaduto)
      const userToken = await ctx.prisma.userToken.findFirst({
        where: {
          type: 'VERIFY',
          tokenHash,
          expiresAt: {
            gt: new Date(),
          },
        },
        include: {
          user: true,
        },
      });

      if (!userToken) {
        await logAudit(ctx, {
          action: 'EMAIL_VERIFIED',
          targetType: 'Auth',
          result: 'FAILURE',
          metadata: {
            reason: 'invalid_or_expired_token',
          },
        });

        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Token non valido o scaduto.',
        });
      }

      // Aggiorna emailVerifiedAt ed elimina token in transazione
      await ctx.prisma.$transaction([
        ctx.prisma.user.update({
          where: { id: userToken.userId },
          data: {
            emailVerifiedAt: new Date(),
          },
        }),
        ctx.prisma.userToken.delete({
          where: { id: userToken.id },
        }),
      ]);

      // Log audit SUCCESS
      await logAudit(ctx, {
        action: 'EMAIL_VERIFIED',
        targetType: 'Auth',
        targetId: userToken.userId,
        result: 'SUCCESS',
        metadata: {
          verifiedAt: new Date().toISOString(),
        },
      });

      return {
        success: true,
        message: 'Email verificata con successo!',
      };
    }),
});
