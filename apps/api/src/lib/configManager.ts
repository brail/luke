/**
 * AppConfig manager for Luke API.
 * Handles encryption and decryption of sensitive values stored in the AppConfig
 * table using AES-256-GCM with a master key loaded from ~/.luke/secret.key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { TRPCError } from '@trpc/server';
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
  type BackupScheduleSettings,
  type BackupScopeField,
  CRITICAL_CONFIG_KEYS,
  LdapResilienceSchema,
  type LdapResilienceConfig,
  type LdapStrategy,
  Roles,
  storesEncrypted,
} from '@luke/core';
import { getMasterKey, getRbacConfig, invalidateRbacCache } from '@luke/core/server';
import type { Prisma, PrismaClient } from '@luke/db';

import {
  countRecoveryCapable,
  loadAdminRecoveryOverrides,
} from '../services/sectionAccess.service';

import { toErrorMessage } from './error';
import { acquireLastAdminLock } from './lastAdminGuard';
import { rootLogger } from './logger';

const logger = rootLogger.child({ module: 'config' });

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
  strategy: LdapStrategy;
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
      'Invalid encrypted format. Expected: iv:authTag:ciphertext'
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
 * `effectiveSectionAccess`). A list that leaves no admin able to reach user
 * administration would lock everyone — admins included — out of the only
 * in-app place to undo it. Guarded here, the single chokepoint every write to
 * this key goes through (generic `config.set`/`config.update`, gated only by
 * `config:update` — no `*:*` check upstream).
 *
 * The guard asks that question directly, through the same recovery count the
 * other last-admin guards use, rather than looking for `'settings'` in the
 * list: disabling `settings.users` alone locks administration out too, and so
 * does disabling every `settings.*` child, since a parent is derived from its
 * children (ADR-025). A list that does not make things worse is accepted, so
 * a system with no recovery-capable admin (a fresh install) stays writable.
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

    // Lock before reading, like every other writer of the last-admin invariant.
    await acquireLastAdminLock(tx);
    const { sectionAccessDefaults, disabledSections: current } = await getRbacConfig(tx, {
      bypassCache: true,
    });
    // One read under the lock, both counts from it: the list before and after differ, the
    // administrators do not.
    const admins = await loadAdminRecoveryOverrides(tx);
    const before = countRecoveryCapable(admins, sectionAccessDefaults, current);
    const after = countRecoveryCapable(admins, sectionAccessDefaults, disabled);
    if (before > 0 && after === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          "Questa configurazione toglierebbe a tutti gli amministratori l'accesso alla gestione utenti — nessun modo di annullarla dall'app.",
      });
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
 * @param encrypt - When `true`, the value is encrypted with AES-256-GCM before storage. A key in
 *   `SECRET_CONFIG_KEYS` is encrypted whatever this says.
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
  if (key === 'app.sections.disabled') {
    const row = prepareConfigWrite({ key, value, encrypt });
    await saveSectionsDisabledGuarded(prisma, value, row.value, row.encrypt);
    invalidateRbacCache();
    return;
  }
  await saveConfigs(prisma, [{ key, value, encrypt }]);
}

/**
 * A key `saveConfigs` may write: every registry key but the kill switch, whose guard runs its own
 * transaction under the last-admin lock (`saveSectionsDisabledGuarded`) and which no form writes.
 */
type BatchConfigKey = Exclude<AppConfigKey, 'app.sections.disabled'>;

/** One entry of a `saveConfigs` batch: a value to store, or `null` to remove the key. */
export type ConfigWrite =
  | { key: BatchConfigKey; value: string; encrypt?: boolean }
  | { key: BatchConfigKey; value: null };

/** Validates a value against its registry schema, then encrypts it if `storesEncrypted`: the stored form. */
export function prepareConfigWrite<K extends AppConfigKey>(write: { key: K; value: string; encrypt?: boolean }) {
  const validation = validateConfigValue(write.key, write.value);
  if (!validation.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Valore non valido per '${write.key}': ${validation.message}`,
    });
  }
  const encrypt = storesEncrypted(write.key, write.encrypt);
  return { key: write.key, value: encrypt ? encryptValue(write.value) : write.value, encrypt };
}

/**
 * Saves several keys as one change — a settings form, which must not be left half-written.
 *
 * Every value is validated against its registry schema, and encrypted when asked or when its key is
 * in `SECRET_CONFIG_KEYS`, before anything is written; then all the writes run in one transaction,
 * in order: an upsert for a value, a `deleteMany` for `null` (removing an absent key is not an
 * error). Either every key changes or none does. What it guarantees is one atomic write, not a
 * consistent snapshot for a reader that issues several reads across the commit. The RBAC cache is
 * invalidated only after the commit.
 *
 * @throws {TRPCError} `BAD_REQUEST` when a value fails its registry schema; nothing is written.
 */
export async function saveConfigs(
  prisma: PrismaClient,
  writes: readonly ConfigWrite[]
): Promise<void> {
  // Excluded by the key type too; refused here as well for a caller that reaches it through a cast.
  if (writes.some(write => (write.key as AppConfigKey) === 'app.sections.disabled')) {
    throw new Error('saveConfigs cannot write app.sections.disabled: use saveConfig, which runs its guard');
  }
  const rows = writes.map(write => (write.value === null ? write : prepareConfigWrite(write)));

  await prisma.$transaction(async tx => {
    for (const row of rows) {
      if (row.value === null) {
        await tx.appConfig.deleteMany({ where: { key: row.key } });
      } else {
        await tx.appConfig.upsert({
          where: { key: row.key },
          update: { value: row.value, isEncrypted: row.encrypt, updatedAt: new Date() },
          create: { key: row.key, value: row.value, isEncrypted: row.encrypt },
        });
      }
    }
  });

  if (rows.some(row => RBAC_CACHE_KEYS.test(row.key))) {
    invalidateRbacCache();
  }
}

/**
 * Reads a single configuration value from the database, decrypting a row stored encrypted: no
 * reader ever sees ciphertext. A value that does not decrypt throws — never read as absent.
 *
 * **Security note**: an internal read. What leaves the process goes through a masked read
 * (`getConfigsMasked`, `listConfigsPaged`), or `hasConfig` when only existence matters.
 *
 * @param prisma - Prisma client.
 * @param key - Configuration key to look up.
 * @returns The plaintext value, or `null` if the key does not exist.
 */
export async function getConfig(prisma: PrismaClient, key: string): Promise<string | null> {
  const config = await prisma.appConfig.findUnique({
    where: { key },
  });

  if (!config) {
    return null;
  }

  if (config.isEncrypted) {
    try {
      return decryptValue(config.value);
    } catch (error) {
      // The caller logs the thrown error whole, this one as its cause: the message is enough here.
      logger.error({ key, error: toErrorMessage(error) }, 'Config decryption error');
      throw new ConfigDecryptionError(key, { cause: error });
    }
  }

  return config.value;
}

/**
 * A stored value that cannot be used as stored: it does not decrypt, or the registry refuses it. It
 * names the key, never the value: diagnostics are logged and notified, and a value may be secret.
 * A reader with a documented fallback catches this, never the two cases one by one.
 */
export class UnreadableStoredConfigError extends Error {
  constructor(readonly key: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A stored encrypted value that does not decrypt: a corrupted row, or one written under another key. */
export class ConfigDecryptionError extends UnreadableStoredConfigError {
  constructor(key: string, options?: ErrorOptions) {
    super(key, `Impossibile decifrare configurazione: ${key}`, options);
  }
}

/** Whether `key` is stored, for a check that needs no value — a credential's, above all. */
export async function hasConfig(prisma: PrismaClient, key: AppConfigKey): Promise<boolean> {
  return (await prisma.appConfig.count({ where: { key } })) > 0;
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
    throw new Error(`Configuration '${key}' not found`);
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
 * storage provider because one row is malformed would take the app down for a bad edit. Where the
 * fallback would silently do the wrong thing — the storage provider's `storage.type`, the backup's
 * `backup.schedule.scope` — the reader uses `getStoredConfigOrDefault` instead. `saveConfig`
 * validates, so an invalid row is a legacy or hand-written one.
 */
export async function getConfigOrDefault<K extends AppConfigKeyWithDefault>(
  prisma: PrismaClient,
  key: K,
): Promise<AppConfigValue<K>> {
  const raw = await getConfig(prisma, key);
  return parseConfigOrDefault(
    raw,
    key,
    // The default is declared in the string form AppConfig stores, and a test proves every entry
    // parses; this is the same schema that test uses. Parsed eagerly: with a stored row it is a
    // wasted Zod parse of a short literal, next to the query this read already makes.
    parseConfigValue(key, APP_CONFIG_DEFAULTS[key]),
  );
}

/** A stored AppConfig value the registry refuses, for a reader that must not fall back. */
export class InvalidStoredConfigError extends UnreadableStoredConfigError {
  constructor(key: AppConfigKey, options?: ErrorOptions) {
    super(key, `Invalid AppConfig '${key}'`, options);
  }
}

/**
 * Reads a key that has a declared default like `getConfigOrDefault`, but refuses a stored value the
 * registry rejects instead of falling back, for keys whose default would silently do the wrong thing:
 * a `local` storage type misplaces every file, a `DB` backup scope drops them from every backup.
 * No row → the default; an invalid row → `InvalidStoredConfigError`; a database or decryption error
 * propagates.
 */
export async function getStoredConfigOrDefault<K extends AppConfigKeyWithDefault>(
  prisma: PrismaClient,
  key: K,
): Promise<AppConfigValue<K>> {
  const raw = await getConfig(prisma, key);
  if (raw === null) return parseConfigValue(key, APP_CONFIG_DEFAULTS[key]);
  try {
    return parseConfigValue(key, raw);
  } catch (error) {
    throw new InvalidStoredConfigError(key, { cause: error });
  }
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
        errors.push(`${key}: ${toErrorMessage(err)}`);
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

/** A stored value as the config router hands it out: an encrypted one is never decrypted, only `null`. */
function maskedValue(row: { value: string; isEncrypted: boolean }): string | null {
  return row.isEncrypted ? null : row.value;
}

/**
 * The stored values of `keys`, one entry per requested key in their order, masked like
 * `listConfigsPaged`; `found` says whether the key is stored and `isEncrypted` whether its `null`
 * value is masked, so a page reads it instead of inferring it from `found` and `value`. One read
 * answers existence and encryption together, so no write can land between the two.
 */
export async function getConfigsMasked(
  prisma: PrismaClient,
  keys: string[]
): Promise<{ key: string; value: string | null; found: boolean; isEncrypted: boolean }[]> {
  const rows = await prisma.appConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true, isEncrypted: true },
  });
  const stored = new Map(rows.map(row => [row.key, row]));
  return keys.map(key => {
    const row = stored.get(key);
    return { key, value: row ? maskedValue(row) : null, found: row !== undefined, isEncrypted: row?.isEncrypted ?? false };
  });
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
    valuePreview: maskedValue(item),
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
 * The eight numeric getters below are one line each: `getConfigOrDefault` fetches, the registry
 * schema enforces the bounds, and `APP_CONFIG_DEFAULTS` supplies the fallback for a missing or
 * out-of-range value. They used to share a `getBoundedNumericConfig` helper that took `min`, `max`
 * and `defaultValue` from each call site — one place, but a second declaration: seven of the eight
 * `max` bounds existed *only* there, so `saveConfig` accepted `auditLog.retentionDays: 99999`,
 * stored it, and the reader quietly returned 365. `security.tokenVersionCacheTTL` was worse — the
 * schema allowed `0` while the reader clamped anything under 10s back to the default.
 */

/**
 * Reads the tokenVersion cache TTL from AppConfig.
 * Enforces a minimum of 10 s and a maximum of 10 min; invalid values fall back to the default.
 *
 * @returns TTL in milliseconds. Defaults to 60 000 ms (60 s).
 */
export function getTokenVersionCacheTTL(prisma: PrismaClient): Promise<number> {
  return getConfigOrDefault(prisma, 'security.tokenVersionCacheTTL');
}

/**
 * Whether login and local-access recovery require a verified email (`auth.requireEmailVerification`).
 *
 * A stored value the registry refuses, or one that does not decrypt, reads as `true`, with a
 * warning. The gate then refuses exactly what `true` refuses (an unverified LOCAL login) and never a
 * verified user or an LDAP login, so a bad row can neither switch the gate off nor lock out an
 * administrator who meets it.
 */
export async function getRequireEmailVerification(prisma: PrismaClient): Promise<boolean> {
  try {
    return await getStoredConfigOrDefault(prisma, 'auth.requireEmailVerification');
  } catch (error) {
    if (!(error instanceof UnreadableStoredConfigError)) throw error;
    logger.warn({ key: error.key }, 'Stored value unreadable: email verification is required');
    return true;
  }
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
  return getConfigOrDefault(prisma, 'editLock.ttlMs');
}

/**
 * Reads how many days a backup stays before it's eligible for retention pruning.
 *
 * @returns Retention window in days. Defaults to 30; invalid values fall back to the default.
 */
export function getBackupRetentionDays(prisma: PrismaClient): Promise<number> {
  return getConfigOrDefault(prisma, 'backup.retentionDays');
}

/**
 * Reads how many days a non-critical audit log row stays before it's eligible for retention sweep.
 *
 * @returns Retention window in days. Defaults to 365; invalid values fall back to the default.
 */
export function getAuditLogRetentionDays(prisma: PrismaClient): Promise<number> {
  return getConfigOrDefault(prisma, 'auditLog.retentionDays');
}

/**
 * Reads the retention floor (in days) for audit log rows whose `action` is in
 * `CRITICAL_AUDIT_ACTIONS` — kept far longer than ordinary rows for compliance.
 *
 * @returns Retention window in days. Defaults to 3650 (10 years); invalid values fall back to the default.
 */
export function getAuditLogCriticalRetentionDays(prisma: PrismaClient): Promise<number> {
  return getConfigOrDefault(prisma, 'auditLog.criticalRetentionDays');
}

/**
 * Reads how many days a read notification stays before it's eligible for retention sweep.
 * Unread notifications are never swept, regardless of age.
 *
 * @returns Retention window in days. Defaults to 90; invalid values fall back to the default.
 */
export function getNotificationRetentionDays(prisma: PrismaClient): Promise<number> {
  return getConfigOrDefault(prisma, 'notification.retentionDays');
}

/**
 * Reads how many days a `NotificationDedupKey` row stays before it's eligible for retention
 * sweep. Well above the longest dedup window in use (23h) — purely a safety margin.
 *
 * @returns Retention window in days. Defaults to 30; invalid values fall back to the default.
 */
export function getNotificationDedupRetentionDays(prisma: PrismaClient): Promise<number> {
  return getConfigOrDefault(prisma, 'notification.dedupRetentionDays');
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
      { key, err: error },
      'Invalid AppConfig value, using fallback'
    );
    return fallback;
  }
}

/**
 * The stored backup scope, or `null` when the registry refuses it or it does not decrypt: a
 * scheduled backup must not quietly fall back to `DB` and stop including the files, and the
 * scheduler still reaps and prunes.
 */
async function readBackupScope(prisma: PrismaClient): Promise<BackupScopeField> {
  try {
    return { scope: await getStoredConfigOrDefault(prisma, 'backup.schedule.scope') };
  } catch (error) {
    if (error instanceof UnreadableStoredConfigError) return { scope: null };
    throw error;
  }
}

/**
 * Reads the automatic-backup schedule settings — single source of truth shared by the
 * scheduler tick and the admin settings UI, so both agree on defaults for unset keys.
 */
export async function getBackupScheduleSettings(prisma: PrismaClient): Promise<BackupScheduleSettings> {
  const [enabled, dailyTime, scope, notifyOnFailure, retentionDays, retentionMinCount] =
    await Promise.all([
      getConfigOrDefault(prisma, 'backup.schedule.enabled'),
      getConfigOrDefault(prisma, 'backup.schedule.dailyTime'),
      readBackupScope(prisma),
      getConfigOrDefault(prisma, 'backup.notifyOnFailure'),
      getConfigOrDefault(prisma, 'backup.retentionDays'),
      getConfigOrDefault(prisma, 'backup.retentionMinCount'),
    ]);

  return {
    enabled,
    dailyTime,
    ...scope,
    retentionDays,
    retentionMinCount,
    notifyOnFailure,
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
      { err: error },
      'roleMapping parse/validation error, using an empty mapping'
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
 * Each key is read independently: an absent one reads its `APP_CONFIG_DEFAULTS` entry, an invalid
 * one the same with a warning, and a database failure throws — as `getLdapConfig`, read beside it
 * on the login path, already does.
 *
 * @returns Validated `LdapResilienceConfig` object.
 */
export async function getLdapResilienceConfig(
  prisma: PrismaClient,
): Promise<LdapResilienceConfig> {
  const [timeoutMs, maxRetries, baseDelayMs, breakerFailureThreshold, breakerCooldownMs, halfOpenMaxAttempts] =
    await Promise.all([
      getConfigOrDefault(prisma, 'auth.ldap.resilience.timeoutMs'),
      getConfigOrDefault(prisma, 'auth.ldap.resilience.maxRetries'),
      getConfigOrDefault(prisma, 'auth.ldap.resilience.baseDelayMs'),
      getConfigOrDefault(prisma, 'auth.ldap.resilience.breakerFailureThreshold'),
      getConfigOrDefault(prisma, 'auth.ldap.resilience.breakerCooldownMs'),
      getConfigOrDefault(prisma, 'auth.ldap.resilience.halfOpenMaxAttempts'),
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
