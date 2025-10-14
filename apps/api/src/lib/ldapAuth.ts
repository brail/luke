/**
 * Modulo per autenticazione LDAP
 * Gestisce connessione, ricerca utenti e mapping ruoli
 */

import * as ldap from 'ldapjs';
import type { PrismaClient, User } from '@prisma/client';
import { getLdapConfig, type LdapConfig } from './configManager';
import { TRPCError } from '@trpc/server';

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
  let client: ldap.Client | null = null;

  try {
    // Recupera configurazione LDAP
    const config = await getLdapConfig(prisma);

    // Verifica che LDAP sia abilitato
    if (!config.enabled) {
      console.log('LDAP authentication disabled');
      return null;
    }

    // Verifica che la configurazione sia completa
    if (!config.url || !config.searchBase || !config.searchFilter) {
      console.error('LDAP configuration incomplete');
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Configurazione LDAP incompleta',
      });
    }

    console.log(`Attempting LDAP authentication for user: ${username}`);

    // Crea client LDAP
    client = ldap.createClient({
      url: config.url,
      timeout: 10000, // 10 secondi timeout
      connectTimeout: 5000, // 5 secondi per connessione
    });

    // Bind amministrativo per cercare l'utente
    if (config.bindDN && config.bindPassword) {
      await new Promise<void>((resolve, reject) => {
        client!.bind(config.bindDN, config.bindPassword, err => {
          if (err) {
            console.error('LDAP admin bind failed:', err);
            reject(
              new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Impossibile connettersi al server LDAP',
              })
            );
          } else {
            resolve();
          }
        });
      });
    }

    // Cerca l'utente
    const userResult = await searchUser(client, config, username);
    if (!userResult) {
      console.log(`User ${username} not found in LDAP`);
      return null;
    }

    const { dn: userDN, attributes: userAttributes } = userResult;

    // Verifica le credenziali dell'utente
    const isValidCredentials = await verifyUserCredentials(
      client,
      userDN,
      password
    );
    if (!isValidCredentials) {
      console.log(`Invalid credentials for user ${username}`);
      return null;
    }

    // Cerca i gruppi dell'utente
    const userGroups = await searchUserGroups(client, config, userDN);

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

    console.log(
      `LDAP authentication successful for user: ${username}, role: ${role}`
    );
    return user;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    console.error('LDAP authentication error:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Errore durante autenticazione LDAP',
    });
  } finally {
    // Chiudi connessione LDAP
    if (client) {
      try {
        await new Promise<void>(resolve => {
          client!.unbind(() => {
            resolve();
          });
        });
      } catch (error) {
        console.warn('Error closing LDAP connection:', error);
      }
    }
  }
}

/**
 * Cerca un utente nel server LDAP
 */
async function searchUser(
  client: ldap.Client,
  config: LdapConfig,
  username: string
): Promise<{ dn: string; attributes: any } | null> {
  return new Promise((resolve, reject) => {
    const searchFilter = config.searchFilter.replace(
      /\$\{username\}/g,
      username
    );

    console.log(`LDAP Search - Base: ${config.searchBase}`);
    console.log(`LDAP Search - Filter: ${searchFilter}`);
    console.log(`LDAP Search - Username: ${username}`);

    client.search(
      config.searchBase,
      {
        filter: searchFilter,
        scope: 'sub',
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
      },
      (err, res) => {
        if (err) {
          console.error('LDAP search error:', err);
          reject(
            new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Errore durante ricerca utente LDAP',
            })
          );
          return;
        }

        let foundUser: { dn: string; attributes: any } | null = null;

        res.on('searchEntry', entry => {
          const dn = entry.dn.toString();
          const attributes = entry.attributes.reduce((acc: any, attr: any) => {
            acc[attr.type] = attr.values;
            return acc;
          }, {});

          foundUser = { dn, attributes };
          console.log(`Found user DN: ${dn}`);
          console.log(`User attributes:`, attributes);
        });

        res.on('error', err => {
          console.error('LDAP search stream error:', err);
          reject(
            new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Errore durante ricerca utente LDAP',
            })
          );
        });

        res.on('end', () => {
          console.log(
            `LDAP search completed. Found user: ${foundUser ? foundUser.dn : 'none'}`
          );
          resolve(foundUser);
        });
      }
    );
  });
}

/**
 * Verifica le credenziali dell'utente
 */
async function verifyUserCredentials(
  client: ldap.Client,
  userDN: string,
  password: string
): Promise<boolean> {
  return new Promise(resolve => {
    client.bind(userDN, password, err => {
      if (err) {
        console.log(`LDAP bind failed for ${userDN}:`, err.message);
        resolve(false);
      } else {
        console.log(`LDAP bind successful for ${userDN}`);
        resolve(true);
      }
    });
  });
}

/**
 * Cerca i gruppi dell'utente
 */
async function searchUserGroups(
  client: ldap.Client,
  config: LdapConfig,
  userDN: string
): Promise<string[]> {
  if (!config.groupSearchBase || !config.groupSearchFilter) {
    console.log('Group search not configured, skipping group lookup');
    return [];
  }

  return new Promise((resolve, reject) => {
    const groupFilter = config.groupSearchFilter.replace(
      /\$\{userDN\}/g,
      userDN
    );

    client.search(
      config.groupSearchBase,
      {
        filter: groupFilter,
        scope: 'sub',
        attributes: ['cn', 'dn'],
      },
      (err, res) => {
        if (err) {
          console.error('LDAP group search error:', err);
          // Non fallire l'autenticazione per errori di ricerca gruppi
          resolve([]);
          return;
        }

        const groups: string[] = [];

        res.on('searchEntry', entry => {
          const groupDN = entry.dn.toString();
          groups.push(groupDN);
          console.log(`Found user group: ${groupDN}`);
        });

        res.on('error', err => {
          console.error('LDAP group search stream error:', err);
          // Non fallire l'autenticazione per errori di ricerca gruppi
          resolve([]);
        });

        res.on('end', () => {
          console.log(`User belongs to ${groups.length} groups`);
          resolve(groups);
        });
      }
    );
  });
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
  userDN: string,
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

  // Cerca utente esistente
  let user = await prisma.user.findFirst({
    where: {
      username,
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
