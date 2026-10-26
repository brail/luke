/**
 * Centralised helper for email verification operations.
 * Eliminates duplicated token generation and audit logging across callers.
 */

import { randomBytes, createHash } from 'crypto';

import { TRPCError } from '@trpc/server';

import { Prisma, PrismaClient, type TokenType } from '@luke/db';

import { logAudit } from './auditLog';
import { getConfigOrDefault } from './configManager';
import { toErrorMessage } from './error';
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

  // The address the link goes to is the one read under the user row lock, not the one above: a
  // change of address pending now waits for this, or this for it. Previous VERIFY links go.
  const issued = await prisma.$transaction(tx => issueUserToken(tx, user.id, 'VERIFY', { revokePrevious: true }));
  if (!issued) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
  }
  const { token, email, userToken: { expiresAt } } = issued;

  // Retrieve baseUrl from config
  const baseUrl =
    await getConfigOrDefault(prisma, 'app.baseUrl');

  // Send email (with automatic internal retry)
  try {
    await sendEmailVerificationEmail(prisma, email, token, baseUrl);

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
          error: toErrorMessage(error),
        },
      }
    );

    throw new Error('Impossibile inviare email. Verifica configurazione SMTP.', { cause: error });
  }
}

/** The pieces of a transaction a link needs: the user row lock and the `userToken` table. */
type LinkTx = Pick<Prisma.TransactionClient, '$queryRaw' | 'userToken'>;

const LINK_LIFETIME_MS: Record<TokenType, number> = {
  VERIFY: 24 * 60 * 60 * 1000,
  RESET: 30 * 60 * 1000,
};

/**
 * Locks the user row for the rest of the transaction and returns the account's address, or `null`
 * for no such user.
 *
 * Lock order everywhere a user's links are written: the user row first, then the links. An email
 * change takes the same row with its `UPDATE` before deleting the links (`revokeUserLinks`), so a
 * change and an issuance never wait on each other in opposite orders. A caller that also inserts a
 * row referencing the user (whose foreign-key check takes a key-share lock on it) calls this first,
 * at the top of its transaction.
 */
export async function lockUserEmail(tx: LinkTx, userId: string): Promise<string | null> {
  // FOR UPDATE, which the ORM cannot express (CLAUDE.md, "Raw SQL": a row lock inside an
  // interactive transaction). It is the lock the email change's UPDATE also takes.
  const [row] = await tx.$queryRaw<{ email: string }[]>(Prisma.sql`
    SELECT email FROM users WHERE id = ${userId} FOR UPDATE
  `);
  return row?.email ?? null;
}

/** A link {@link issueUserToken} created. */
export interface IssuedUserToken {
  /** Plaintext token — embed it in the link. Never persisted directly (`userToken` holds the hash). */
  token: string;
  userToken: { id: string; expiresAt: Date };
  /** The address read under the lock: the one the link goes to. */
  email: string;
  /** How many earlier links of the same type `revokePrevious` deleted. */
  revoked: number;
}

/**
 * Creates a RESET (30 minutes) or VERIFY (24 hours) link for `userId`, under the user row lock.
 * Sends nothing: the caller mails `email`, the address read under the lock, after the commit.
 *
 * - `expectedEmail`: when set and the account's address is no longer that one, nothing is created
 *   and the answer is `null` — a reset asked for an address the account no longer has.
 * - `revokePrevious`: delete the user's earlier links of this type first: on for verification and for
 *   the local-access command, off for a reset request and a forced local access, whose earlier links
 *   stay valid.
 *
 * @param tx - A transaction client: the lock lasts until it commits.
 * @returns The link, or `null` for no such user or an address other than `expectedEmail`.
 */
export async function issueUserToken(
  tx: LinkTx,
  userId: string,
  type: TokenType,
  options: { expectedEmail?: string; revokePrevious: boolean }
): Promise<IssuedUserToken | null> {
  const email = await lockUserEmail(tx, userId);
  if (email === null || (options.expectedEmail !== undefined && email !== options.expectedEmail)) return null;

  const revoked = options.revokePrevious
    ? (await tx.userToken.deleteMany({ where: { userId, type } })).count
    : 0;

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS[type]);
  const userToken = await tx.userToken.create({
    data: { userId, type, tokenHash, expiresAt },
    select: { id: true, expiresAt: true },
  });

  return { token, userToken, email, revoked };
}

/**
 * Deletes every pending RESET and VERIFY link of `userId`. Call it in the transaction that changes
 * the account's address, **after** the address `UPDATE` (lock order: the user row, then its links),
 * so a link issued meanwhile has committed and is seen here.
 *
 * @returns How many RESET links were deleted (`resetTokensRevoked` in the audit).
 */
export async function revokeUserLinks(tx: Pick<Prisma.TransactionClient, 'userToken'>, userId: string): Promise<number> {
  const { count } = await tx.userToken.deleteMany({ where: { userId, type: 'RESET' } });
  await tx.userToken.deleteMany({ where: { userId, type: 'VERIFY' } });
  return count;
}
