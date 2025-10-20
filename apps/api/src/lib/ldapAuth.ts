/**
 * Modulo per autenticazione LDAP
 * Gestisce connessione, ricerca utenti e mapping ruoli
 */

import { TRPCError } from '@trpc/server';
import pino from 'pino';

import {
  getLdapConfig,
  getLdapResilienceConfig,
  type LdapConfig,
} from './configManager';
import { ResilientLdapClient } from './ldapClient';

import type { PrismaClient, User } from '@prisma/client';

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
  const logger = pino({ level: 'info' });
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

    // Cerca i gruppi dell'utente
    const userGroups = await searchUserGroups(ldapClient, config, userDN);

    // Determina il ruolo basato sui gruppi
    const role = determineUserRole(userGroups, config.roleMapping);

    // Crea o aggiorna l'utente nel database
    const user = await createOrUpdateUser(
      prisma,
      username,
      userDN,
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
): Promise<{ dn: string; attributes: any } | null> {
  const searchFilter = config.searchFilter.replace(/\$\{username\}/g, username);

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
    const entry = entries[0];
    const dn = entry.dn.toString();
    const attributes = entry.attributes.reduce((acc: any, attr: any) => {
      acc[attr.type] = attr.values;
      return acc;
    }, {});

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

  const groupFilter = config.groupSearchFilter.replace(/\$\{userDN\}/g, userDN);

  const options = {
    filter: groupFilter,
    scope: 'sub' as const,
    attributes: ['cn', 'dn'],
  };

  try {
    const entries = await client.search(config.groupSearchBase, options);
    return entries.map(entry => entry.dn.toString());
  } catch (error) {
    // Non fallire l'autenticazione per errori di ricerca gruppi
    // Log dell'errore ma continua
    return [];
  }
}

/**
 * Determina il ruolo dell'utente basato sui gruppi LDAP
 */
function determineUserRole(
  userGroups: string[],
  roleMapping: Record<string, string>
): 'admin' | 'editor' | 'viewer' {
  // Cerca il mapping più specifico
  for (const groupDN of userGroups) {
    if (roleMapping[groupDN]) {
      const role = roleMapping[groupDN];
      if (['admin', 'editor', 'viewer'].includes(role)) {
        console.log(`Role mapping found: ${groupDN} -> ${role}`);
        return role as 'admin' | 'editor' | 'viewer';
      }
    }
  }

  // Default a viewer se nessun mapping trovato
  console.log('No role mapping found, defaulting to viewer');
  return 'viewer';
}

/**
 * Crea o aggiorna l'utente nel database
 */
async function createOrUpdateUser(
  prisma: PrismaClient,
  username: string,
  _userDN: string,
  role: 'admin' | 'editor' | 'viewer',
  userAttributes: any
): Promise<User> {
  // Estrai email dagli attributi LDAP
  const ldapEmail = userAttributes.mail?.[0] || `${username}@ldap.local`;

  // Estrai firstName e lastName dagli attributi LDAP
  // Prova diversi attributi comuni per firstName
  const firstName =
    userAttributes.givenName?.[0] ||
    userAttributes.firstName?.[0] ||
    userAttributes.cn?.[0]?.split(' ')[0] ||
    '';

  // Prova diversi attributi comuni per lastName
  const lastName =
    userAttributes.sn?.[0] ||
    userAttributes.lastName?.[0] ||
    userAttributes.cn?.[0]?.split(' ').slice(1).join(' ') ||
    '';

  console.log(`LDAP attributes for ${username}:`, {
    email: ldapEmail,
    firstName,
    lastName,
    availableAttributes: Object.keys(userAttributes),
  });

  // Cerca utente esistente (solo utenti attivi)
  let user = await prisma.user.findFirst({
    where: {
      username,
      isActive: true, // Solo utenti attivi possono autenticarsi
    },
  });

  if (user) {
    // Per utenti esistenti, aggiorniamo firstName e lastName da LDAP
    // ma NON email e ruolo per preservare modifiche manuali
    console.log(
      `User ${username} already exists, syncing firstName/lastName from LDAP`
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
      console.log(
        `Updated firstName/lastName for user ${username}: ${firstName} ${lastName}`
      );
    }

    // Verifica che abbia un'identità LDAP
    const ldapIdentity = await prisma.identity.findFirst({
      where: {
        userId: user.id,
        provider: 'LDAP',
        providerId: username,
      },
    });

    if (!ldapIdentity) {
      // Crea identità LDAP se non esiste
      await prisma.identity.create({
        data: {
          userId: user.id,
          provider: 'LDAP',
          providerId: username,
        },
      });
      console.log(`Created LDAP identity for user ${username}`);
    }
  } else {
    // Crea nuovo utente
    user = await prisma.$transaction(async tx => {
      // Crea utente
      const newUser = await tx.user.create({
        data: {
          email: ldapEmail, // Email reale da LDAP
          username,
          firstName, // Sincronizza firstName da LDAP
          lastName, // Sincronizza lastName da LDAP
          role,
          isActive: true,
        },
      });

      // Crea identità LDAP
      await tx.identity.create({
        data: {
          userId: newUser.id,
          provider: 'LDAP',
          providerId: username,
        },
      });

      console.log(
        `Created new LDAP user: ${username} with role ${role}, firstName: ${firstName}, lastName: ${lastName}`
      );
      return newUser;
    });
  }

  return user;
}
