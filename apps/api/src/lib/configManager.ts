/**
 * AppConfig manager for Luke API.
 * Handles encryption and decryption of sensitive values stored in the AppConfig
 * table using AES-256-GCM with a master key loaded from ~/.luke/secret.key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import pino from 'pino';
import { z } from 'zod';

import {
  type AppConfigKey,
  type AppConfigValue,
  parseConfigValue,
  CRITICAL_CONFIG_KEYS,
  LdapResilienceSchema,
  type LdapResilienceConfig,
  Roles,
} from '@luke/core';
import { getMasterKey } from '@luke/core/server';

import type { PrismaClient } from '@prisma/client';

const logger = pino({ level: 'info' });

const RoleMappingSchema = z.record(z.string(), z.enum(Roles));

/**
 * Full LDAP configuration assembled from AppConfig keys.
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

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits — esplicito per semgrep gcm-no-tag-length

/**
 * Encrypts a plaintext value using AES-256-GCM and the current master key.
 *
 * @param plaintext - Value to encrypt.
 * @returns Hex-encoded string in the format `iv:authTag:ciphertext`.
 */
export function encryptValue(plaintext: string): string {
  const masterKey = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Formato: iv:authTag:ciphertext (tutto in hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypts a value that was encrypted by `encryptValue`.
 *
 * @param encrypted - Hex-encoded string in the format `iv:authTag:ciphertext`.
 * @returns Decrypted plaintext.
 * @throws {Error} If the format is invalid or decryption fails (e.g. wrong key or tampered data).
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

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Upserts a configuration entry in the database.
 *
 * @param prisma - Prisma client.
 * @param key - Configuration key (dot-notation, must conform to AppConfigRegistry).
 * @param value - Value to store.
 * @param encrypt - When `true`, the value is encrypted with AES-256-GCM before storage.
 *
 * @example
 * // Store plaintext value
 * await saveConfig(prisma, "app.name", "Luke", false);
 *
 * @example
 * // Store encrypted value
 * await saveConfig(prisma, "auth.ldap.bindPassword", "secret123", true);
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
 * Reads a single configuration value from the database.
 *
 * **Security note**: Use this function only for individual keys.
 * For paginated listings use `listConfigsPaged` instead.
 *
 * @param prisma - Prisma client.
 * @param key - Configuration key to look up.
 * @param decrypt - When `true`, encrypted values are decrypted automatically.
 * @returns Decrypted (or raw) string value, or `null` if the key does not exist.
 *
 * @example
 * // Read decrypted value
 * const value = await getConfig(prisma, "auth.ldap.bindPassword", true);
 *
 * @example
 * // Read raw value (encrypted blob is returned as-is)
 * const value = await getConfig(prisma, "auth.ldap.bindPassword", false);
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
 * Reads a configuration value and parses it through the AppConfigRegistry Zod schema.
 * Returns the value already coerced to the correct TypeScript type (number, boolean, etc.).
 *
 * @param prisma - Prisma client.
 * @param key - Typed configuration key defined in AppConfigRegistry.
 * @returns Parsed and validated value.
 * @throws {Error} If the key does not exist in the database.
 * @throws {ZodError} If the stored value fails schema validation.
 */
export async function getTypedConfig<K extends AppConfigKey>(
  prisma: PrismaClient,
  key: K,
): Promise<AppConfigValue<K>> {
  const raw = await getConfig(prisma, key);
  if (raw === null) {
    throw new Error(`Configurazione '${key}' non trovata`);
  }
  return parseConfigValue(key, raw);
}

/**
 * Validates all critical configuration keys on server boot.
 * In production, throws an error if any key is missing or fails schema validation,
 * preventing the server from starting in a broken state.
 * In development, only a warning is logged.
 *
 * @throws {Error} In production if one or more critical keys are invalid.
 */
export async function validateCriticalConfig(prisma: PrismaClient): Promise<void> {
  const errors: string[] = [];

  await Promise.all(
    CRITICAL_CONFIG_KEYS.map(async key => {
      try {
        await getTypedConfig(prisma, key);
      } catch (err) {
        errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  if (errors.length === 0) {
    logger.info('AppConfig validation OK');
    return;
  }

  const message = `AppConfig validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  } else {
    logger.warn(message);
  }
}

/**
 * Returns all configuration entries, optionally decrypting encrypted values.
 *
 * @param prisma - Prisma client.
 * @param decrypt - When `true`, encrypted values are decrypted. Defaults to `true`.
 * @returns Array of configuration records.
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
 * Returns a paginated, filterable list of configuration entries.
 *
 * **Security**: Encrypted values are never decrypted in this function.
 * `valuePreview` is always `null` for encrypted entries.
 *
 * @param prisma - Prisma client.
 * @param params.q - Case-insensitive substring search on the key.
 * @param params.category - Filter by key prefix (e.g. `"auth"` matches `"auth.ldap.url"`).
 * @param params.isEncrypted - Filter by encryption status.
 * @param params.sortBy - Field to sort by (`'key'` or `'updatedAt'`). Defaults to `'key'`.
 * @param params.sortDir - Sort direction. Defaults to `'asc'`.
 * @param params.page - 1-based page number. Defaults to `1`.
 * @param params.pageSize - Page size (5–100). Defaults to `20`.
 * @returns Paginated result with items, total count, and pagination metadata.
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
      { key: { contains: q, mode: 'insensitive' } },
      { key: { startsWith: `${category}.` } },
    ];
  } else if (q) {
    where.key = { contains: q, mode: 'insensitive' };
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

  const countWhere: any = {};

  if (q && category) {
    countWhere.AND = [
      { key: { contains: q, mode: 'insensitive' } },
      { key: { startsWith: `${category}.` } },
    ];
  } else if (q) {
    countWhere.key = { contains: q, mode: 'insensitive' };
  } else if (category) {
    countWhere.key = { startsWith: `${category}.` };
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
 * Permanently deletes a configuration entry from the database.
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
 * Reads and decrypts a secret value from the database.
 * Unlike `getConfig`, this function enforces that the entry must be encrypted;
 * calling it on a plaintext entry throws rather than returning the raw value.
 *
 * @returns Decrypted secret value.
 * @throws {Error} If the key does not exist, is not encrypted, or decryption fails.
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
 * Reads a numeric AppConfig value, clamped to `[min, max]`. Missing keys and out-of-range or
 * non-numeric values both fall back to `defaultValue` — shared by every "TTL-style" getter below
 * so the fetch/parse/bounds-check boilerplate lives in one place.
 */
async function getBoundedNumericConfig(
  prisma: PrismaClient,
  key: string,
  { defaultValue, min, max }: { defaultValue: number; min: number; max: number }
): Promise<number> {
  const config = await getConfig(prisma, key, false);
  if (!config) return defaultValue;

  const value = parseInt(config, 10);
  if (isNaN(value) || value < min || value > max) return defaultValue;

  return value;
}

/**
 * Reads the tokenVersion cache TTL from AppConfig.
 * Enforces a minimum of 10 s and a maximum of 10 min; invalid values fall back to the default.
 *
 * @returns TTL in milliseconds. Defaults to 60 000 ms (60 s).
 */
export function getTokenVersionCacheTTL(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'security.tokenVersionCacheTTL', {
    defaultValue: 60000, min: 10000, max: 600000,
  });
}

/**
 * Reads the `EditLock` session TTL from AppConfig — currently only consumed by the planning
 * wizard, but the getter (like the underlying lock mechanism) isn't wizard-specific.
 * Enforces the same 5 min – 60 min bounds as `AppConfigRegistry`; invalid values fall back
 * to the default.
 *
 * @returns TTL in milliseconds. Defaults to 900 000 ms (15 min).
 */
export function getEditLockTtlMs(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'editLock.ttlMs', {
    defaultValue: 900000, min: 300000, max: 3600000,
  });
}

/**
 * Reads the password policy from AppConfig.
 * Individual keys are read concurrently; missing keys fall back to secure defaults.
 * The `minLength` is always clamped to a minimum of 8 characters.
 *
 * @returns Password policy with validated constraints.
 */
export async function getPasswordPolicy(prisma: PrismaClient): Promise<{
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
}> {
  const [minLength, requireUppercase, requireLowercase, requireDigit, requireSpecialChar] =
    await Promise.all([
      getTypedConfig(prisma, 'security.password.minLength').catch(() => 12),
      getTypedConfig(prisma, 'security.password.requireUppercase').catch(() => true),
      getTypedConfig(prisma, 'security.password.requireLowercase').catch(() => true),
      getTypedConfig(prisma, 'security.password.requireDigit').catch(() => true),
      getTypedConfig(prisma, 'security.password.requireSpecialChar').catch(() => true),
    ]);

  return {
    minLength: Math.max(minLength, 8), // Min assoluto: 8 caratteri
    requireUppercase,
    requireLowercase,
    requireDigit,
    requireSpecialChar,
  };
}

/**
 * Assembles the full LDAP configuration from multiple AppConfig keys.
 * Encrypted values (e.g. `bindPassword`) are decrypted automatically.
 * Returns a safe default configuration when no LDAP keys exist in the database.
 *
 * @returns Fully populated and decrypted `LdapConfig`.
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
  const strategy =
    (configMap.get('auth.strategy')?.value as LdapConfig['strategy']) ||
    'local-first';

  let roleMapping: Record<string, string>;
  try {
    const parsed = JSON.parse(roleMappingStr);
    roleMapping = RoleMappingSchema.parse(parsed);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'Errore parsing/validazione roleMapping, usando mapping vuoto'
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

/**
 * Reads the LDAP resilience configuration (circuit breaker, retries, timeouts) from AppConfig.
 * Each key is read independently; missing keys fall back to the LdapResilienceSchema defaults.
 *
 * @returns Validated `LdapResilienceConfig` object.
 */
export async function getLdapResilienceConfig(
  prisma: PrismaClient,
): Promise<LdapResilienceConfig> {
  const [timeoutMs, maxRetries, baseDelayMs, breakerFailureThreshold, breakerCooldownMs, halfOpenMaxAttempts] =
    await Promise.all([
      getTypedConfig(prisma, 'auth.ldap.resilience.timeoutMs').catch(() => 3000),
      getTypedConfig(prisma, 'auth.ldap.resilience.maxRetries').catch(() => 2),
      getTypedConfig(prisma, 'auth.ldap.resilience.baseDelayMs').catch(() => 200),
      getTypedConfig(prisma, 'auth.ldap.resilience.breakerFailureThreshold').catch(() => 5),
      getTypedConfig(prisma, 'auth.ldap.resilience.breakerCooldownMs').catch(() => 10000),
      getTypedConfig(prisma, 'auth.ldap.resilience.halfOpenMaxAttempts').catch(() => 1),
    ]);

  return LdapResilienceSchema.parse({
    timeoutMs,
    maxRetries,
    baseDelayMs,
    breakerFailureThreshold,
    breakerCooldownMs,
    halfOpenMaxAttempts,
  });
}
