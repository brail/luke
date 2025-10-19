/**
 * Config Manager per Luke API
 * Gestisce la cifratura/decifratura dei valori sensibili in AppConfig
 * usando AES-256-GCM con master key da file ~/.luke/secret.key
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import pino from 'pino';

// Logger interno per config manager
const logger = pino({ level: 'info' });

/**
 * Interfaccia per configurazione LDAP
 */
export interface LdapConfig {
  enabled: boolean;
  url: string;
  bindDN: string;
  bindPassword: string;
  searchBase: string;
  searchFilter: string;
  groupSearchBase: string;
  groupSearchFilter: string;
  roleMapping: Record<string, string>;
  strategy: 'local-first' | 'ldap-first' | 'local-only' | 'ldap-only';
}

const MASTER_KEY_PATH = join(homedir(), '.luke', 'secret.key');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Ottiene la master key per la cifratura
 * Se non esiste, la crea automaticamente
 */
export function getMasterKey(): Buffer {
  const keyDir = join(homedir(), '.luke');

  if (!existsSync(MASTER_KEY_PATH)) {
    // Crea directory se non esiste
    if (!existsSync(keyDir)) {
      mkdirSync(keyDir, { mode: 0o700 });
    }

    // Genera nuova master key
    const masterKey = randomBytes(KEY_LENGTH);
    writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });

    logger.info({ path: MASTER_KEY_PATH }, 'Master key creata');
  }

  const keyBuffer = readFileSync(MASTER_KEY_PATH);

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `Master key deve essere di ${KEY_LENGTH} bytes, trovati ${keyBuffer.length}`
    );
  }

  return keyBuffer;
}

/**
 * Cifra un valore usando AES-256-GCM
 * @param plaintext - Testo da cifrare
 * @returns Stringa nel formato "iv:authTag:ciphertext" (tutto in hex)
 */
export function encryptValue(plaintext: string): string {
  const masterKey = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Formato: iv:authTag:ciphertext (tutto in hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decifra un valore usando AES-256-GCM
 * @param encrypted - Stringa nel formato "iv:authTag:ciphertext"
 * @returns Testo decifrato
 */
export function decryptValue(encrypted: string): string {
  const masterKey = getMasterKey();
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error(
      'Formato encrypted non valido. Atteso: iv:authTag:ciphertext'
    );
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Salva una configurazione nel database con supporto cifratura
 *
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione (deve rispettare formato e prefissi ammessi)
 * @param value - Valore da salvare
 * @param encrypt - Se true, cifra il valore con AES-256-GCM prima di salvarlo
 *
 * @example
 * // Salva valore plaintext
 * await saveConfig(prisma, "app.name", "Luke", false);
 *
 * @example
 * // Salva valore cifrato
 * await saveConfig(prisma, "auth.ldap.password", "secret123", true);
 */
export async function saveConfig(
  prisma: PrismaClient,
  key: string,
  value: string,
  encrypt: boolean = false
): Promise<void> {
  const finalValue = encrypt ? encryptValue(value) : value;

  await prisma.appConfig.upsert({
    where: { key },
    update: {
      value: finalValue,
      isEncrypted: encrypt,
      updatedAt: new Date(),
    },
    create: {
      key,
      value: finalValue,
      isEncrypted: encrypt,
    },
  });
}

/**
 * Recupera una configurazione dal database con supporto decifratura
 *
 * **SICUREZZA**: Per motivi di sicurezza, questa funzione dovrebbe essere usata
 * solo per singole chiavi. Per liste multiple, usare `listConfigsPaged`.
 *
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione
 * @param decrypt - Se true, decifra automaticamente i valori cifrati
 * @returns Valore della configurazione (decifrato se richiesto e cifrato)
 *
 * @example
 * // Recupera valore decifrato
 * const value = await getConfig(prisma, "auth.ldap.password", true);
 *
 * @example
 * // Recupera valore raw (cifrato rimane cifrato)
 * const value = await getConfig(prisma, "auth.ldap.password", false);
 */
export async function getConfig(
  prisma: PrismaClient,
  key: string,
  decrypt: boolean = true
): Promise<string | null> {
  const config = await prisma.appConfig.findUnique({
    where: { key },
  });

  if (!config) {
    return null;
  }

  if (config.isEncrypted && decrypt) {
    try {
      return decryptValue(config.value);
    } catch (error) {
      logger.error(
        {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Errore decifratura config'
      );
      throw new Error(`Impossibile decifrare configurazione: ${key}`);
    }
  }

  return config.value;
}

/**
 * Lista tutte le configurazioni
 * @param prisma - Client Prisma
 * @param decrypt - Se true, decifra i valori cifrati
 * @returns Array di configurazioni
 */
export async function listConfigs(
  prisma: PrismaClient,
  decrypt: boolean = true
): Promise<Array<{ key: string; value: string; isEncrypted: boolean }>> {
  const configs = await prisma.appConfig.findMany({
    orderBy: { key: 'asc' },
  });

  return configs.map(config => ({
    key: config.key,
    value:
      config.isEncrypted && decrypt
        ? (() => {
            try {
              return decryptValue(config.value);
            } catch (error) {
              logger.error(
                {
                  key: config.key,
                  error:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                'Errore decifratura config'
              );
              return '[ERRORE DECIFRATURA]';
            }
          })()
        : config.value,
    isEncrypted: config.isEncrypted,
  }));
}

/**
 * Lista configurazioni con paginazione, filtri e ordinamento
 *
 * **SICUREZZA**: I valori cifrati non vengono mai decrittati in questa funzione.
 * Per valori cifrati, `valuePreview` sarà sempre `null`.
 *
 * @param prisma - Client Prisma
 * @param params - Parametri per filtri, paginazione e ordinamento
 * @param params.q - Ricerca per chiave (case-insensitive)
 * @param params.category - Filtra per categoria (prefisso della chiave)
 * @param params.isEncrypted - Filtra per tipo di cifratura
 * @param params.sortBy - Campo per ordinamento
 * @param params.sortDir - Direzione ordinamento
 * @param params.page - Numero pagina (1-based)
 * @param params.pageSize - Dimensione pagina (5-100)
 * @returns Risultati paginati con metadati
 *
 * @example
 * // Lista base con paginazione
 * const result = await listConfigsPaged(prisma, { page: 1, pageSize: 20 });
 *
 * @example
 * // Ricerca con filtri
 * const result = await listConfigsPaged(prisma, {
 *   q: "ldap",
 *   category: "auth",
 *   isEncrypted: true,
 *   sortBy: "updatedAt",
 *   sortDir: "desc",
 *   page: 1,
 *   pageSize: 50
 * });
 */
export async function listConfigsPaged(
  prisma: PrismaClient,
  params: {
    q?: string;
    category?: string;
    isEncrypted?: boolean;
    sortBy?: 'key' | 'updatedAt';
    sortDir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{
  items: Array<{
    key: string;
    valuePreview: string | null;
    isEncrypted: boolean;
    category: string;
    updatedAt: string;
  }>;
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
}> {
  const {
    q,
    category,
    isEncrypted,
    sortBy = 'key',
    sortDir = 'asc',
    page = 1,
    pageSize = 20,
  } = params;

  // Costruisci where clause per filtri
  const where: any = {};

  // Gestisci filtri per key
  if (q && category) {
    // Se abbiamo sia ricerca che categoria, combina i filtri
    where.AND = [
      {
        key: {
          contains: q,
          // SQLite non supporta mode: 'insensitive'
        },
      },
      {
        key: {
          startsWith: `${category}.`,
        },
      },
    ];
  } else if (q) {
    where.key = {
      contains: q,
      // SQLite non supporta mode: 'insensitive'
    };
  } else if (category) {
    where.key = {
      startsWith: `${category}.`,
    };
  }

  if (typeof isEncrypted === 'boolean') {
    where.isEncrypted = isEncrypted;
  }

  // Calcola skip per paginazione
  const skip = (page - 1) * pageSize;

  // Crea where clause per count (senza mode: 'insensitive' che non è supportato)
  const countWhere: any = {};

  if (q && category) {
    countWhere.AND = [
      {
        key: {
          contains: q,
          // Rimuovi mode per count()
        },
      },
      {
        key: {
          startsWith: `${category}.`,
        },
      },
    ];
  } else if (q) {
    countWhere.key = {
      contains: q,
      // Rimuovi mode per count()
    };
  } else if (category) {
    countWhere.key = {
      startsWith: `${category}.`,
    };
  }

  if (typeof isEncrypted === 'boolean') {
    countWhere.isEncrypted = isEncrypted;
  }

  // Esegui query parallele per items e total
  const [itemsRaw, total] = await Promise.all([
    prisma.appConfig.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take: pageSize,
      select: {
        key: true,
        value: true,
        isEncrypted: true,
        updatedAt: true,
      },
    }),
    prisma.appConfig.count({ where: countWhere }),
  ]);

  // Processa i risultati
  const items = itemsRaw.map(item => ({
    key: item.key,
    category: item.key.split('.')[0] || 'misc',
    isEncrypted: item.isEncrypted,
    valuePreview: item.isEncrypted ? null : item.value, // Passa sempre il valore completo
    updatedAt: item.updatedAt.toISOString(),
  }));

  return {
    items,
    page,
    pageSize,
    total,
    hasNextPage: skip + pageSize < total,
  };
}

/**
 * Elimina una configurazione
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione da eliminare
 */
export async function deleteConfig(
  prisma: PrismaClient,
  key: string
): Promise<void> {
  await prisma.appConfig.delete({
    where: { key },
  });
}

/**
 * Recupera un segreto dal database e lo decifra
 * @param prisma - Client Prisma
 * @param key - Chiave del segreto da recuperare
 * @returns Valore decifrato del segreto
 * @throws Error se la chiave non esiste o non è cifrata
 */
export async function getSecret(
  prisma: PrismaClient,
  key: string
): Promise<string> {
  const config = await prisma.appConfig.findUnique({
    where: { key },
  });

  if (!config) {
    throw new Error(`Segreto '${key}' non trovato in AppConfig`);
  }

  if (!config.isEncrypted) {
    throw new Error(
      `La configurazione '${key}' non è cifrata. Usa getConfig() per valori non cifrati.`
    );
  }

  try {
    return decryptValue(config.value);
  } catch (error) {
    logger.error(
      { key, error: error instanceof Error ? error.message : 'Unknown error' },
      'Errore decifratura segreto'
    );
    throw new Error(`Impossibile decifrare segreto: ${key}`);
  }
}

/**
 * Recupera il TTL della cache tokenVersion da AppConfig
 * @param prisma - Client Prisma
 * @returns TTL in millisecondi (default: 60000ms = 60s)
 */
export async function getTokenVersionCacheTTL(
  prisma: PrismaClient
): Promise<number> {
  const config = await getConfig(
    prisma,
    'security.tokenVersionCacheTTL',
    false
  );

  if (!config) {
    return 60000; // Default: 60 secondi
  }

  const ttl = parseInt(config, 10);

  // Validazione: min 10s, max 10min
  if (isNaN(ttl) || ttl < 10000 || ttl > 600000) {
    return 60000;
  }

  return ttl;
}

/**
 * Recupera la password policy da AppConfig
 * @param prisma - Client Prisma
 * @returns Password policy con validazioni hard minimum per sicurezza
 */
export async function getPasswordPolicy(prisma: PrismaClient): Promise<{
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
}> {
  const [
    minLength,
    requireUppercase,
    requireLowercase,
    requireDigit,
    requireSpecialChar,
  ] = await Promise.all([
    getConfig(prisma, 'security.password.minLength', false),
    getConfig(prisma, 'security.password.requireUppercase', false),
    getConfig(prisma, 'security.password.requireLowercase', false),
    getConfig(prisma, 'security.password.requireDigit', false),
    getConfig(prisma, 'security.password.requireSpecialChar', false),
  ]);

  return {
    minLength: Math.max(parseInt(minLength || '12', 10), 8), // Min assoluto: 8 caratteri
    requireUppercase: requireUppercase === 'true',
    requireLowercase: requireLowercase === 'true',
    requireDigit: requireDigit === 'true',
    requireSpecialChar: requireSpecialChar === 'true',
  };
}

/**
 * Recupera la configurazione LDAP completa dal database
 * @param prisma - Client Prisma
 * @returns Configurazione LDAP decifrata e tipizzata
 * @throws Error se le configurazioni non sono complete
 */
export async function getLdapConfig(prisma: PrismaClient): Promise<LdapConfig> {
  const configKeys = [
    'auth.ldap.enabled',
    'auth.ldap.url',
    'auth.ldap.bindDN',
    'auth.ldap.bindPassword',
    'auth.ldap.searchBase',
    'auth.ldap.searchFilter',
    'auth.ldap.groupSearchBase',
    'auth.ldap.groupSearchFilter',
    'auth.ldap.roleMapping',
    'auth.strategy',
  ];

  const configs = await prisma.appConfig.findMany({
    where: {
      key: {
        in: configKeys,
      },
    },
  });

  // Crea mappa per accesso rapido
  const configMap = new Map(configs.map(c => [c.key, c]));

  // Se non ci sono configurazioni LDAP, restituisci configurazione di default
  if (configs.length === 0) {
    return {
      enabled: false,
      url: '',
      bindDN: '',
      bindPassword: '',
      searchBase: '',
      searchFilter: '',
      groupSearchBase: '',
      groupSearchFilter: '',
      roleMapping: {},
      strategy: 'local-first',
    };
  }

  // Helper per recuperare valore con fallback
  const getConfigValue = (key: string, defaultValue: string = ''): string => {
    const config = configMap.get(key);
    if (!config) return defaultValue;
    return config.isEncrypted ? decryptValue(config.value) : config.value;
  };

  // Recupera e decifra i valori con fallback per chiavi mancanti
  const enabled = configMap.get('auth.ldap.enabled')?.value === 'true';
  const url = getConfigValue('auth.ldap.url');
  const bindDN = getConfigValue('auth.ldap.bindDN');
  const bindPassword = getConfigValue('auth.ldap.bindPassword');
  const searchBase = getConfigValue('auth.ldap.searchBase');
  const searchFilter = getConfigValue('auth.ldap.searchFilter');
  const groupSearchBase = getConfigValue('auth.ldap.groupSearchBase');
  const groupSearchFilter = getConfigValue('auth.ldap.groupSearchFilter');
  const roleMappingStr = getConfigValue('auth.ldap.roleMapping', '{}');
  const strategy = (configMap.get('auth.strategy')?.value as LdapConfig['strategy']) || 'local-first';

  // Parsa roleMapping da JSON
  let roleMapping: Record<string, string>;
  try {
    roleMapping = JSON.parse(roleMappingStr);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'Errore parsing roleMapping, usando mapping vuoto'
    );
    roleMapping = {};
  }

  const result = {
    enabled,
    url,
    bindDN,
    bindPassword,
    searchBase,
    searchFilter,
    groupSearchBase,
    groupSearchFilter,
    roleMapping,
    strategy,
  };

  return result;
}
