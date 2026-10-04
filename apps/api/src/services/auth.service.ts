/**
 * Authentication service — handles login, password reset, email verification, and logout.
 */

import { randomBytes, createHash } from 'crypto';

import { TRPCError } from '@trpc/server';

import { hasPermission } from '@luke/core';
import type { PrismaClient, User } from '@luke/db';

import { logAudit } from '../lib/auditLog';
import { createToken } from '../lib/auth';
import { getConfig, getConfigOrDefault } from '../lib/configManager';
import { createResetToken } from '../lib/emailHelpers';
import { toErrorCode, toErrorMessage } from '../lib/error';
import { authenticateViaLdap, isSyntheticLdapEmail, type LdapRefusal } from '../lib/ldapAuth';
import {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} from '../lib/mailer';
import { assertNotBlockedByMaintenance, bypassesMaintenance, isMaintenanceActive } from '../lib/maintenanceMode';
import { notifyAdmins } from '../lib/notifications';
import { hashPassword, verifyPassword } from '../lib/password';
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

  if (!user || !user.identities[0]?.localCredential) {
    return null;
  }

  // Via `verifyPassword` rather than argon2 directly: it treats a malformed stored hash as a failed
  // verification instead of throwing, so a corrupted credential row answers "wrong password"
  // instead of turning a login attempt into a 500.
  const isValidPassword = await verifyPassword(
    password,
    user.identities[0].localCredential.passwordHash
  );

  if (!isValidPassword) {
    return null;
  }

  return user;
}

/**
 * How many administrators could take the break-glass path of `ldap-only` right now, as far as the
 * database shows: active, approved, holding a LOCAL credential under their current username, with a
 * verified email when verification is required — what `authenticateUser` asks of them.
 *
 * A check at a moment, not a guarantee: a later deactivation, demotion, credential change or
 * verification policy change can undo it. And a credential row is not proof that anyone knows the
 * password: forcing local access (`users.forceLocalAccess`) stores a random one until the
 * reset link is used.
 */
export async function countBreakGlassAdmins(prisma: PrismaClient): Promise<number> {
  const requireEmailVerification =
    (await getConfig(prisma, 'auth.requireEmailVerification', false)) === 'true';

  const localIdentity = { provider: 'LOCAL' as const, localCredential: { isNot: null } };
  const admins = await prisma.user.findMany({
    where: {
      // The one role holding `*:*`, which is what the break-glass path checks.
      role: 'admin',
      isActive: true,
      pendingApproval: false,
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
 * Verifies a username and password with the configured auth strategy (local-first, ldap-first,
 * local-only, or ldap-only), as a login does, and nothing more: no pending-approval,
 * email-verification or maintenance check, no token. Every public endpoint that takes a user's
 * password (`auth.login`, `auth.submitPendingEmail`) goes through it, so they share the per-account
 * `loginByUsername` bucket and none adds guesses.
 *
 * A failure writes the `AUTH_LOGIN_FAILED` audit row and throws the answer a login gets. A success
 * has the strategy's own side effects before any eligibility check: an LDAP bind provisions the
 * user at first login, or syncs their name (`authenticateViaLdap`).
 *
 * @returns The authenticated user, the method that authenticated them, and the strategy in force.
 * @throws {TRPCError} TOO_MANY_REQUESTS if the account's bucket is full, UNAUTHORIZED if nobody was
 *   authenticated, SERVICE_UNAVAILABLE if nobody was authenticated and LDAP could not complete the
 *   login for a reason that has nothing to do with the username.
 */
export async function verifyCredentials(
  ctx: Context,
  input: { username: string; password: string }
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
    getConfig(ctx.prisma, 'auth.strategy', false),
  ]);

  try {
    // Checked before touching DB/LDAP to avoid wasting that work during a spray.
    enforceRateLimit('loginByUsername', usernameRateLimitKey, usernameRateLimitPolicy);
  } catch (error) {
    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      result: 'FAILURE',
      metadata: { username, reason: 'rate_limited_username' },
    });
    throw error;
  }

  const strategy = authStrategyConfig || 'local-first';

  ctx.logger.info({ strategy, username }, `Authentication strategy selected`);

  let authenticatedUser: User | null;
  let authMethod: 'local' | 'ldap';

  // Why the LDAP attempt, if one is made, did not authenticate. `couldNotComplete` is what decides
  // the public answer: it is set only when `authenticateViaLdap` threw, which it does for a failure
  // that has nothing to do with the username (incomplete configuration, the service-account bind,
  // the circuit breaker) or once the directory has verified the password. A refusal it returns
  // stays a generic one in public, and carries the reason for the audit row.
  // Held in an object: `tryLdap` assigns it from inside a closure, which the compiler does not
  // follow when it narrows a plain `let`.
  const ldap: {
    failure: { couldNotComplete: boolean; reason: LdapRefusal['reason']; errorCode?: string } | null;
  } = { failure: null };
  // Set when `ldap-only` meets a correct local password that is not an administrator's.
  let localLoginRefused = false;

  // Either way it counts as no LDAP login, so each strategy's local fallback applies: rethrowing
  // used to lock every user out under ldap-first, local admin included.
  const tryLdap = async (): Promise<User | null> => {
    try {
      const login = await authenticateViaLdap(ctx.prisma, username, password);
      if (login.user) return login.user;
      ldap.failure = { couldNotComplete: false, reason: login.reason, errorCode: login.errorCode };
    } catch (e) {
      ctx.logger.warn(
        { username, code: e instanceof TRPCError ? e.code : undefined, error: toErrorMessage(e) },
        'LDAP authentication could not complete'
      );
      ldap.failure = { couldNotComplete: true, reason: 'ldap_unavailable', errorCode: toErrorCode(e) };
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
    // The audit row says what happened; the answer says only what cannot tell one username from
    // another. An outage met after the username was sent to the directory is recorded here as
    // `ldap_unavailable` and answered like a wrong password.
    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      result: 'FAILURE',
      metadata: {
        username: input.username,
        reason: localLoginRefused ? 'local_login_not_allowed' : (ldap.failure?.reason ?? 'invalid_credentials'),
        strategy,
        errorCode: ldap.failure?.errorCode,
      },
    });

    if (ldap.failure?.couldNotComplete) {
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Servizio di autenticazione non disponibile',
      });
    }

    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Credenziali non valide',
    });
  }

  return { user: authenticatedUser, authMethod, strategy };
}

/**
 * Authenticates a user using the configured auth strategy (local-first, ldap-first,
 * local-only, or ldap-only). Writes an audit log entry on success or failure.
 *
 * @returns User profile, signed JWT token, and the auth method used.
 * @throws {TRPCError} What `verifyCredentials` throws; FORBIDDEN if the account is pending or the
 *   email unverified — only once the password is proven, so neither tells anything to a caller
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

  // Block logins that cannot bypass maintenance while it is active
  if (!bypassesMaintenance(authenticatedUser.role) && await isMaintenanceActive(ctx.prisma)) {
    await logAudit(ctx, {
      action: 'AUTH_LOGIN_FAILED',
      targetType: 'Auth',
      targetId: authenticatedUser.id,
      result: 'FAILURE',
      metadata: { username: input.username, reason: 'maintenance_mode_active', strategy },
    });

    // Same enforcement (predicate + error) as the tRPC guard in trpc.ts — a single source
    // of truth so the two copies don't diverge in the future.
    await assertNotBlockedByMaintenance(ctx.prisma, authenticatedUser.role);
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

  // Create token
  const token = createToken({
    id: authenticatedUser.id,
    email: authenticatedUser.email,
    username: authenticatedUser.username,
    role: authenticatedUser.role,
    tokenVersion: authenticatedUser.tokenVersion,
  });

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

  // If the user doesn't exist or has no local auth, respond with a fake success
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

  const { token, userToken } = await createResetToken(ctx.prisma, user.id);

  const baseUrl =
    await getConfigOrDefault(ctx.prisma, 'app.baseUrl');

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
      metadata: { expiresAt: userToken.expiresAt.toISOString() },
    });

    return genericResponse;
  } catch (error) {
    // Email sending failed (e.g. SMTP not configured).
    // Delete the orphaned token and log the error server-side.
    // We don't expose the problem to the user to preserve enumeration protection.
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
    await getConfigOrDefault(ctx.prisma, 'app.baseUrl');

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
      cause: error,
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
