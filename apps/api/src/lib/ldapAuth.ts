/**
 * LDAP authentication module.
 * Manages directory connection, user search, credential verification, and role mapping.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';
import { Filter, SASL_MECHANISMS } from 'ldapts';

import { EmailSchema, LDAP_SYNTHETIC_EMAIL_DOMAIN } from '@luke/core';
import type { Role, RoleMapping } from '@luke/core';
import type { Prisma, PrismaClient, User } from '@luke/db';

import { logAudit } from './auditLog';
import {
  getConfigOrDefault,
  getLdapConfig,
  getLdapResilienceConfig,
  isLdapEnabled,
  type LdapConfig,
} from './configManager';
import { moveUserEmail, sendVerificationEmail } from './emailHelpers';
import { isUniqueViolation, toErrorCode, toErrorMessage } from './error';
import { acquireLastAdminLock } from './lastAdminGuard';
import { ResilientLdapClient, isDirectoryAnswer } from './ldapClient';
import { rootLogger } from './logger';

import type { Entry } from 'ldapts';

/**
 * Helper to normalize an ldapts attribute into an array of strings
 */
function getAttr(entry: Entry, key: string): string[] {
  const v = entry[key];
  if (!v) return [];
  if (Array.isArray(v)) return (v as (Buffer | string)[]).filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' ? [v] : [];
}

const logger = rootLogger.child({ module: 'ldap' });

/**
 * Fills every `${placeholder}` of an LDAP filter template from the configuration with `value`,
 * escaped by ldapts (RFC 4515). The replacement is a function: a string one would read `$&`,
 * `` $` `` and `$'` in the value as replacement patterns.
 */
export function fillLdapFilter(template: string, placeholder: 'username' | 'userDN', value: string): string {
  return template.replaceAll(`\${${placeholder}}`, () => Filter.escape(value));
}

/**
 * What an LDAP login that did not authenticate tells the caller. `ldap_unavailable` means the
 * directory never judged the credentials — a step got no usable answer, or could not be carried
 * out — and `account_refused` that it verified them for an account Luke refuses (deactivated, or
 * without this LDAP identity). Both are for the audit trail only: the public answer to a refusal is
 * the same either way. `email_in_use` — a first sign-in whose directory mail another account holds
 * (#266) — is the one refusal answered as such, since it comes after the directory proved the
 * password.
 */
export interface LdapRefusal {
  user: null;
  reason: 'invalid_credentials' | 'ldap_unavailable' | 'account_refused' | 'email_in_use';
  errorCode?: string;
  /** With `email_in_use`: the account that holds the directory's mail. */
  emailHolderId?: string;
}

/** The outcome of an LDAP login: the local user it authenticated, or why it refused. */
export type LdapLogin = { user: User } | LdapRefusal;

const REFUSED: LdapRefusal = { user: null, reason: 'invalid_credentials' };

/**
 * The directory verified the password, and the local user record could not be read or written.
 * Its own type so the caller can tell it from a failure before any proof: it is the one LDAP
 * failure that may be answered as such before a session exists.
 */
export class LdapUserNotWrittenError extends Error {
  constructor(cause: unknown) {
    super('LDAP user record could not be written after the password was verified', { cause });
    this.name = 'LdapUserNotWrittenError';
  }
}

/**
 * Authenticates a user against the configured LDAP directory: service-account bind, search, bind as
 * the user, then creation or update of the local user record.
 *
 * What it does with a failure depends on whether the username has been sent to the directory yet.
 * Before that — incomplete configuration, the service-account bind, the circuit breaker in front of
 * it — a failure says nothing about the person logging in, and is thrown. From the search on, a
 * failure is returned as a refusal, whatever its cause: answering differently there would tell a
 * caller with no password which usernames the directory knows. The one throw past that point needs
 * the password: the user record could not be written after the directory verified it
 * (`LdapUserNotWrittenError`). A unique constraint met there is a refusal, never that throw (#266).
 *
 * @returns The local `User`, or a refusal with the reason for the audit trail.
 * @throws {TRPCError} When the login could not complete for a reason independent of the username.
 * @throws {LdapUserNotWrittenError} When the user record could not be synced after the password was
 *   verified.
 */
export async function authenticateViaLdap(
  prisma: PrismaClient,
  username: string,
  password: string
): Promise<LdapLogin> {
  // A simple bind with an empty password is an unauthenticated bind, which a directory may answer
  // with success (RFC 4513 §5.1.2): it must never count as a verified password. Not trimmed.
  if (password === '') return REFUSED;

  let ldapClient: ResilientLdapClient | null = null;

  try {
    if (!(await isLdapEnabled(prisma))) {
      logger.debug('LDAP authentication disabled');
      return REFUSED;
    }

    // Fetch LDAP configurations
    const [config, resilienceConfig] = await Promise.all([
      getLdapConfig(prisma),
      getLdapResilienceConfig(prisma),
    ]);

    // Check that the configuration is complete
    if (!config.url || !config.searchBase || !config.searchFilter) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Configurazione LDAP incompleta',
      });
    }

    logger.info({ username }, 'Attempting LDAP authentication');

    // Create resilient LDAP client
    ldapClient = new ResilientLdapClient(config, resilienceConfig, logger);
    await ldapClient.connect();

    // Administrative bind to search for the user. The one step behind the circuit breaker: it
    // carries nothing about the person logging in. Without a service account there is no such
    // step, and the directory is searched anonymously with no breaker in front of it.
    if (config.bindDN && config.bindPassword) {
      await ldapClient.serviceBind(config.bindDN, config.bindPassword);
    }

    const verified = await verifyCandidate(ldapClient, config, username, password);
    if (verified.user === null) return verified;

    const userGroups = await lookUpGroups(ldapClient, config, verified.dn);
    const role = determineUserRole(userGroups, config.roleMapping);

    // Create or update the user in the database; an account it may not sign in is a refusal.
    let login: LdapLogin;
    try {
      login = await createOrUpdateUser(prisma, username, role, verified.attributes);
    } catch (error) {
      throw new LdapUserNotWrittenError(error);
    }
    if (login.user === null) return login;

    logger.info({ username, role }, 'LDAP authentication successful');
    return login;
  } catch (error) {
    if (error instanceof TRPCError || error instanceof LdapUserNotWrittenError) {
      throw error;
    }

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Errore durante autenticazione LDAP',
      cause: error,
    });
  } finally {
    // Close LDAP connection
    if (ldapClient) {
      try {
        await ldapClient.unbind();
      } catch (error) {
        logger.warn({ err: error }, 'Error closing LDAP connection');
      }
    }
  }
}

/** The directory entry of a user whose password the directory has verified. */
interface VerifiedEntry {
  user?: undefined;
  dn: string;
  attributes: Record<string, string[]>;
}

/**
 * The part of a login that carries the candidate: the search for the username, then the bind as
 * the entry found. It never throws — anything that goes wrong here, an LDAP error of any kind or an
 * unexpected one while reading the search result, comes back as a refusal.
 */
async function verifyCandidate(
  client: ResilientLdapClient,
  config: LdapConfig,
  username: string,
  password: string
): Promise<VerifiedEntry | LdapRefusal> {
  try {
    const found = await searchUser(client, config, username);
    if (!found) {
      logger.info({ username }, 'User not found in LDAP');
      return REFUSED;
    }

    // A bind proves a password only if it is a simple bind of a named entry. An empty DN makes it
    // an anonymous one, and ldapts reads a DN that is exactly a SASL mechanism name as a request
    // for that mechanism.
    if (!found.dn || (SASL_MECHANISMS as readonly string[]).includes(found.dn)) {
      logger.warn({ username }, 'LDAP entry has no usable DN');
      return REFUSED;
    }

    await client.bind(found.dn, password);
    return found;
  } catch (error) {
    if (isDirectoryAnswer(error)) {
      logger.info({ username, error: toErrorMessage(error) }, 'LDAP refused the login');
      return REFUSED;
    }
    logger.warn(
      { username, code: toErrorCode(error), err: error },
      'LDAP could not verify the login'
    );
    return { user: null, reason: 'ldap_unavailable', errorCode: toErrorCode(error) };
  }
}

/**
 * Search for a user on the LDAP server
 */
async function searchUser(
  client: ResilientLdapClient,
  config: LdapConfig,
  username: string
): Promise<{ dn: string; attributes: Record<string, string[]> } | null> {
  const searchFilter = fillLdapFilter(config.searchFilter, 'username', username);

  const options = {
    filter: searchFilter,
    scope: 'sub' as const,
    attributes: [
      'dn',
      'cn',
      'mail',
      'uid',
      'displayName',
      'givenName',
      'sn',
      'firstName',
      'lastName',
    ],
  };

  const entries = await client.search(config.searchBase, options);

  if (entries.length === 0) {
    return null;
  }

  // Take the first result
  // ldapts returns a flat entry: { dn: string; [key]: string | string[] }
  const entry = entries[0];
  const dn = entry.dn;
  const attributes: Record<string, string[]> = {};
  for (const key of Object.keys(entry)) {
    if (key === 'dn') continue;
    attributes[key] = getAttr(entry, key);
  }

  return { dn, attributes };
}

/**
 * The groups of a user the directory has just verified. Optional: they decide only the role of a
 * user created at first login, so a failure here is logged and the login goes on with none.
 */
async function lookUpGroups(
  client: ResilientLdapClient,
  config: LdapConfig,
  userDN: string
): Promise<string[]> {
  if (!config.groupSearchBase || !config.groupSearchFilter) {
    return [];
  }

  const groupFilter = fillLdapFilter(config.groupSearchFilter, 'userDN', userDN);

  const options = {
    filter: groupFilter,
    scope: 'sub' as const,
    attributes: ['cn', 'dn'],
  };

  try {
    // The connection is bound as the user now. Back to the service account first; if that fails,
    // the catch below skips the search rather than run it under an uncertain identity.
    if (config.bindDN && config.bindPassword) {
      await client.bind(config.bindDN, config.bindPassword);
    }
    const entries = await client.search(config.groupSearchBase, options);
    return entries.map(entry => entry.dn);
  } catch (error) {
    logger.warn({ err: error }, 'Group lookup failed, proceeding without group membership');
    return [];
  }
}

/**
 * Determine the user's role based on LDAP groups
 */
function determineUserRole(
  userGroups: string[],
  roleMapping: RoleMapping
): Role {
  // Look for the most specific mapping
  for (const groupDN of userGroups) {
    // Own keys only: a DN equal to an inherited name (`constructor`) must not read a prototype member.
    const role = Object.hasOwn(roleMapping, groupDN) ? roleMapping[groupDN] : undefined;
    if (role) {
      logger.info({ groupDN, role }, `Role mapping found`);
      return role;
    }
  }

  // Default to viewer if no mapping is found (applied only when creating new users)
  logger.info({ userGroups }, 'No role mapping found for LDAP groups, defaulting to viewer (existing users keep their DB role)');
  return 'viewer';
}

/**
 * The directory's mail in the one form Luke stores (`EmailSchema`, #228), or `undefined` when the
 * entry has none, or a blank or malformed one, which is never stored.
 */
function directoryMail(username: string, raw: string | undefined): string | undefined {
  const mail = EmailSchema.safeParse(raw ?? '');
  if (mail.success) return mail.data;
  if (raw?.trim()) logger.warn({ username }, 'LDAP mail attribute is not a valid address: ignored');
  return undefined;
}

/**
 * The local account a directory-verified username signs into, by its LDAP identity — the link
 * between a directory person and a Luke account — compared without case: the directory binds
 * `Alice` and `alice` as one person (#266). Interim rule until identities key on the directory's
 * stable identifier (#234).
 *
 * @returns The account; `'refused'` when the identity's account is deactivated, when only accounts
 *   differing in case from a pre-#228 duplicate exist with no exact match, or when an account with
 *   this username in any case has no LDAP identity — never linked (#144); `null` when the username
 *   is free.
 */
async function findLdapAccount(db: Prisma.TransactionClient, username: string): Promise<User | 'refused' | null> {
  // `in` with one value, never `equals`: with `mode: 'insensitive'` Prisma turns `equals` into an
  // unescaped ILIKE, where `_` and `%` in a username match other accounts (prisma/orm#20318). `in`
  // compares `LOWER(column) IN (LOWER(value))`, literally, with the `lower()` the provisioning lock uses.
  const sameName: Prisma.StringFilter = { in: [username], mode: 'insensitive' };

  const identities = await db.identity.findMany({
    where: { provider: 'LDAP', providerId: sameName },
    select: { providerId: true, user: true },
  });
  if (identities.length > 0) {
    if (identities.length > 1) {
      logger.warn(
        { username, userIds: identities.map(identity => identity.user.id) },
        'LDAP identities differing only in case: an administrator should keep one account'
      );
    }
    // Among pre-#228 duplicates the exact one, which is where this username signed in until now.
    const match = identities.find(identity => identity.providerId === username)
      ?? (identities.length === 1 ? identities[0] : undefined);
    if (!match) return 'refused';
    if (!match.user.isActive) {
      logger.warn({ username }, 'LDAP login refused: the account is deactivated');
      return 'refused';
    }
    return match.user;
  }

  const named = await db.user.findFirst({ where: { username: sameName }, select: { id: true } });
  if (named) {
    logger.warn({ username }, 'LDAP login refused: the account with this username has no LDAP identity for it');
    return 'refused';
  }
  return null;
}

/**
 * The address of a new LDAP user the directory gives no mail: `<username>@ldap.local`, else — a
 * username no address can carry, with a space or a non-ASCII letter, or an address another account
 * already holds — a synthetic one of its own. It is Luke's placeholder, so a clash is never refused.
 */
async function syntheticAddress(tx: Prisma.TransactionClient, username: string): Promise<string> {
  const synthetic = EmailSchema.safeParse(`${username}@${LDAP_SYNTHETIC_EMAIL_DOMAIN}`);
  if (synthetic.success && !(await tx.user.findUnique({ where: { email: synthetic.data }, select: { id: true } }))) {
    return synthetic.data;
  }
  return `ldap-${randomUUID()}@${LDAP_SYNTHETIC_EMAIL_DOMAIN}`;
}

/** What a first sign-in is created with. */
interface NewLdapUser {
  username: string;
  role: Role;
  mail: string | undefined;
  firstName: string;
  lastName: string;
}

/**
 * The outcome of a first sign-in: the account it created; the account (or refusal) a concurrent
 * first sign-in in another case left, untouched; or the account holding the directory's mail.
 */
type Provisioning = { created: User } | { found: User | 'refused' } | { emailHolderId: string };

/** The unique constraints a first sign-in meets when a writer outside its lock wins a race. */
const PROVISIONING_CONFLICTS: [string, ...string[]] = [
  'users_email_key',
  'users_username_key',
  'identities_provider_providerId_key',
];

/**
 * What already decides a first sign-in, read before any write: the account a sign-in in another case
 * left (or its refusal), or the account holding the directory's mail — never linked by address,
 * the classic takeover path. `null` when nothing does and the account may be created.
 */
async function decide(db: Prisma.TransactionClient, data: NewLdapUser): Promise<Provisioning | null> {
  const found = await findLdapAccount(db, data.username);
  if (found !== null) return { found };
  if (data.mail !== undefined) {
    const holder = await db.user.findUnique({ where: { email: data.mail }, select: { id: true } });
    if (holder) return { emailHolderId: holder.id };
  }
  return null;
}

/**
 * Creates the account of a first sign-in, or finds why it must not. A writer outside the lock that
 * wins a race shows as a unique violation: the provisioning runs once more and the state it left
 * decides. A second one is classified by a read, with no third write, so neither reads as an outage
 * (#266); what that read cannot explain is still a refusal — the directory proved the password, and
 * the write did not fail.
 */
async function provision(prisma: PrismaClient, data: NewLdapUser): Promise<Provisioning> {
  try {
    return await provisionOnce(prisma, data);
  } catch (error) {
    if (!isUniqueViolation(error, ...PROVISIONING_CONFLICTS)) throw error;
    logger.warn({ username: data.username, err: error }, 'LDAP first sign-in lost a race to another writer: deciding again');
  }
  try {
    return await provisionOnce(prisma, data);
  } catch (error) {
    if (!isUniqueViolation(error, ...PROVISIONING_CONFLICTS)) throw error;
    const decided = await decide(prisma, data);
    if (decided) return decided;
    logger.warn({ username: data.username, err: error }, 'LDAP first sign-in kept meeting a unique constraint: refused');
    return { found: 'refused' };
  }
}

async function provisionOnce(prisma: PrismaClient, data: NewLdapUser): Promise<Provisioning> {
  // Create new user, in the business zone (ADR-035 §New users)
  const timezone = await getConfigOrDefault(prisma, 'app.defaultTimezone');
  return prisma.$transaction(async tx => {
    // Transaction-scoped advisory lock (CLAUDE.md "Raw SQL"): first sign-ins of one directory person
    // in different cases wait on one key, so the second finds the account the first created instead
    // of creating another (rule 3). `lower()` as in `findLdapAccount`.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ldap.provision:' || lower(${data.username})))`;
    // An account found now is returned untouched: its sync, which takes the last-admin lock, runs
    // after this commit, never while this transaction holds a user row.
    const decided = await decide(tx, data);
    if (decided) return decided;

    const newUser = await tx.user.create({
      data: {
        email: data.mail ?? await syntheticAddress(tx, data.username),
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        timezone,
        isActive: true,
        pendingApproval: true,
      },
    });

    await tx.identity.create({
      data: {
        userId: newUser.id,
        provider: 'LDAP',
        providerId: data.username,
      },
    });

    // The access a user starts with (#222), and that it starts with no team: `users.approvePending`
    // requires one, the first point a human decides where this user belongs. A pending LDAP user has
    // no brand or function access anyway. A pre-session flow, so no actor.
    await logAudit({ prisma, logger }, {
      action: 'USER_ACCESS_CHANGED',
      targetType: 'User',
      targetId: newUser.id,
      result: 'SUCCESS',
      metadata: { newRole: newUser.role, newIsActive: newUser.isActive, newPendingApproval: newUser.pendingApproval },
    }, { tx });
    await logAudit({ prisma, logger }, {
      action: 'USER_PROVISIONED_WITHOUT_TEAM',
      targetType: 'User',
      targetId: newUser.id,
      result: 'SUCCESS',
      metadata: { username: newUser.username },
    }, { tx });

    logger.info({ username: data.username, role: data.role }, 'Created new LDAP user');
    return { created: newUser };
  });
}

/**
 * The login of a directory-verified user: the account that carries this LDAP identity
 * (`findLdapAccount`), with its names and address synced from the directory (`realignEmail`), or a
 * new pending account when the username is free (`provision`).
 *
 * @returns A refusal when the account is refused (`findLdapAccount`), or when the directory's mail
 *   belongs to another account at first sign-in (`email_in_use`, #266).
 */
async function createOrUpdateUser(
  prisma: PrismaClient,
  username: string,
  role: Role,
  userAttributes: Record<string, string[]>
): Promise<LdapLogin> {
  const mail = directoryMail(username, userAttributes.mail?.[0]);

  // Extract firstName and lastName from LDAP attributes
  const firstName =
    userAttributes.givenName?.[0] ||
    userAttributes.firstName?.[0] ||
    userAttributes.cn?.[0]?.split(' ')[0] ||
    '';

  const lastName =
    userAttributes.sn?.[0] ||
    userAttributes.lastName?.[0] ||
    userAttributes.cn?.[0]?.split(' ').slice(1).join(' ') ||
    '';

  logger.info(
    {
      email: mail,
      firstName,
      lastName,
      availableAttributes: Object.keys(userAttributes),
    },
    `LDAP attributes for ${username}`
  );

  let account = await findLdapAccount(prisma, username);

  if (account === null) {
    const provisioned = await provision(prisma, { username, role, mail, firstName, lastName });
    if ('emailHolderId' in provisioned) {
      logger.warn(
        { username, emailHolderId: provisioned.emailHolderId },
        'LDAP first sign-in refused: the directory mail belongs to another account'
      );
      return { user: null, reason: 'email_in_use', emailHolderId: provisioned.emailHolderId };
    }
    if ('created' in provisioned) {
      const user = provisioned.created;
      // Real email already provided by LDAP: send the verification right away,
      // no need to wait for the user to enter it on the login page.
      // Fire-and-forget: don't block the login response on the SMTP send.
      if (mail !== undefined) {
        sendVerificationEmail(prisma, {
          userId: user.id,
          reason: 'user_created',
        }).catch(err => {
          logger.warn(
            { username, err },
            'Failed to send verification email for new LDAP user'
          );
        });
      }

      return { user };
    }
    account = provisioned.found;
  }

  if (account === 'refused') return { user: null, reason: 'account_refused' };
  let user = account;

  // Update firstName and lastName if they differ
  if (user.firstName !== firstName || user.lastName !== lastName) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName,
        lastName,
      },
    });
    logger.info(
      { username, firstName, lastName },
      `Updated firstName/lastName for user`
    );
  }

  // Without a directory mail the stored address, one the user gave included, stays.
  if (mail !== undefined && user.email !== mail) {
    user = await realignEmail(prisma, user, mail);
  }
  return { user };
}

/**
 * Moves an LDAP user's address to the directory's mail (#230): unverified, the links mailed to the
 * old address revoked, audited. The last-admin lock comes first: an unverified address can take an
 * administrator out of the break-glass count a strategy change reads under that lock.
 */
async function realignEmail(prisma: PrismaClient, user: User, email: string): Promise<User> {
  // Read first, so an address another account holds costs one query per sign-in rather than the
  // lock and a rolled-back write; the unique constraint still decides a race.
  const holder = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const realigned = holder !== null && holder.id !== user.id
    ? 'held'
    : await prisma.$transaction(async tx => {
      await acquireLastAdminLock(tx);
      // Conditional: a concurrent sign-in that moved it already leaves nothing to do.
      const resetTokensRevoked = await moveUserEmail(tx, user.id, email, { email: { not: email } });
      if (resetTokensRevoked !== null) {
        // Pre-session: no actor (CLAUDE.md, rule 4).
        await logAudit({ prisma, logger }, {
          action: 'EMAIL_CHANGED',
          targetType: 'User',
          targetId: user.id,
          result: 'SUCCESS',
          metadata: { reason: 'ldap_sync', resetTokensRevoked },
        }, { tx });
      }
      return { user: await tx.user.findUniqueOrThrow({ where: { id: user.id } }), changed: resetTokensRevoked !== null };
    }).catch((error: unknown) => {
      if (isUniqueViolation(error, 'users_email_key')) return 'held' as const;
      throw error;
    });

  if (realigned === 'held') {
    // Everything is kept and the sign-in goes on.
    logger.warn({ userId: user.id }, 'LDAP mail belongs to another account: the stored address is kept');
    await logAudit({ prisma, logger }, {
      action: 'EMAIL_CHANGED',
      targetType: 'User',
      targetId: user.id,
      result: 'FAILURE',
      metadata: { reason: 'ldap_sync_email_in_use' },
    });
    return user;
  }
  // After the commit; a failed send changes nothing and fails no sign-in.
  if (realigned.changed) {
    sendVerificationEmail(prisma, { userId: user.id, reason: 'email_changed' }).catch(err => {
      logger.warn({ userId: user.id, err }, 'Failed to send verification email for a realigned LDAP address');
    });
  }
  return realigned.user;
}
