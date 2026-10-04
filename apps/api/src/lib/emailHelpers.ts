/**
 * Centralised helper for email verification operations.
 * Eliminates duplicated token generation and audit logging across callers.
 */

import { randomBytes, createHash } from 'crypto';

import { TRPCError } from '@trpc/server';

import { PrismaClient } from '@luke/db';

import { logAudit } from './auditLog';
import { getConfigOrDefault } from './configManager';
import { sendEmailVerificationEmail } from './mailer';

import type { Context } from './context';

/**
 * True if the email is the synthetic one generated for an LDAP user with no `mail` value set. It
 * reaches nobody. Lives here rather than in `ldapAuth.ts` because `sendVerificationEmail` refuses
 * it, and `ldapAuth.ts` already imports this module.
 */
export function isSyntheticLdapEmail(email: string): boolean {
  return email.endsWith('@ldap.local');
}

/**
 * Options for sending a verification email to a user.
 */
export interface SendVerificationEmailOptions {
  userId: string;
  reason?:
    | 'user_created'
    | 'email_changed'
    | 'admin_initiated'
    | 'user_requested';
  /** ID of the user performing the action, used for audit logging. */
  actorId?: string;
}

/**
 * Generates a verification token, persists it, sends the verification email,
 * and records an audit log entry.
 * Any previously pending VERIFY tokens for the user are invalidated first.
 * If the email is already verified (and `reason` is not `'email_changed'`),
 * the operation is a no-op and returns success immediately.
 *
 * @param prisma - Prisma client.
 * @param options - Target user, reason, and optional actor for audit logging.
 * @param ctx - Optional tRPC-like context for request correlation in the audit log.
 * @returns Success flag and a human-readable message.
 * @throws {TRPCError} NOT_FOUND if the user is not found or inactive; BAD_REQUEST for a synthetic
 *   LDAP address, refused before any token is created.
 * @throws {Error} If the email send fails after retries.
 */
export async function sendVerificationEmail(
  prisma: PrismaClient,
  options: SendVerificationEmailOptions,
  ctx?: Pick<Context, 'req' | 'logger'>
): Promise<{ success: boolean; message: string }> {
  const { userId, reason = 'user_requested', actorId } = options;

  // Find user
  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  if (!user) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
  }

  if (isSyntheticLdapEmail(user.email)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nessun indirizzo email reale da verificare.' });
  }

  // Skip if already verified (except on email change)
  if (user.emailVerifiedAt && reason !== 'email_changed') {
    return { success: true, message: 'Email già verificata.' };
  }

  // Generate token (32 bytes = 64 hex chars)
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  // Invalidate any previous VERIFY tokens for this user before creating a new one
  await prisma.userToken.deleteMany({
    where: { userId: user.id, type: 'VERIFY' },
  });

  // Save token to DB
  await prisma.userToken.create({
    data: { userId: user.id, type: 'VERIFY', tokenHash, expiresAt },
  });

  // Retrieve baseUrl from config
  const baseUrl =
    await getConfigOrDefault(prisma, 'app.baseUrl');

  // Send email (with automatic internal retry)
  try {
    await sendEmailVerificationEmail(prisma, user.email, token, baseUrl);

    // Audit log SUCCESS (no PII). Some callers have no request at all (LDAP provisioning), and
    // `logAudit` writes their row without one.
    await logAudit(
      {
        prisma,
        session: actorId ? { user: { id: actorId } } : undefined,
        req: ctx?.req,
        logger: ctx?.logger,
      },
      {
        action: 'EMAIL_VERIFICATION_SENT',
        targetType: 'Auth',
        targetId: user.id,
        result: 'SUCCESS',
        metadata: { reason, expiresAt: expiresAt.toISOString() },
      }
    );

    return {
      success: true,
      message: 'Email di verifica inviata con successo.',
    };
  } catch (error) {
    // Audit log FAILURE (no PII)
    await logAudit(
      {
        prisma,
        session: actorId ? { user: { id: actorId } } : undefined,
        req: ctx?.req,
        logger: ctx?.logger,
      },
      {
        action: 'EMAIL_VERIFICATION_SENT',
        targetType: 'Auth',
        targetId: user.id,
        result: 'FAILURE',
        metadata: {
          reason,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    );

    throw new Error('Impossibile inviare email. Verifica configurazione SMTP.', { cause: error });
  }
}

/** Result of {@link createResetToken}. */
export interface CreateResetTokenResult {
  /** Plaintext token — embed it in the reset link. Never persisted directly (`userToken` holds the hash). */
  token: string;
  userToken: { id: string; expiresAt: Date };
}

/**
 * Generates a password-reset token and persists it as a `UserToken` (type `RESET`, 30-minute
 * expiry). Does not send anything or check for an existing `LocalCredential` — callers own that
 * (self-service `requestPasswordReset` treats a missing one as user-not-found; admin-triggered
 * `forceLocalAccess` and the `db:grant-local-access` command may have just created one, the command
 * in the same transaction as this token).
 *
 * @param prisma - Prisma client or transaction client; only `userToken` is used.
 * @param userId - Target user.
 */
export async function createResetToken(
  prisma: Pick<PrismaClient, 'userToken'>,
  userId: string
): Promise<CreateResetTokenResult> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const userToken = await prisma.userToken.create({
    data: { userId, type: 'RESET', tokenHash, expiresAt },
  });

  return { token, userToken };
}
