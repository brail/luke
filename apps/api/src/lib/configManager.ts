/**
 * AppConfig manager for Luke API.
 * Handles encryption and decryption of sensitive values stored in the AppConfig
 * table using AES-256-GCM with a master key loaded from ~/.luke/secret.key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { TRPCError } from '@trpc/server';
import pino from 'pino';
import { z } from 'zod';

import {
  DEFAULT_PASSWORD_POLICY,
  type AppConfigKey,
  type AppConfigValue,
  type PasswordPolicy,
  parseConfigValue,
  validateConfigValue,
  APP_CONFIG_DEFAULTS,
  type AppConfigKeyWithDefault,
  CRITICAL_CONFIG_KEYS,
  LdapResilienceSchema,
  type LdapResilienceConfig,
  Roles,
} from '@luke/core';
import { getMasterKey, invalidateRbacCache } from '@luke/core/server';

import { acquireLastAdminLock } from './lastAdminGuard';

import type { BackupScope, Prisma, PrismaClient } from '@prisma/client';

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

// Exported for reuse by other AES-256-GCM modules (e.g. apps/api/src/lib/backup/crypto.ts)
// that must stay on the same master-key crypto parameters.
export const ALGORITHM = 'aes-256-gcm';
export const IV_LENGTH = 16; // 128 bits
export const AUTH_TAG_LENGTH = 16; // 128 bits — explicit for the semgrep gcm-no-tag-length rule

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

  // Format: iv:authTag:ciphertext (all in hex)
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
 * Keys read by `getRbacConfig`'s cache — any write here must invalidate it,
 * or the RBAC-aware last-admin guards (`lastAdminGuard.ts`,
 * `sectionAccess.ts`) can evaluate against a stale kill-switch/defaults value
 * for up to the cache TTL.
 */
const RBAC_CACHE_KEYS = /^(rbac\.|app\.sections\.disabled$)/;

/**
 * `app.sections.disabled` is the RBAC kill switch: it beats every other
 * access layer, including the admin `*:*` fallback (see
 * `effectiveSectionAccess`). Disabling `'settings'` while an admin exists
 * would lock everyone — admins included — out of the only in-app place to
 * undo it. Guarded here, the single chokepoint every write to this key goes
 * through (generic `config.set`/`config.update`, gated only by the
 * editor-shared `config:update` permission — no admin check upstream).
 */
async function saveSectionsDisabledGuarded(
  prisma: PrismaClient,
  rawValue: string,
  finalValue: string,
  encrypt: boolean
): Promise<void> {
  await prisma.$transaction(async tx => {
    // Parsed here rather than threaded in from `saveConfig`'s validation: there `key` is the open
    // `AppConfigKey`, so the parsed value is the union of every config type and narrowing it to
    // `string[]` would need a cast. A second parse of a ten-element array is the cheaper price.
    const disabled = parseConfigValue('app.sections.disabled', rawValue);

    if (disabled.includes('settings')) {
      await acquireLastAdminLock(tx);
      const adminCount = await tx.user.count({ where: { role: 'admin', isActive: true } });
      if (adminCount > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "Questa configurazione disabiliterebbe Settings per tutti, admin inclusi — nessun modo di annullarla dall'app.",
        });
      }
    }

    await tx.appConfig.upsert({
      where: { key: 'app.sections.disabled' },
      update: { value: finalValue, isEncrypted: encrypt, updatedAt: new Date() },
      create: { key: 'app.sections.disabled', value: finalValue, isEncrypted: encrypt },
    });
  });
}

/**
 * Upserts a configuration entry in the database.
 *
 * The key is an `AppConfigKey`, and the value is parsed by that key's registry schema before it is
 * written: reads had a typed variant (`getTypedConfig`) and writes had none, so the registry
 * described what the application expected to find rather than what it was allowed to store. A
 * caller outside the registry now fails `tsc`, and a value the schema rejects fails here instead
 * of at the first read in production.
 *
 * Validation runs on the plaintext, before `encryptValue`: no registry schema describes a
 * ciphertext, so validating after would test the hex blob against a rule written for the secret.
 *
 * @param prisma - Prisma client.
 * @param key - Configuration key declared in `AppConfigRegistry`.
 * @param value - Value to store, as the string form the registry schema parses.
 * @param encrypt - When `true`, the value is encrypted with AES-256-GCM before storage.
 * @throws {TRPCError} `BAD_REQUEST` when the value fails its registry schema.
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
  key: AppConfigKey,
  value: string,
  encrypt: boolean = false
): Promise<void> {
  const validation = validateConfigValue(key, value);
  if (!validation.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Valore non valido per '${key}': ${validation.message}`,
    });
  }

  const finalValue = encrypt ? encryptValue(value) : value;

  if (key === 'app.sections.disabled') {
    await saveSectionsDisabledGuarded(prisma, value, finalValue, encrypt);
  } else {
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

  if (RBAC_CACHE_KEYS.test(key)) {
    invalidateRbacCache();
  }
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
      throw new Error(`Impossibile decifrare configurazione: ${key}`, { cause: error });
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
 * Reads a key that has a declared default, always returning a usable parsed value.
 *
 * This is what most readers actually wanted. `getConfig` hands back a raw string or `null`, so
 * every call site re-implemented the same two steps — a fallback and a coercion — and the copies
 * drifted apart: `storage.local.enableProxy` was read three different ways, and the `s3.endpoint`
 * fallback disagreed between the provider and the settings page. Here the fallback comes from
 * `APP_CONFIG_DEFAULTS` and the parse from the registry, so neither is a call site's business.
 *
 * A stored value that no longer validates falls back too, with a warning: refusing to serve a
 * storage provider because one row is malformed would take the app down for a bad edit.
 */
export async function getConfigOrDefault<K extends AppConfigKeyWithDefault>(
  prisma: PrismaClient,
  key: K,
): Promise<AppConfigValue<K>> {
  const raw = await getConfig(prisma, key, false);
  return parseConfigOrDefault(
    raw,
    key,
    // The default is declared in the string form AppConfig stores, and a test proves every entry
    // parses; this is the same schema that test uses.
    parseConfigValue(key, APP_CONFIG_DEFAULTS[key]),
  );
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

  // Build the where clause for filters
  const where: Prisma.AppConfigWhereInput = {};

  // Handle key filters
  if (q && category) {
    // If we have both search and category, combine the filters
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

  // Compute skip for pagination
  const skip = (page - 1) * pageSize;

  const countWhere: Prisma.AppConfigWhereInput = {};

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

  // Run the items and total queries in parallel
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

  // Process the results
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
 * Permanently deletes a configuration entry from the database. A no-op when the key is absent.
 *
 * `key` stays a `string` where `saveConfig` takes an `AppConfigKey`: a delete cannot persist a bad
 * value, and requiring registry membership here would leave a row whose key was later dropped from
 * the registry with no way to remove it from the app.
 */
export async function deleteConfig(
  prisma: PrismaClient,
  key: string
): Promise<void> {
  // `deleteMany`, not `delete`: clearing a key that is already absent is the intended outcome of
  // every caller here, and `delete` turns that into a P2025 the caller would have to swallow.
  await prisma.appConfig.deleteMany({
    where: { key },
  });

  if (RBAC_CACHE_KEYS.test(key)) {
    invalidateRbacCache();
  }
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
    throw new Error(`Impossibile decifrare segreto: ${key}`, { cause: error });
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
 * Reads how many days a backup stays before it's eligible for retention pruning.
 *
 * @returns Retention window in days. Defaults to 30; invalid values fall back to the default.
 */
export function getBackupRetentionDays(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'backup.retentionDays', {
    defaultValue: 30, min: 1, max: 3650,
  });
}

/**
 * Reads the minimum number of completed backups the retention sweep must always keep,
 * even if they're past their retention window.
 *
 * @returns Minimum backup count to retain. Defaults to 3; invalid values fall back to the default.
 */
export function getBackupRetentionMinCount(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'backup.retentionMinCount', {
    defaultValue: 3, min: 0, max: 1000,
  });
}

/**
 * Reads how many days a non-critical audit log row stays before it's eligible for retention sweep.
 *
 * @returns Retention window in days. Defaults to 365; invalid values fall back to the default.
 */
export function getAuditLogRetentionDays(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'auditLog.retentionDays', {
    defaultValue: 365, min: 1, max: 3650,
  });
}

/**
 * Reads the retention floor (in days) for audit log rows whose `action` is in
 * `CRITICAL_AUDIT_ACTIONS` — kept far longer than ordinary rows for compliance.
 *
 * @returns Retention window in days. Defaults to 3650 (10 years); invalid values fall back to the default.
 */
export function getAuditLogCriticalRetentionDays(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'auditLog.criticalRetentionDays', {
    defaultValue: 3650, min: 1, max: 36500,
  });
}

/**
 * Reads how many days a read notification stays before it's eligible for retention sweep.
 * Unread notifications are never swept, regardless of age.
 *
 * @returns Retention window in days. Defaults to 90; invalid values fall back to the default.
 */
export function getNotificationRetentionDays(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'notification.retentionDays', {
    defaultValue: 90, min: 1, max: 3650,
  });
}

/**
 * Reads how many days a `NotificationDedupKey` row stays before it's eligible for retention
 * sweep. Well above the longest dedup window in use (23h) — purely a safety margin.
 *
 * @returns Retention window in days. Defaults to 30; invalid values fall back to the default.
 */
export function getNotificationDedupRetentionDays(prisma: PrismaClient): Promise<number> {
  return getBoundedNumericConfig(prisma, 'notification.dedupRetentionDays', {
    defaultValue: 30, min: 1, max: 3650,
  });
}

/** Automatic-backup schedule + retention settings, resolved from AppConfig with the scheduler's own defaults. */
export interface BackupScheduleSettings {
  enabled: boolean;
  dailyTime: string;
  scope: BackupScope;
  retentionDays: number;
  retentionMinCount: number;
  notifyOnFailure: boolean;
}

/**
 * Parses a raw config value through its `AppConfigRegistry` Zod schema, falling back to
 * `fallback` if the key is unset or the stored value no longer validates.
 */
function parseConfigOrDefault<K extends AppConfigKey>(
  raw: string | null,
  key: K,
  fallback: AppConfigValue<K>
): AppConfigValue<K> {
  if (raw === null) return fallback;
  try {
    return parseConfigValue(key, raw);
  } catch (error) {
    logger.warn(
      { key, error: error instanceof Error ? error.message : 'Unknown error' },
      'Valore AppConfig non valido, uso fallback'
    );
    return fallback;
  }
}

/**
 * Reads the automatic-backup schedule settings — single source of truth shared by the
 * scheduler tick and the admin settings UI, so both agree on defaults for unset keys.
 */
export async function getBackupScheduleSettings(prisma: PrismaClient): Promise<BackupScheduleSettings> {
  const [enabledRaw, dailyTimeRaw, scopeRaw, notifyRaw, retentionDays, retentionMinCount] = await Promise.all([
    getConfig(prisma, 'backup.schedule.enabled', false),
    getConfig(prisma, 'backup.schedule.dailyTime', false),
    getConfig(prisma, 'backup.schedule.scope', false),
    getConfig(prisma, 'backup.notifyOnFailure', false),
    getBackupRetentionDays(prisma),
    getBackupRetentionMinCount(prisma),
  ]);

  return {
    // All six go through the registry schema. The two booleans used to be compared by hand
    // against the literal strings, working around `z.coerce.boolean()` treating every non-empty
    // string — `"false"` included — as true; `booleanConfigSchema` parses the two words, so the
    // workaround outlived the footgun it was written for.
    enabled: parseConfigOrDefault(enabledRaw, 'backup.schedule.enabled', false),
    dailyTime: parseConfigOrDefault(dailyTimeRaw, 'backup.schedule.dailyTime', '03:00'),
    scope: parseConfigOrDefault(scopeRaw, 'backup.schedule.scope', 'DB'),
    retentionDays,
    retentionMinCount,
    notifyOnFailure: parseConfigOrDefault(notifyRaw, 'backup.notifyOnFailure', true),
  };
}

/**
 * Reads the password policy from AppConfig.
 * Individual keys are read concurrently; a missing or unparseable key falls back to its secure
 * default, which includes anything below the registry's minimum length.
 *
 * @returns Password policy with validated constraints.
 */
export async function getPasswordPolicy(prisma: PrismaClient): Promise<PasswordPolicy> {
  const [minLength, requireUppercase, requireLowercase, requireDigit, requireSpecialChar] =
    await Promise.all([
      getTypedConfig(prisma, 'security.password.minLength').catch(() => DEFAULT_PASSWORD_POLICY.minLength),
      getTypedConfig(prisma, 'security.password.requireUppercase').catch(() => DEFAULT_PASSWORD_POLICY.requireUppercase),
      getTypedConfig(prisma, 'security.password.requireLowercase').catch(() => DEFAULT_PASSWORD_POLICY.requireLowercase),
      getTypedConfig(prisma, 'security.password.requireDigit').catch(() => DEFAULT_PASSWORD_POLICY.requireDigit),
      getTypedConfig(prisma, 'security.password.requireSpecialChar').catch(() => DEFAULT_PASSWORD_POLICY.requireSpecialChar),
    ]);

  return {
    // No clamp: the floor is `AppConfigRegistry`'s `.min(8)`, so a stored value below it fails to
    // parse and the `.catch()` above already returned the secure default. Clamping as well meant
    // two floors that disagreed — 7 became 8, while 4 became 12.
    minLength,
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

  // Build a map for quick access
  const configMap = new Map(configs.map(c => [c.key, c]));

  // If there's no LDAP configuration, return the default configuration
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

  // Helper to retrieve a value with fallback
  const getConfigValue = (key: string, defaultValue: string = ''): string => {
    const config = configMap.get(key);
    if (!config) return defaultValue;
    return config.isEncrypted ? decryptValue(config.value) : config.value;
  };

  // Retrieve and decrypt values, falling back for missing keys
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
