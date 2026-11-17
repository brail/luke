/**
 * Local access to an account: the LOCAL identity a password lives on, and the reset link that sets
 * that password.
 *
 * Two callers, with rules of their own:
 * - `users.forceLocalAccess` gives an account that signs in through LDAP or OIDC a local path, and
 *   emails the link;
 * - `db:grant-local-access` (`scripts/grant-local-access.ts`) recovers an administrator when nobody
 *   can sign in, from a shell in the API container, and prints the link.
 *
 * What they share is here, and only that: making sure the LOCAL identity exists, under the current
 * username, and — for the command — issuing the link in the same transaction as its audit row.
 * Neither writes a password: the credential is created when the link is used (reset consume), so a
 * credential row means a person set the password.
 */

import { hasPermission } from '@luke/core';
import type { Prisma, PrismaClient } from '@luke/db';

import { logAudit } from '../lib/auditLog';
import { getRequireEmailVerification } from '../lib/configManager';
import { issueUserToken, lockUserEmail } from '../lib/emailHelpers';

/** An account as the checks below need it. */
const TARGET_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  pendingApproval: true,
  emailVerifiedAt: true,
  identities: {
    select: { provider: true, providerId: true },
  },
} satisfies Prisma.UserSelect;

type Target = Prisma.UserGetPayload<{ select: typeof TARGET_SELECT }>;

/** A database client or a transaction client: every read and write here works on either. */
type Db = Prisma.TransactionClient | PrismaClient;

/** A refusal whose message can be shown as it is: it names the account, never a secret. */
export class LocalAccessRefused extends Error {}

/**
 * Makes sure `user` has a LOCAL identity under their current username, and says whether it was
 * created. No credential: the reset link creates it when a person sets the password.
 *
 * Local sign-in finds the identity by the current username, so one left under an old username (a
 * rename before 3.1, which did not move it; one the migration of #229 could not move) would hold a
 * password nobody can use: refused.
 *
 * @throws {LocalAccessRefused} When the LOCAL identity is under another username.
 */
async function prepareLocalIdentity(
  db: Db,
  user: { id: string; username: string; identities: Target['identities'] }
): Promise<boolean> {
  const local = user.identities.find(identity => identity.provider === 'LOCAL');

  if (local) {
    if (local.providerId !== user.username) {
      throw new LocalAccessRefused(
        `the LOCAL identity of ${user.username} is under the username "${local.providerId}"; local sign-in cannot find it`
      );
    }
    return false;
  }

  await db.identity.create({ data: { userId: user.id, provider: 'LOCAL', providerId: user.username } });
  return true;
}

/**
 * `prepareLocalIdentity` for the account `userId` as it is under its row lock (`lockUserEmail`), held
 * until the caller's transaction commits: a rename takes the same lock and moves the LOCAL identity
 * (#229), so the identity is never filed under a name the account has just left.
 */
export async function prepareLocalIdentityLocked(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<boolean> {
  await lockUserEmail(tx, userId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: TARGET_SELECT });
  return prepareLocalIdentity(tx, user);
}

/**
 * After a `(LOCAL, username)` unique-key collision: the identity that won is acceptable only if it
 * is this user's. Anything else would send a link that sets a password on someone else's identity.
 *
 * @throws {LocalAccessRefused} When the identity belongs to another user.
 */
export async function assertOwnLocalIdentity(db: Db, userId: string): Promise<void> {
  // The username as it is now: a rename may have committed since the caller read it.
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true } });
  const identity = await db.identity.findUnique({
    where: { provider_providerId: { provider: 'LOCAL', providerId: user.username } },
    select: { userId: true },
  });
  if (identity?.userId !== user.id) {
    throw new LocalAccessRefused(`the LOCAL identity "${user.username}" does not belong to this account`);
  }
}

// ── The recovery command ─────────────────────────────────────────────────────────────────────────

/** What would still refuse the sign-in after the password is set, unless fixed separately. */
export type ReadinessBlocker = 'pending_approval' | 'email_unverified';

export interface LocalAccessAccount {
  id: string;
  username: string;
  email: string;
  role: string;
}

export type LocalAccessInspection =
  | { refusal: string }
  | { account: LocalAccessAccount; blockers: ReadinessBlocker[]; identityMissing: boolean };

/**
 * The checks the command applies, on an account read by username or by id. Hard refusals first:
 * nobody, not an administrator, inactive, a LOCAL identity it cannot use. Then what `--anyway`
 * may pass over: pending approval, an unverified email while verification is required.
 */
async function assess(db: Db, user: Target | null, requireEmailVerification: boolean): Promise<LocalAccessInspection> {
  if (!user) return { refusal: 'no account has this username' };
  if (!hasPermission({ role: user.role }, '*:*')) return { refusal: `${user.username} is not an administrator` };
  if (!user.isActive) return { refusal: `${user.username} is deactivated` };

  const local = user.identities.find(identity => identity.provider === 'LOCAL');
  if (local && local.providerId !== user.username) {
    return {
      refusal: `the LOCAL identity of ${user.username} is under the username "${local.providerId}"; local sign-in cannot find it`,
    };
  }
  if (!local) {
    const owner = await db.identity.findUnique({
      where: { provider_providerId: { provider: 'LOCAL', providerId: user.username } },
      select: { userId: true },
    });
    if (owner && owner.userId !== user.id) {
      return { refusal: `the LOCAL identity "${user.username}" belongs to another account` };
    }
  }

  const blockers: ReadinessBlocker[] = [];
  if (user.pendingApproval) blockers.push('pending_approval');
  if (requireEmailVerification && !user.emailVerifiedAt) blockers.push('email_unverified');

  return {
    account: { id: user.id, username: user.username, email: user.email, role: user.role },
    blockers,
    identityMissing: !local,
  };
}

/** Runs every check of the command on the account named exactly `username`. Writes nothing. */
export async function inspectLocalAccess(prisma: PrismaClient, username: string): Promise<LocalAccessInspection> {
  const user = await prisma.user.findUnique({ where: { username }, select: TARGET_SELECT });
  return assess(prisma, user, await getRequireEmailVerification(prisma));
}

export interface LocalAccessGrant {
  /** Plaintext reset token. A bearer credential: shown once, on the channel the operator chose. */
  token: string;
  expiresAt: Date;
  identityCreated: boolean;
  resetTokensRevoked: number;
}

/**
 * Issues a reset link for the account the operator confirmed, in one transaction with everything it
 * depends on. The account is read again by id and must still be the one confirmed and still pass
 * every check — a change made before that read is caught; one committed after it is not serialised
 * against. Then: the LOCAL identity if missing, the account's RESET tokens this transaction sees
 * deleted, the new token, and the `USER_LOCAL_ACCESS_FORCED` row written as required. A failure of
 * any of them rolls all of them back, the deleted tokens included, and no token leaves this function.
 *
 * @throws {LocalAccessRefused} When the account no longer matches or no longer passes.
 */
export async function grantLocalAccess(
  prisma: PrismaClient,
  confirmed: { id: string; username: string },
  options: { anyway: boolean }
): Promise<LocalAccessGrant> {
  const requireEmailVerification = await getRequireEmailVerification(prisma);

  return prisma.$transaction(async tx => {
    // The user row first, before the identity insert below (whose foreign-key check takes a
    // key-share lock on it) and before the links: the lock order of every link write.
    await lockUserEmail(tx, confirmed.id);
    const user = await tx.user.findUnique({ where: { id: confirmed.id }, select: TARGET_SELECT });
    if (user && user.username !== confirmed.username) {
      throw new LocalAccessRefused(`the account was renamed to ${user.username} after it was confirmed`);
    }
    const verdict = await assess(tx, user, requireEmailVerification);
    if ('refusal' in verdict) throw new LocalAccessRefused(verdict.refusal);
    if (verdict.blockers.length > 0 && !options.anyway) {
      throw new LocalAccessRefused(`${confirmed.username} cannot sign in yet: ${verdict.blockers.join(', ')}`);
    }

    // `assess` has just established that the account exists.
    const target = user!;
    const identityCreated = await prepareLocalIdentity(tx, target);
    const issued = await issueUserToken(tx, target.id, 'RESET', { revokePrevious: true });
    // The row is locked above and `assess` found it: it cannot have gone since.
    if (!issued) throw new LocalAccessRefused('the account no longer exists');
    const { token, userToken, revoked: resetTokensRevoked } = issued;

    await logAudit(
      { prisma },
      {
        action: 'USER_LOCAL_ACCESS_FORCED',
        targetType: 'User',
        targetId: target.id,
        result: 'SUCCESS',
        metadata: {
          source: 'cli',
          identityCreated,
          readinessBypassed: verdict.blockers.length > 0,
          resetTokensRevoked,
        },
      },
      { required: true, tx }
    );

    return { token, expiresAt: userToken.expiresAt, identityCreated, resetTokensRevoked };
  });
}
