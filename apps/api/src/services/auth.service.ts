/**
 * Authentication service — handles login, password reset, email verification, and logout.
 */

import { createHash } from 'crypto';

import { TRPCError } from '@trpc/server';

import {
  AUTH_UNAVAILABLE_MESSAGE,
  hasPermission,
  isSyntheticLdapEmail,
  SIGN_IN_REFUSED_MESSAGE,
} from '@luke/core';
import type { Prisma, PrismaClient, User } from '@luke/db';

import { APPROVED_ADMIN_WHERE } from '../lib/approvedUsers';
import { logAudit } from '../lib/auditLog';
import { createToken } from '../lib/auth';
import { getConfig, getConfigOrDefault, getRequireEmailVerification } from '../lib/configManager';
import { issueUserToken, type IssuedUserToken } from '../lib/emailHelpers';
import { toErrorCode, toErrorMessage } from '../lib/error';
import { authenticateViaLdap, LdapUserNotWrittenError, type LdapRefusal } from '../lib/ldapAuth';
import { sendPasswordResetEmail } from '../lib/mailer';
import { isBlockedByMaintenance } from '../lib/maintenanceMode';
import { notifyAdmins, notifyDeduped, SYSTEM_FAILURE_DEDUP_MS } from '../lib/notifications';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../lib/password';
import { enforceRateLimit } from '../lib/ratelimit';
import { resolveRateLimitPolicy } from '../lib/rateLimitPolicy';
import { invalidateTokenVersionCache } from '../lib/tokenVersionCache';

import { checkPasswordAgainstPolicy } from './passwordPolicy.service';

import type { Context } from '../lib/trpc';

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
  // Find the user and their local identity
  const user = await prisma.user.findFirst({
    where: {
      username,
      isActive: true, // Only active users can authenticate
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

  // Verified even with no credential to check: an unknown, inactive or password-less account then
  // costs the same argon2 run as a real one (`dummyPasswordHash`), which never matches.
  // Via `verifyPassword` rather than argon2 directly: it treats a malformed stored hash as a failed
  // verification instead of throwing, so a corrupted credential row answers "wrong password"
  // instead of turning a login attempt into a 500.
  const credential = user?.identities[0]?.localCredential;
  const isValidPassword = await verifyPassword(
    password,
    credential?.passwordHash ?? (await dummyPasswordHash())
  );

  if (!user || !credential || !isValidPassword) {
    return null;
  }

  return user;
}

/**
 * How many administrators could take the break-glass path of `ldap-only` right now, as far as the
 * database shows: active, approved, holding a LOCAL credential under their current username, with a
 * verified email when verification is required — what `authenticateUser` asks of them.
 *
 * True at the commit of a transaction holding the locks `saveAuthConfig` takes (#246), not later:
 * the changes that can lower it wait for that commit and are not refused. And a credential row is
 * not proof that anyone knows the password: forcing local access (`users.forceLocalAccess`) stores a
 * random one until the reset link is used.
 */
export async function countBreakGlassAdmins(prisma: Prisma.TransactionClient): Promise<number> {
  const requireEmailVerification = await getRequireEmailVerification(prisma);

  const localIdentity = { provider: 'LOCAL' as const, localCredential: { isNot: null } };
  const admins = await prisma.user.findMany({
    where: {
      // The one role holding `*:*`, which is what the break-glass path checks.
      ...APPROVED_ADMIN_WHERE,
      emailVerifiedAt: requireEmailVerification ? { not: null } : undefined,
      identities: { some: localIdentity },
    },
    select: { username: true, identities: { where: localIdentity, select: { providerId: true } } },
  });
  // `authenticateLocal` finds the identity by the current username, a comparison between two
  // columns that a Prisma filter cannot express. An identity left under an old username does not
  // log anyone in, so it does not count.
  return admins.filter(admin => admin.identities.some(identity => identity.providerId === admin.username)).length;
}

/**
 * The answer to every failure before the password is proven, for a caller with no session: one
 * text, and no `cause` — the error formatter copies `retryAfterSeconds` from a cause, which would
 * tell a full account bucket from a wrong password. A fresh error each time, so nothing a caller
 * sees differs between outcomes.
 */
function credentialsRefused(): TRPCError {
  return new TRPCError({ code: 'UNAUTHORIZED', message: SIGN_IN_REFUSED_MESSAGE });
}

/** The `signedIn` answer to a wrong password or any refusal of a session's own password. */
export const WRONG_CURRENT_PASSWORD = 'Password attuale non corretta';

/** The `signedIn` answer to a full per-account bucket. */
const SIGNED_IN_THROTTLED = 'Troppi tentativi: riprova tra qualche minuto';

/**
 * Tells the administrators that an LDAP password check could not complete, at most once per
 * `SYSTEM_FAILURE_DEDUP_MS`. Awaited by the caller, and never the answer's cost: a failure is logged.
 */
async function notifyLdapUnavailable(ctx: Context): Promise<void> {
  await notifyDeduped(ctx.prisma, 'auth.ldap_unavailable', SYSTEM_FAILURE_DEDUP_MS, () => notifyAdmins(ctx.prisma, {
    category: 'SYSTEM',
    title: 'Verifica LDAP non riuscita',
    message:
      'Una verifica della password via LDAP non è stata completata (directory non raggiungibile o errore del server). ' +
      'Gli utenti vedono solo un messaggio generico; il dettaglio è nel registro di audit, motivo ldap_unavailable.',
    data: { type: 'ldap_unavailable' },
  })).catch(err => ctx.logger.error({ err }, 'Failed to notify admins of an LDAP outage'));
}

/**
 * Who reads the answer of `verifyCredentials`. `public` — the default, so a caller that forgets the
 * option gets the safe answer — is a caller with no session, told nothing about the app's state
 * before the password is proven. `signedIn` is a session re-proving its own password
 * (`me.changeEmail`), which may be told what went wrong.
 */
export type CredentialsAnswerMode = 'public' | 'signedIn';

/**
 * Verifies a username and password with the configured auth strategy (local-first, ldap-first,
 * local-only, or ldap-only), as a login does, and nothing more: no pending-approval,
 * email-verification or maintenance check, no token. Every endpoint that takes a user's password —
 * the public `auth.login`, `auth.submitPendingEmail` and `auth.resendVerification`, and the
 * signed-in `me.changeEmail` — goes through it, so they share the per-account `loginByUsername`
 * bucket and none adds guesses.
 *
 * A failure writes the `AUTH_LOGIN_FAILED` audit row, with the real reason, and throws the answer
 * `mode` calls for. A success has the strategy's own side effects before any eligibility check: an
 * LDAP bind provisions the user at first login, or syncs their name (`authenticateViaLdap`). When
 * nobody was authenticated because LDAP could not complete a check, the administrators are told,
 * at most once per `SYSTEM_FAILURE_DEDUP_MS`.
 *
 * @returns The authenticated user, the method that authenticated them, and the strategy in force.
 * @throws {TRPCError} In `public` mode, UNAUTHORIZED with `SIGN_IN_REFUSED_MESSAGE` for every
 *   failure before the password is proven (a full account bucket included), and SERVICE_UNAVAILABLE
 *   only when the directory verified the password and the user record could not be written. In
 *   `signedIn` mode, UNAUTHORIZED for a wrong password or a refusal, TOO_MANY_REQUESTS for a full
 *   account bucket, SERVICE_UNAVAILABLE when LDAP could not complete the check. In either mode,
 *   FORBIDDEN with the marker `LDAP_EMAIL_IN_USE` when the directory verified the password of a
 *   first sign-in whose mail another account holds (#266).
 */
export async function verifyCredentials(
  ctx: Context,
  input: { username: string; password: string },
  mode: CredentialsAnswerMode = 'public'
): Promise<{ user: User; authMethod: 'local' | 'ldap'; strategy: string }> {
  const { username, password } = input;

  // Bucket separate from the per-IP rate limit of `withRateLimit('login')` (router auth.ts):
  // stops password-spray distributed across multiple IPs against a single account. Key
  // normalized (case-insensitive) only for the count — the credential lookup below
  // stays unchanged. No data dependency between this policy and the auth strategy
  // below: resolved in parallel instead of in sequence.
  const usernameRateLimitKey = username.trim().toLowerCase();
  const [usernameRateLimitPolicy, authStrategyConfig] = await Promise.all([
    resolveRateLimitPolicy('loginByUsername', ctx.prisma),
    getConfig(ctx.prisma, 'auth.strategy'),
  ]);

  try {
    // Checked before touching DB/LDAP to avoid wasting that work during a spray.
    enforceRateLimit('loginByUsername', usernameRateLimitKey, usernameRateLimitPolicy);
  } catch {
    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      result: 'FAILURE',
      metadata: { username, reason: 'rate_limited_username' },
    });
    // In public, answered like a wrong password: a distinct answer would tell a sprayer which
    // accounts it has reached. The per-IP bucket, about the caller's own rate, stays distinct.
    if (mode === 'public') throw credentialsRefused();
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: SIGNED_IN_THROTTLED });
  }

  const strategy = authStrategyConfig || 'local-first';

  ctx.logger.info({ strategy, username }, `Authentication strategy selected`);

  let authenticatedUser: User | null;
  let authMethod: 'local' | 'ldap';

  // Why the LDAP attempt, if one is made, did not authenticate, for the audit row and the answer.
  // `reason: 'ldap_unavailable'` covers every check the directory could not complete: thrown before
  // the username was sent (configuration, service bind, breaker), returned from the search or the
  // user bind, or thrown once the password was verified (`afterProof`). Only `afterProof` may be
  // answered as such in public: everything else happened before any proof.
  // Held in an object: `tryLdap` assigns it from inside a closure, which the compiler does not
  // follow when it narrows a plain `let`.
  const ldap: {
    failure: { afterProof: boolean; reason: LdapRefusal['reason']; errorCode?: string; emailHolderId?: string } | null;
  } = { failure: null };
  // Set when `ldap-only` meets a correct local password that is not an administrator's.
  let localLoginRefused = false;

  // Either way it counts as no LDAP login, so each strategy's local fallback applies: rethrowing
  // used to lock every user out under ldap-first, local admin included.
  const tryLdap = async (): Promise<User | null> => {
    try {
      const login = await authenticateViaLdap(ctx.prisma, username, password);
      if (login.user) return login.user;
      ldap.failure = { afterProof: false, reason: login.reason, errorCode: login.errorCode, emailHolderId: login.emailHolderId };
    } catch (e) {
      ctx.logger.warn(
        { username, code: e instanceof TRPCError ? e.code : undefined, err: e },
        'LDAP authentication could not complete'
      );
      const afterProof = e instanceof LdapUserNotWrittenError;
      ldap.failure = { afterProof, reason: 'ldap_unavailable', errorCode: toErrorCode(afterProof ? e.cause : e) };
    }
    return null;
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
      authenticatedUser = await tryLdap();
      authMethod = 'ldap';

      // The break-glass path: once LDAP did not authenticate them, an administrator with a LOCAL
      // credential can use it; nobody else can. Without it a directory that authenticates nobody
      // locks every administrator out as well, and one that answers from the wrong subtree cannot
      // be told from an unknown user — so there is no condition on why LDAP refused.
      if (!authenticatedUser) {
        const local = await authenticateLocal(ctx.prisma, username, password);
        if (local && hasPermission({ role: local.role }, '*:*')) {
          authenticatedUser = local;
          authMethod = 'local';
        } else if (local) {
          // A correct password that grants nothing is refused here, as a wrong one is: the
          // checks below would answer it with a 403 and so tell the two apart.
          localLoginRefused = true;
        }
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
        authenticatedUser = await tryLdap();
        authMethod = 'ldap';
      }
      break;

    case 'ldap-first':
      authenticatedUser = await tryLdap();
      authMethod = 'ldap';

      if (!authenticatedUser) {
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
    // The audit row says what happened; a public answer says only what cannot tell one outcome
    // from another.
    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      result: 'FAILURE',
      metadata: {
        username: input.username,
        reason: localLoginRefused ? 'local_login_not_allowed' : (ldap.failure?.reason ?? 'invalid_credentials'),
        strategy,
        errorCode: ldap.failure?.errorCode,
        emailHolderId: ldap.failure?.emailHolderId,
      },
    });

    // Never for a refusal, nor when a local fallback authenticated: only a check the directory
    // could not complete.
    const ldapUnavailable = ldap.failure?.reason === 'ldap_unavailable';
    if (ldapUnavailable) await notifyLdapUnavailable(ctx);

    // Proven, and about this person's own directory entry: told as such in either mode (#266), as a
    // marker the web turns into its own message, like `ACCOUNT_PENDING_APPROVAL` below.
    if (ldap.failure?.reason === 'email_in_use' && !localLoginRefused) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'LDAP_EMAIL_IN_USE' });
    }
    if (ldap.failure?.afterProof || (mode === 'signedIn' && ldapUnavailable)) {
      throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: AUTH_UNAVAILABLE_MESSAGE });
    }
    if (mode === 'public') throw credentialsRefused();
    throw new TRPCError({ code: 'UNAUTHORIZED', message: WRONG_CURRENT_PASSWORD });
  }

  return { user: authenticatedUser, authMethod, strategy };
}

/**
 * Authenticates a user using the configured auth strategy (local-first, ldap-first,
 * local-only, or ldap-only). Writes an audit log entry on success or failure.
 *
 * @returns User profile, signed JWT token, and the auth method used.
 * @throws {TRPCError} What `verifyCredentials` throws in `public` mode; FORBIDDEN if the account is
 *   pending, the email unverified, or maintenance active for a role that cannot bypass it
 *   (`MAINTENANCE_ACTIVE`) — only once the password is proven, so none tells anything to a caller
 *   without it.
 */
export async function authenticateUser(
  ctx: Context,
  input: { username: string; password: string }
) {
  const { username } = input;
  const { user: authenticatedUser, authMethod, strategy } = await verifyCredentials(ctx, input);

  // Block login if the LDAP user is pending admin approval
  if (authenticatedUser.pendingApproval) {
    const hasSyntheticEmail = isSyntheticLdapEmail(authenticatedUser.email);

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

  // Verify email (LOCAL only)
  const requireEmailVerification = await getRequireEmailVerification(ctx.prisma);

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

    // A marker the web turns into its own message, as `ACCOUNT_PENDING_APPROVAL` above.
    throw new TRPCError({ code: 'FORBIDDEN', message: 'EMAIL_NOT_VERIFIED' });
  }

  // Block logins that cannot bypass maintenance while it is active
  if (await isBlockedByMaintenance(ctx.prisma, authenticatedUser.role)) {
    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      targetId: authenticatedUser.id,
      result: 'FAILURE',
      metadata: { username: input.username, reason: 'maintenance_mode_active', strategy },
    });

    // Answered after proof as a marker the web turns into its own message, as
    // `ACCOUNT_PENDING_APPROVAL` above.
    throw new TRPCError({ code: 'FORBIDDEN', message: 'MAINTENANCE_ACTIVE' });
  }

  // Update login statistics
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

  // Create token: the session's absolute lifetime starts at this login
  const token = createToken(
    {
      id: authenticatedUser.id,
      email: authenticatedUser.email,
      username: authenticatedUser.username,
      role: authenticatedUser.role,
      tokenVersion: authenticatedUser.tokenVersion,
    },
    Math.floor(Date.now() / 1000)
  );

  ctx.logger.info({ username, authMethod }, `Authentication successful`);

  // Every use of the break-glass path, once it has passed every check above. In-app, and muted for
  // an administrator who turned the category off: the `AUTH_LOGIN` row is the record, this is the
  // prompt to look at it. It must never cost the login.
  if (strategy === 'ldap-only' && authMethod === 'local') {
    await notifyAdmins(ctx.prisma, {
      category: 'SYSTEM',
      title: 'Accesso di emergenza con credenziale locale',
      message: `${authenticatedUser.username} è entrato con la password locale mentre la strategia è ldap-only.`,
      data: { type: 'ldap_only_local_login', userId: authenticatedUser.id },
    }).catch(err => ctx.logger.error({ err, username }, 'Failed to notify admins of an emergency local login'));
  }

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
 * Sends a password reset email to the given address. Always returns a generic success
 * response to prevent email enumeration, even if the user does not exist.
 *
 * @param email - Email address to send the reset link to, in the stored form (`EmailSchema`).
 */
export async function requestPasswordReset(ctx: Context, email: string) {
  const user = await ctx.prisma.user.findFirst({
    where: {
      email,
      isActive: true,
    },
    include: {
      identities: {
        where: { provider: 'LOCAL' },
        include: { localCredential: true },
      },
    },
  });

  // Every answer that sends nothing is this same success: a caller must not tell them apart.
  const genericResponse = {
    success: true,
    message:
      "Se l'email esiste nel sistema, riceverai un link per il reset della password.",
  };
  const notFound = async () => {
    await logAudit(ctx, {
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'Auth',
      result: 'FAILURE',
      metadata: { reason: 'user_not_found' },
    });
    return genericResponse;
  };

  // If the user doesn't exist or has no local auth, respond with a fake success
  if (!user || user.identities.length === 0) return notFound();

  // Issued only while the account still has the address asked for: under the user row lock, a
  // change of address pending now either finishes first (and nothing is issued) or waits for this
  // link, then revokes it. Earlier reset links stay valid: a new request does not revoke them.
  // Everything from the issue to the send is in the `try`: a failure anywhere answers the same
  // success, or the answer would differ for an address that has a local account.
  let issued: IssuedUserToken | null = null;
  try {
    issued = await ctx.prisma.$transaction(tx =>
      issueUserToken(tx, user.id, 'RESET', { expectedEmail: email, revokePrevious: false })
    );
    if (issued) {
      const baseUrl = await getConfigOrDefault(ctx.prisma, 'app.baseUrl');
      await sendPasswordResetEmail(ctx.prisma, issued.email, issued.token, baseUrl);

      await logAudit(ctx, {
        action: 'PASSWORD_RESET_REQUESTED',
        targetType: 'Auth',
        targetId: user.id,
        result: 'SUCCESS',
        metadata: { expiresAt: issued.userToken.expiresAt.toISOString() },
      });
    }
  } catch (error) {
    // Email sending failed (e.g. SMTP not configured), or the link could not be issued.
    // Delete the orphaned token, if any, and log the error server-side.
    // We don't expose the problem to the user to preserve enumeration protection.
    const tokenId = issued?.userToken.id;
    if (tokenId) {
      await ctx.prisma.userToken.delete({ where: { id: tokenId } }).catch(e => {
        ctx.logger.warn({ err: e, tokenId }, 'Failed to delete orphaned password reset token');
      });
    }

    ctx.logger.error(
      { err: error, userId: user.id },
      issued ? 'Password reset email failed — check SMTP config in AppConfig' : 'Password reset link could not be issued'
    );

    await logAudit(ctx, {
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'Auth',
      targetId: user.id,
      result: 'FAILURE',
      metadata: {
        reason: issued ? 'email_send_failed' : 'token_issue_failed',
        error: toErrorMessage(error),
      },
    });

    return genericResponse;
  }

  return issued ? genericResponse : notFound();
}

/** Thrown inside {@link consumeLink}'s transaction to roll back its writes. */
class LinkGone extends Error {}

/**
 * Runs `writes`, then deletes the link `tokenId`, in one transaction (writes first: the user row,
 * then its links — the lock order of `issueUserToken` and of an email change). A link deleted
 * since it was looked up — an email change revokes every pending link — rolls the writes back.
 *
 * @returns `false` when the link was gone, so the caller answers "not valid", not a 500.
 */
async function consumeLink(
  ctx: Context,
  tokenId: string,
  writes: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<boolean> {
  try {
    await ctx.prisma.$transaction(async tx => {
      await writes(tx);
      const { count } = await tx.userToken.deleteMany({ where: { id: tokenId } });
      if (count === 0) throw new LinkGone();
    });
    return true;
  } catch (error) {
    if (error instanceof LinkGone) return false;
    throw error;
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

  const passwordValidation = await checkPasswordAgainstPolicy(ctx.prisma, newPassword);

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

  const passwordHash = await hashPassword(newPassword);

  const consumed = await consumeLink(ctx, userToken.id, async tx => {
    await tx.localCredential.update({
      where: { identityId: userToken.user.identities[0].id },
      data: { passwordHash, updatedAt: new Date() },
    });
    await tx.user.update({
      where: { id: userToken.userId },
      data: { tokenVersion: { increment: 1 } },
    });
  });
  if (!consumed) {
    await logAudit(ctx, {
      action: 'PASSWORD_CHANGED',
      targetType: 'Auth',
      targetId: userToken.userId,
      result: 'FAILURE',
      metadata: { reason: 'invalid_or_expired_token' },
    });
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Token non valido o scaduto.' });
  }

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
 * Marks the user's email as verified and deletes the consumed token atomically.
 *
 * @throws {TRPCError} NOT_FOUND if the token is invalid or expired.
 */
export async function confirmEmailVerification(
  ctx: Context,
  input: { token: string }
) {
  const { token } = input;

  // Hash the token for lookup
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Find a valid (non-expired) token
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

  // Update emailVerifiedAt and delete the token in a transaction
  const consumed = await consumeLink(ctx, userToken.id, async tx => {
    await tx.user.update({
      where: { id: userToken.userId },
      data: {
        emailVerifiedAt: new Date(),
      },
    });
  });
  if (!consumed) {
    await logAudit(ctx, {
      action: 'EMAIL_VERIFIED',
      targetType: 'Auth',
      targetId: userToken.userId,
      result: 'FAILURE',
      metadata: { reason: 'invalid_or_expired_token' },
    });
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Token non valido o scaduto.' });
  }

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
