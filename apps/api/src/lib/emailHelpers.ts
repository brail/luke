/**
 * Centralised helper for email verification operations.
 * Eliminates duplicated token generation and audit logging across callers.
 */

import { randomBytes, createHash } from 'crypto';

import { PrismaClient } from '@prisma/client';

import { logAudit } from './auditLog';
import { getConfig } from './configManager';
import { sendEmailVerificationEmail } from './mailer';

import type { Context } from './context';

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
 * @throws {Error} If the user is not found or the email send fails after retries.
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
    throw new Error('Utente non trovato');
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
    (await getConfig(prisma, 'app.baseUrl', false)) || 'http://localhost:3000';

  // Send email (with automatic internal retry)
  try {
    await sendEmailVerificationEmail(prisma, user.email, token, baseUrl);

    // Audit log SUCCESS (no PII)
    // logAudit requires a full Context; here we build a partial one —
    // some callers (e.g. ldapAuth.ts during automatic provisioning)
    // don't have a real HTTP request and don't pass `ctx` at all. If `req`
    // remains undefined, logAudit throws when reading ctx.req.ip/ctx.req.log —
    // the caller already catches it with .catch(). Pre-existing behavior, not
    // changed by this cast.
    await logAudit(
      {
        prisma,
        session: actorId ? { user: { id: actorId } } : undefined,
        req: ctx?.req,
        logger: ctx?.logger,
      } as unknown as Context,
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
    // logAudit requires a full Context; here we build a partial one —
    // some callers (e.g. ldapAuth.ts during automatic provisioning)
    // don't have a real HTTP request and don't pass `ctx` at all. If `req`
    // remains undefined, logAudit throws when reading ctx.req.ip/ctx.req.log —
    // the caller already catches it with .catch(). Pre-existing behavior, not
    // changed by this cast.
    await logAudit(
      {
        prisma,
        session: actorId ? { user: { id: actorId } } : undefined,
        req: ctx?.req,
        logger: ctx?.logger,
      } as unknown as Context,
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
