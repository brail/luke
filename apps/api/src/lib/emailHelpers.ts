/**
 * Helper centralizzato per operazioni email verification
 * Elimina duplicazione di token generation + audit logging
 */

import { randomBytes, createHash } from 'crypto';

import { PrismaClient } from '@prisma/client';

import { logAudit } from './auditLog';
import { getConfig } from './configManager';
import { sendEmailVerificationEmail } from './mailer';

export interface SendVerificationEmailOptions {
  userId: string;
  reason?:
    | 'user_created'
    | 'email_changed'
    | 'admin_initiated'
    | 'user_requested';
  actorId?: string; // Per audit log
}

/**
 * Helper centralizzato per generare token + inviare email verifica
 * Gestisce: token generation, hash, DB save, email send, audit log
 *
 * @param prisma - Client Prisma
 * @param options - Opzioni invio (userId, reason, actorId)
 * @param ctx - Context tRPC opzionale per audit log
 * @returns Promise con risultato operazione
 * @throws Error se utente non trovato o invio email fallisce
 */
export async function sendVerificationEmail(
  prisma: PrismaClient,
  options: SendVerificationEmailOptions,
  ctx?: { req: any; logger: any }
): Promise<{ success: boolean; message: string }> {
  const { userId, reason = 'user_requested', actorId } = options;

  // Trova utente
  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  if (!user) {
    throw new Error('Utente non trovato');
  }

  // Skip se già verificata (tranne cambio email)
  if (user.emailVerifiedAt && reason !== 'email_changed') {
    return { success: true, message: 'Email già verificata.' };
  }

  // Genera token (32 byte = 64 char hex)
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  // Salva token in DB
  await prisma.userToken.create({
    data: { userId: user.id, type: 'VERIFY', tokenHash, expiresAt },
  });

  // Recupera baseUrl da config
  const baseUrl =
    (await getConfig(prisma, 'app.baseUrl', false)) || 'http://localhost:3000';

  // Invia email (con retry interno automatico)
  try {
    await sendEmailVerificationEmail(prisma, user.email, token, baseUrl);

    // Audit log SUCCESS (senza PII)
    await logAudit(
      {
        prisma,
        session: actorId ? { user: { id: actorId } } : undefined,
        req: ctx?.req,
        logger: ctx?.logger,
      } as any,
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
    // Audit log FAILURE (senza PII)
    await logAudit(
      {
        prisma,
        session: actorId ? { user: { id: actorId } } : undefined,
        req: ctx?.req,
        logger: ctx?.logger,
      } as any,
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

    throw new Error('Impossibile inviare email. Verifica configurazione SMTP.');
  }
}
