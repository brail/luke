/**
 * LDAP authentication module.
 * Manages directory connection, user search, credential verification, and role mapping.
 */

import { TRPCError } from '@trpc/server';
import { Filter, SASL_MECHANISMS } from 'ldapts';
import pino from 'pino';

import { Roles, type Role } from '@luke/core';
import type { PrismaClient, User } from '@luke/db';

import {
  getLdapConfig,
  getLdapResilienceConfig,
  type LdapConfig,
} from './configManager';
import { isSyntheticLdapEmail, sendVerificationEmail } from './emailHelpers';
import { toErrorCode, toErrorMessage } from './error';
import { ResilientLdapClient, isDirectoryAnswer } from './ldapClient';

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

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

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
 * out — and is for the audit trail only: the public answer to a refusal is the same either way.
 */
export interface LdapRefusal {
  user: null;
  reason: 'invalid_credentials' | 'ldap_unavailable';
  errorCode?: string;
}

/** The outcome of an LDAP login: the local user it authenticated, or why it refused. */
export type LdapLogin = { user: User } | LdapRefusal;

const REFUSED: LdapRefusal = { user: null, reason: 'invalid_credentials' };

/**
 * Authenticates a user against the configured LDAP directory: service-account bind, search, bind as
 * the user, then creation or update of the local user record.
 *
 * What it does with a failure depends on whether the username has been sent to the directory yet.
 * Before that — incomplete configuration, the service-account bind, the circuit breaker in front of
 * it — a failure says nothing about the person logging in, and is thrown. From the search on, a
 * failure is returned as a refusal, whatever its cause: answering differently there would tell a
 * caller with no password which usernames the directory knows. The one throw past that point needs
 * the password: the user record could not be written after the directory verified it.
 *
 * @returns The local `User`, or a refusal with the reason for the audit trail.
 * @throws {TRPCError} When the login could not complete for a reason independent of the username,
 *   or the user record could not be synced after the password was verified.
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
    // Fetch LDAP configurations
    const [config, resilienceConfig] = await Promise.all([
      getLdapConfig(prisma),
      getLdapResilienceConfig(prisma),
    ]);

    // Check that LDAP is enabled
    if (!config.enabled) {
      logger.debug('LDAP authentication disabled');
      return REFUSED;
    }

    // Check that the configuration is complete
    if (!config.url || !config.searchBase || !config.searchFilter) {
      logger.error('LDAP configuration incomplete');
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
    const role = determineUserRole(userGroups, config.roleMapping, logger);

    // Create or update the user in the database
    const user = await createOrUpdateUser(prisma, username, role, verified.attributes);

    logger.info({ username, role }, 'LDAP authentication successful');
    return { user };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'LDAP authentication error'
    );
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
        logger.warn(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Error closing LDAP connection'
        );
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
      { username, code: toErrorCode(error), error: toErrorMessage(error) },
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
    logger.warn(
      { error: toErrorMessage(error) },
      'Group lookup failed, proceeding without group membership'
    );
    return [];
  }
}

/** A mapped value is used only if it names a known role; `Roles` is the one list. */
function isRole(value: string): value is Role {
  return (Roles as readonly string[]).includes(value);
}

/**
 * Determine the user's role based on LDAP groups
 */
function determineUserRole(
  userGroups: string[],
  roleMapping: Record<string, string>,
  log?: pino.Logger
): Role {
  // Look for the most specific mapping
  for (const groupDN of userGroups) {
    if (roleMapping[groupDN]) {
      const role = roleMapping[groupDN];
      if (isRole(role)) {
        if (log) {
          log.info({ groupDN, role }, `Role mapping found`);
        }
        return role;
      }
    }
  }

  // Default to viewer if no mapping is found (applied only when creating new users)
  if (log) {
    log.info({ userGroups }, 'No role mapping found for LDAP groups, defaulting to viewer (existing users keep their DB role)');
  }
  return 'viewer';
}

/**
 * Create or update the user in the database
 */
async function createOrUpdateUser(
  prisma: PrismaClient,
  username: string,
  role: 'admin' | 'editor' | 'viewer',
  userAttributes: Record<string, string[]>
): Promise<User> {
  // Extract email from LDAP attributes
  const ldapEmail = userAttributes.mail?.[0] || `${username}@ldap.local`;

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
      email: ldapEmail,
      firstName,
      lastName,
      availableAttributes: Object.keys(userAttributes),
    },
    `LDAP attributes for ${username}`
  );

  // Look up existing user (active, including those pending approval)
  let user = await prisma.user.findFirst({
    where: {
      username,
      isActive: true,
    },
  });

  if (user) {
    logger.info(
      { username },
      `User already exists, syncing firstName/lastName from LDAP`
    );

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

    // Verify they have an LDAP identity — use a transaction to avoid a race condition
    await prisma.$transaction(async tx => {
      const ldapIdentity = await tx.identity.findFirst({
        where: {
          userId: user!.id,
          provider: 'LDAP',
          providerId: username,
        },
      });

      if (!ldapIdentity) {
        await tx.identity.create({
          data: {
            userId: user!.id,
            provider: 'LDAP',
            providerId: username,
          },
        });
        logger.info({ username }, `Created LDAP identity for user`);
      }
    });
  } else {
    // Create new user
    user = await prisma.$transaction(async tx => {
      const newUser = await tx.user.create({
        data: {
          email: ldapEmail,
          username,
          firstName,
          lastName,
          role,
          isActive: true,
          pendingApproval: true,
        },
      });

      await tx.identity.create({
        data: {
          userId: newUser.id,
          provider: 'LDAP',
          providerId: username,
        },
      });

      logger.info(
        { username, role, firstName, lastName },
        `Created new LDAP user`
      );
      return newUser;
    });

    // Real email already provided by LDAP: send the verification right away,
    // no need to wait for the user to enter it on the login page.
    // Fire-and-forget: don't block the login response on the SMTP send.
    if (!isSyntheticLdapEmail(ldapEmail)) {
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

    // No team assignment here — a pending LDAP user has no brand or function access anyway
    // (`pendingApproval: true` blocks login), and picking a team without knowing the person
    // would just be a guess. `users.approvePending` requires an explicit team at approval time,
    // which is where a human already has to make a decision about this user.
    await prisma.auditLog.create({
      data: { actorId: null, action: 'USER_PROVISIONED_WITHOUT_TEAM', targetType: 'User', targetId: user.id, result: 'SUCCESS', metadata: { username: user.username } },
    }).catch(e => logger.error({ err: e }, 'Failed to write provisioning audit log'));
  }

  return user;
}
