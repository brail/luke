/**
 * Modulo per autenticazione LDAP
 * Gestisce connessione, ricerca utenti e mapping ruoli
 */

import { TRPCError } from '@trpc/server';
import type { Entry } from 'ldapts';
import pino from 'pino';

import {
  getLdapConfig,
  getLdapResilienceConfig,
  type LdapConfig,
} from './configManager';
import { ResilientLdapClient } from './ldapClient';

/**
 * Helper per normalizzare un attributo ldapts a array di stringhe
 */
function getAttr(entry: Entry, key: string): string[] {
  const v = entry[key];
  if (!v) return [];
  if (Array.isArray(v)) return (v as (Buffer | string)[]).filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' ? [v] : [];
}

import type { PrismaClient, User } from '@prisma/client';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Escapa i caratteri speciali LDAP in un valore da inserire in un filtro di ricerca.
 * Segue RFC 4515 (Section 3).
 */
function escapeLdapFilter(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

/**
 * Autentica un utente via LDAP
 * @param prisma - Client Prisma
 * @param username - Username dell'utente
 * @param password - Password dell'utente
 * @returns User object se autenticazione riuscita, null altrimenti
 */
export async function authenticateViaLdap(
  prisma: PrismaClient,
  username: string,
  password: string
): Promise<User | null> {
  let ldapClient: ResilientLdapClient | null = null;

  try {
    // Recupera configurazioni LDAP
    const [config, resilienceConfig] = await Promise.all([
      getLdapConfig(prisma),
      getLdapResilienceConfig(prisma),
    ]);

    // Verifica che LDAP sia abilitato
    if (!config.enabled) {
      logger.debug('LDAP authentication disabled');
      return null;
    }

    // Verifica che la configurazione sia completa
    if (!config.url || !config.searchBase || !config.searchFilter) {
      logger.error('LDAP configuration incomplete');
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Configurazione LDAP incompleta',
      });
    }

    logger.info({ username }, 'Attempting LDAP authentication');

    // Crea client LDAP resiliente
    ldapClient = new ResilientLdapClient(config, resilienceConfig, logger);
    await ldapClient.connect();

    // Bind amministrativo per cercare l'utente
    if (config.bindDN && config.bindPassword) {
      await ldapClient.bind(config.bindDN, config.bindPassword);
    }

    // Cerca l'utente
    const userResult = await searchUser(ldapClient, config, username);
    if (!userResult) {
      logger.info({ username }, 'User not found in LDAP');
      return null;
    }

    const { dn: userDN, attributes: userAttributes } = userResult;

    // Verifica le credenziali dell'utente
    const isValidCredentials = await verifyUserCredentials(
      ldapClient,
      userDN,
      password
    );
    if (!isValidCredentials) {
      logger.info({ username }, 'Invalid credentials for user');
      return null;
    }

    // Ripristina il bind amministrativo per la ricerca gruppi,
    // poiché verifyUserCredentials lega il client come utente finale
    if (config.bindDN && config.bindPassword) {
      await ldapClient.bind(config.bindDN, config.bindPassword);
    }

    // Cerca i gruppi dell'utente
    const userGroups = await searchUserGroups(ldapClient, config, userDN);

    const role = determineUserRole(userGroups, config.roleMapping, logger);

    // Crea o aggiorna l'utente nel database
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
    });
  } finally {
    // Chiudi connessione LDAP
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
 * Cerca un utente nel server LDAP
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

  try {
    const entries = await client.search(config.searchBase, options);

    if (entries.length === 0) {
      return null;
    }

    // Prendi il primo risultato
    // ldapts restituisce entry flat: { dn: string; [key]: string | string[] }
    const entry = entries[0];
    const dn = entry.dn;
    const attributes: Record<string, string[]> = {};
    for (const key of Object.keys(entry)) {
      if (key === 'dn') continue;
      attributes[key] = getAttr(entry, key);
    }

    return { dn, attributes };
  } catch (error) {
    // Il client resiliente gestisce già la mappatura degli errori
    throw error;
  }
}

/**
 * Verifica le credenziali dell'utente
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
    // Se è un errore di credenziali, restituisci false
    if (error instanceof TRPCError && error.code === 'UNAUTHORIZED') {
      return false;
    }
    // Per altri errori (rete, timeout), rilancia
    throw error;
  }
}

/**
 * Cerca i gruppi dell'utente
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
    // Non fallire l'autenticazione per errori di ricerca gruppi
    logger.warn(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'Group search failed, proceeding without group membership'
    );
    return [];
  }
}

/**
 * Determina il ruolo dell'utente basato sui gruppi LDAP
 */
function determineUserRole(
  userGroups: string[],
  roleMapping: Record<string, string>,
  log?: any
): 'admin' | 'editor' | 'viewer' {
  // Cerca il mapping più specifico
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

  // Default a viewer se nessun mapping trovato
  if (log) {
    log.info('No role mapping found, defaulting to viewer');
  }
  return 'viewer';
}

/**
 * Crea o aggiorna l'utente nel database
 */
async function createOrUpdateUser(
  prisma: PrismaClient,
  username: string,
  role: 'admin' | 'editor' | 'viewer',
  userAttributes: any
): Promise<User> {
  // Estrai email dagli attributi LDAP
  const ldapEmail = userAttributes.mail?.[0] || `${username}@ldap.local`;

  // Estrai firstName e lastName dagli attributi LDAP
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

  // Cerca utente esistente (attivi, inclusi quelli in attesa di approvazione)
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

    // Aggiorna firstName e lastName se sono diversi
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

    // Verifica che abbia un'identità LDAP — usa una transaction per evitare race condition
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
    // Crea nuovo utente
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
  }

  return user;
}
