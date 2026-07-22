/**
 * Authentication service — handles login, password reset, email verification, and logout.
 */

import { randomBytes, createHash } from 'crypto';

import { TRPCError } from '@trpc/server';
import argon2 from 'argon2';


import { logAudit } from '../lib/auditLog';
import { createToken } from '../lib/auth';
import { getConfig, getPasswordPolicy } from '../lib/configManager';
import { authenticateViaLdap } from '../lib/ldapAuth';
import {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} from '../lib/mailer';
import { assertNotBlockedByMaintenance, isMaintenanceActive } from '../lib/maintenanceMode';
import { validatePassword } from '../lib/password';

import type { Context } from '../lib/trpc';
import type { PrismaClient, User } from '@prisma/client';

/**
 * Authenticates a user against local credentials (argon2 password hash).
 *
 * @returns The matching active User, or null if credentials are invalid.
 */
export async function authenticateLocal(
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
 * Authenticates a user using the configured auth strategy (local-first, ldap-first,
 * local-only, or ldap-only). Writes an audit log entry on success or failure.
 *
 * @returns User profile, signed JWT token, and the auth method used.
 * @throws {TRPCError} UNAUTHORIZED if credentials are invalid, FORBIDDEN if account is pending or email unverified.
 */
export async function authenticateUser(
  ctx: Context,
  input: { username: string; password: string }
) {
  const { username, password } = input;

  // Recupera la strategia di autenticazione
  const strategy =
    (await getConfig(ctx.prisma, 'auth.strategy', false)) || 'local-first';

  ctx.logger.info({ strategy, username }, `Authentication strategy selected`);

  let authenticatedUser = null;
  let authMethod = '';

  const handleLdapError = (ldapError: unknown) => {
    if (ldapError instanceof TRPCError) {
      if (
        ldapError.code === 'SERVICE_UNAVAILABLE' ||
        ldapError.code === 'BAD_GATEWAY'
      ) {
        ctx.logger.warn({ username, code: ldapError.code }, `LDAP unavailable`);
        // LDAP down - return null (auth fail) unless fallback logic catches it
        return null;
      } else {
        // NON fare fallback per errori di autorizzazione
        throw ldapError;
      }
    } else {
      const errorMessage =
        ldapError instanceof Error ? ldapError.message : 'Unknown LDAP error';
      ctx.logger.warn(
        { username, error: errorMessage },
        `LDAP connection error`
      );
      return null;
    }
  };

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
      try {
        authenticatedUser = await authenticateViaLdap(
          ctx.prisma,
          username,
          password
        );
        authMethod = 'ldap';
      } catch (e) {
        // Passa l'errore per gestione corretta delle eccezioni tRPC
        handleLdapError(e);
        // Se handleLdapError non lancia, significa che è un errore di connessione/tech
        // e authenticatedUser resta null
      }
      break;

    case 'local-first':
      authenticatedUser = await authenticateLocal(
        ctx.prisma,
        username,
        password
      );
      authMethod = 'local';

      if (!authenticatedUser) {
        ctx.logger.info(
          { username },
          `Local auth failed, trying LDAP fallback...`
        );
        try {
          authenticatedUser = await authenticateViaLdap(
            ctx.prisma,
            username,
            password
          );
          authMethod = 'ldap';
        } catch (e) {
          handleLdapError(e);
        }
      }
      break;

    case 'ldap-first':
      try {
        authenticatedUser = await authenticateViaLdap(
          ctx.prisma,
          username,
          password
        );
        authMethod = 'ldap';
      } catch (e) {
        if (e instanceof TRPCError) {
          if (e.code === 'SERVICE_UNAVAILABLE' || e.code === 'BAD_GATEWAY') {
            ctx.logger.warn(
              { code: e.code },
              'LDAP unavailable, fallback to local'
            );
          } else {
            throw e;
          }
        } else {
          ctx.logger.warn({ error: e }, 'LDAP error, fallback to local');
        }
        authenticatedUser = await authenticateLocal(
          ctx.prisma,
          username,
          password
        );
        authMethod = 'local';
      }

      if (!authenticatedUser && authMethod === 'ldap') {
        ctx.logger.info(
          { username },
          'LDAP auth failed, trying local fallback...'
        );
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

  // Blocca login se utente LDAP in attesa di approvazione admin
  if (authenticatedUser.pendingApproval) {
    const hasSyntheticEmail = authenticatedUser.email.endsWith('@ldap.local');

    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      targetId: authenticatedUser.id,
      result: 'FAILURE',
      metadata: {
        username: input.username,
        reason: 'account_pending_approval',
        strategy,
      },
    });

    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `ACCOUNT_PENDING_APPROVAL${hasSyntheticEmail ? ':NEEDS_EMAIL' : ''}`,
    });
  }

  // Verifica email (solo LOCAL)
  const requireEmailVerification =
    (await getConfig(ctx.prisma, 'auth.requireEmailVerification', false)) ===
    'true';

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

  // Blocca login dei non-admin durante la modalità manutenzione attiva
  if (authenticatedUser.role !== 'admin' && await isMaintenanceActive(ctx.prisma)) {
    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      targetId: authenticatedUser.id,
      result: 'FAILURE',
      metadata: { username: input.username, reason: 'maintenance_mode_active', strategy },
    });

    // Stesso enforcement (predicato + errore) della guardia tRPC in trpc.ts — un'unica fonte
    // di verità per non far divergere le due copie in futuro.
    await assertNotBlockedByMaintenance(ctx.prisma, authenticatedUser.role);
  }

  // Aggiorna statistiche login
  await ctx.prisma.user.update({
    where: { id: authenticatedUser.id },
    data: {
      lastLoginAt: new Date(),
      loginCount: { increment: 1 },
    },
  });

  // Log audit
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

  // Crea token
  const token = createToken({
    id: authenticatedUser.id,
    email: authenticatedUser.email,
    username: authenticatedUser.username,
    role: authenticatedUser.role,
    tokenVersion: authenticatedUser.tokenVersion,
  });

  ctx.logger.info({ username, authMethod }, `Authentication successful`);

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
}

/**
 * Invalidates all active sessions for the current user by incrementing tokenVersion.
 *
 * @throws {TRPCError} UNAUTHORIZED if the caller is not authenticated.
 */
export async function logoutAllSessions(ctx: Context) {
  if (!ctx.session?.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Non autenticato',
    });
  }

  const userId = ctx.session.user.id;

  // Incrementa tokenVersion
  await ctx.prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });

  // Invalida cache (import dinamico per evitare cicli se necessario, o diretto se lib/trpc safe)
  // Qui assumiamo che lib/trpc sia importabile. Se crea ciclo, meglio spostare la cache logic.
  // Per ora importiamo dinamicamente come faceva il router per sicurezza.
  const { invalidateTokenVersionCache } = await import('../lib/trpc.js');
  invalidateTokenVersionCache(userId);

  await logAudit(ctx, {
    action: 'AUTH_LOGOUT_ALL',
    targetType: 'Auth',
    targetId: userId,
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
}

/**
 * Sends a password reset email to the given address. Always returns a generic success
 * response to prevent email enumeration, even if the user does not exist.
 *
 * @param email - Email address to send the reset link to.
 */
export async function requestPasswordReset(ctx: Context, email: string) {
  const normalizedEmail = email.toLowerCase();

  const user = await ctx.prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      isActive: true,
    },
    include: {
      identities: {
        where: { provider: 'LOCAL' },
        include: { localCredential: true },
      },
    },
  });

  // Se utente non esiste o non ha auth locale, rispondi con successo fake
  if (!user || user.identities.length === 0) {
    await logAudit(ctx, {
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'Auth',
      result: 'FAILURE',
      metadata: { reason: 'user_not_found' },
    });
    return {
      success: true,
      message:
        "Se l'email esiste nel sistema, riceverai un link per il reset della password.",
    };
  }

  // Genera token
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const userToken = await ctx.prisma.userToken.create({
    data: {
      userId: user.id,
      type: 'RESET',
      tokenHash,
      expiresAt,
    },
  });

  const baseUrl =
    (await getConfig(ctx.prisma, 'app.baseUrl', false)) ||
    'http://localhost:3000';

  const genericResponse = {
    success: true,
    message:
      "Se l'email esiste nel sistema, riceverai un link per il reset della password.",
  };

  try {
    await sendPasswordResetEmail(ctx.prisma, normalizedEmail, token, baseUrl);

    await logAudit(ctx, {
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'Auth',
      targetId: user.id,
      result: 'SUCCESS',
      metadata: { expiresAt: expiresAt.toISOString() },
    });

    return genericResponse;
  } catch (error) {
    // L'invio email è fallito (es. SMTP non configurato).
    // Elimina il token orfano e logga l'errore lato server.
    // Non esponiamo il problema all'utente per mantenere la protezione da enumeration.
    await ctx.prisma.userToken.delete({ where: { id: userToken.id } }).catch(e => {
      ctx.logger.warn({ err: e, tokenId: userToken.id }, 'Failed to delete orphaned password reset token');
    });

    ctx.logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error', userId: user.id },
      'Password reset email failed — check SMTP config in AppConfig'
    );

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

    return genericResponse;
  }
}

/**
 * Validates a password reset token and sets the new password. Invalidates all sessions
 * by incrementing tokenVersion and deletes the consumed token atomically.
 *
 * @throws {TRPCError} NOT_FOUND if the token is invalid or expired.
 * @throws {TRPCError} FORBIDDEN if the account is inactive.
 * @throws {TRPCError} BAD_REQUEST if the new password fails the policy.
 */
export async function confirmPasswordReset(
  ctx: Context,
  input: { token: string; newPassword: string }
) {
  const { token, newPassword } = input;
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const userToken = await ctx.prisma.userToken.findFirst({
    where: {
      type: 'RESET',
      tokenHash,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        include: {
          identities: {
            where: { provider: 'LOCAL' },
            include: { localCredential: true },
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
      metadata: { reason: 'invalid_or_expired_token' },
    });
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Token non valido o scaduto.',
    });
  }

  if (!userToken.user.isActive) {
    await logAudit(ctx, {
      action: 'PASSWORD_CHANGED',
      targetType: 'Auth',
      targetId: userToken.userId,
      result: 'FAILURE',
      metadata: { reason: 'account_inactive' },
    });
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Account disattivato.',
    });
  }

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

  const passwordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 1,
  });

  await ctx.prisma.$transaction(async tx => {
    await tx.localCredential.update({
      where: { identityId: userToken.user.identities[0].id },
      data: { passwordHash, updatedAt: new Date() },
    });
    await tx.user.update({
      where: { id: userToken.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await tx.userToken.delete({
      where: { id: userToken.id },
    });
  });

  const { invalidateTokenVersionCache } = await import('../lib/trpc.js');
  invalidateTokenVersionCache(userToken.userId);

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
    message: 'Password reimpostata con successo.',
  };
}

/**
 * Sends an email verification link. Returns a generic success response to prevent
 * enumeration. No-ops silently if the email is already verified.
 *
 * @param email - Email address to verify.
 * @throws {TRPCError} INTERNAL_SERVER_ERROR if the email cannot be sent.
 */
export async function requestEmailVerification(ctx: Context, email: string) {
  const normalizedEmail = email.toLowerCase();

  const user = await ctx.prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      isActive: true,
    },
    include: {
      identities: {
        where: { provider: 'LOCAL' },
      },
    },
  });

  if (!user || user.identities.length === 0) {
    await logAudit(ctx, {
      action: 'EMAIL_VERIFICATION_SENT',
      targetType: 'Auth',
      result: 'FAILURE',
      metadata: { reason: 'user_not_found' },
    });
    return {
      success: true,
      message: "Se l'email esiste nel sistema, riceverai un link di verifica.",
    };
  }

  if (user.emailVerifiedAt) {
    await logAudit(ctx, {
      action: 'EMAIL_VERIFICATION_SENT',
      targetType: 'Auth',
      targetId: user.id,
      result: 'FAILURE',
      metadata: { reason: 'already_verified' },
    });
    return {
      success: true,
      message: 'Email già verificata.',
    };
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await ctx.prisma.userToken.create({
    data: {
      userId: user.id,
      type: 'VERIFY',
      tokenHash,
      expiresAt,
    },
  });

  const baseUrl =
    (await getConfig(ctx.prisma, 'app.baseUrl', false)) ||
    'http://localhost:3000';

  try {
    await sendEmailVerificationEmail(
      ctx.prisma,
      normalizedEmail,
      token,
      baseUrl
    );

    await logAudit(ctx, {
      action: 'EMAIL_VERIFICATION_SENT',
      targetType: 'Auth',
      targetId: user.id,
      result: 'SUCCESS',
      metadata: { expiresAt: expiresAt.toISOString() },
    });

    return {
      success: true,
      message: 'Email inviata.',
    };
  } catch (error) {
    await logAudit(ctx, {
      action: 'EMAIL_VERIFICATION_SEND_FAILED',
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
      message: 'Impossibile inviare email.',
    });
  }
}

/**
 * Marks the user's email as verified and deletes the consumed token atomically.
 *
 * @throws {TRPCError} NOT_FOUND if the token is invalid or expired.
 */
export async function confirmEmailVerification(
  ctx: Context,
  input: { token: string }
) {
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
  await ctx.prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: userToken.userId },
      data: {
        emailVerifiedAt: new Date(),
      },
    });
    await tx.userToken.delete({
      where: { id: userToken.id },
    });
  });

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
}
