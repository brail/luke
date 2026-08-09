/**
 * LDAP authentication module.
 * Manages directory connection, user search, credential verification, and role mapping.
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';

import {
  getConfig,
  getLdapConfig,
  getLdapResilienceConfig,
  type LdapConfig,
} from './configManager';
import { sendVerificationEmail } from './emailHelpers';
import { ResilientLdapClient } from './ldapClient';

import type { PrismaClient, User } from '@prisma/client';
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

/**
 * True if the email is the synthetic one generated for an LDAP user with no `mail` value set.
 */
export function isSyntheticLdapEmail(email: string): boolean {
  return email.endsWith('@ldap.local');
}

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Escapes special characters in a value to be safely embedded in an LDAP search filter.
 * Follows RFC 4515 §3.
 */
export function escapeLdapFilter(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

/**
 * Authenticates a user against the configured LDAP directory.
 * Performs bind authentication, group-based role resolution, and
 * creates or updates the local user record on success.
 *
 * @param prisma - Prisma client.
 * @returns Local `User` record on success, or `null` if authentication fails
 *   (LDAP disabled, user not found, or invalid credentials).
 * @throws {TRPCError} If the LDAP configuration is incomplete or an unexpected error occurs.
 */
export async function authenticateViaLdap(
  prisma: PrismaClient,
  username: string,
  password: string
): Promise<User | null> {
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
      return null;
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

    // Administrative bind to search for the user
    if (config.bindDN && config.bindPassword) {
      await ldapClient.bind(config.bindDN, config.bindPassword);
    }

    // Search for the user
    const userResult = await searchUser(ldapClient, config, username);
    if (!userResult) {
      logger.info({ username }, 'User not found in LDAP');
      return null;
    }

    const { dn: userDN, attributes: userAttributes } = userResult;

    // Verify the user's credentials
    const isValidCredentials = await verifyUserCredentials(
      ldapClient,
      userDN,
      password
    );
    if (!isValidCredentials) {
      logger.info({ username }, 'Invalid credentials for user');
      return null;
    }

    // Restore the administrative bind for the group search,
    // since verifyUserCredentials binds the client as the end user
    if (config.bindDN && config.bindPassword) {
      await ldapClient.bind(config.bindDN, config.bindPassword);
    }

    // Search for the user's groups
    const userGroups = await searchUserGroups(ldapClient, config, userDN);

    const role = determineUserRole(userGroups, config.roleMapping, logger);

    // Create or update the user in the database
    const user = await createOrUpdateUser(
      prisma,
      username,
      role,
      userAttributes
    );

    logger.info({ username, role }, 'LDAP authentication successful');
    return user;
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

/**
 * Search for a user on the LDAP server
 */
async function searchUser(
  client: ResilientLdapClient,
  config: LdapConfig,
  username: string
): Promise<{ dn: string; attributes: Record<string, string[]> } | null> {
  const searchFilter = config.searchFilter.replace(
    /\$\{username\}/g,
    escapeLdapFilter(username)
  );

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
 * Verify the user's credentials
 */
async function verifyUserCredentials(
  client: ResilientLdapClient,
  userDN: string,
  password: string
): Promise<boolean> {
  try {
    await client.bind(userDN, password);
    return true;
  } catch (error) {
    // If it's a credentials error, return false
    if (error instanceof TRPCError && error.code === 'UNAUTHORIZED') {
      return false;
    }
    // For other errors (network, timeout), rethrow
    throw error;
  }
}

/**
 * Search for the user's groups
 */
async function searchUserGroups(
  client: ResilientLdapClient,
  config: LdapConfig,
  userDN: string
): Promise<string[]> {
  if (!config.groupSearchBase || !config.groupSearchFilter) {
    return [];
  }

  const groupFilter = config.groupSearchFilter.replace(
    /\$\{userDN\}/g,
    escapeLdapFilter(userDN)
  );

  const options = {
    filter: groupFilter,
    scope: 'sub' as const,
    attributes: ['cn', 'dn'],
  };

  try {
    const entries = await client.search(config.groupSearchBase, options);
    return entries.map(entry => entry.dn);
  } catch (error) {
    // Don't fail authentication on group search errors
    logger.warn(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'Group search failed, proceeding without group membership'
    );
    return [];
  }
}

/**
 * Determine the user's role based on LDAP groups
 */
function determineUserRole(
  userGroups: string[],
  roleMapping: Record<string, string>,
  log?: pino.Logger
): 'admin' | 'editor' | 'viewer' {
  // Look for the most specific mapping
  for (const groupDN of userGroups) {
    if (roleMapping[groupDN]) {
      const role = roleMapping[groupDN];
      if (['admin', 'editor', 'viewer'].includes(role)) {
        if (log) {
          log.info({ groupDN, role }, `Role mapping found`);
        }
        return role as 'admin' | 'editor' | 'viewer';
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
    // no need to wait for the user to enter it manually in /auth/pending.
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

    const auditNoTeam = (meta: Record<string, unknown>) =>
      prisma.auditLog.create({
        data: { actorId: null, action: 'USER_PROVISIONED_NO_DEFAULT_TEAM', targetType: 'User', targetId: user!.id, result: 'FAILURE', metadata: { username: user!.username, ...meta } },
      }).catch(e => logger.error({ err: e }, 'Failed to write provisioning audit log'));

    // Auto-assign to default team if configured (graceful: failure leaves user without team)
    const defaultTeamId = (await getConfig(prisma, 'auth.provisioning.defaultTeamId', false))?.trim() || null;
    if (defaultTeamId) {
      try {
        await prisma.companyTeamMembership.create({
          data: { teamId: defaultTeamId, userId: user.id },
        });
        logger.info({ defaultTeamId, userId: user.id }, 'Auto-assigned LDAP user to default team');
      } catch (err) {
        logger.warn({ defaultTeamId, userId: user.id, err }, 'Auto-team assignment failed, user created without team');
        await auditNoTeam({ defaultTeamId });
      }
    } else {
      await auditNoTeam({ reason: 'auth.provisioning.defaultTeamId not configured' });
    }
  }

  return user;
}
