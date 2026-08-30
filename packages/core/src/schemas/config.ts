import { z } from 'zod';

import { driveStorageProviderConfigSchema, smbStorageProviderConfigSchema } from '../storage/config';

import { RateLimitConfigSchema, LdapResilienceSchema, CollectionAlertThresholdsSchema, AppContextDefaultsSchema } from './appConfig';
import { MaintenanceModeStateSchema } from './maintenanceMode';

/**
 * Central registry of all AppConfig keys with their Zod validation schemas.
 *
 * All values stored in the database are raw strings; `z.coerce.*` schemas handle
 * automatic type conversion. Add new keys here to gain compile-time type safety
 * and automatic validation on boot via `validateCriticalConfig()`.
 */
/**
 * A boolean setting, as AppConfig stores it: a string.
 *
 * `booleanConfigSchema` follows JavaScript truthiness, so every non-empty string is `true` — the
 * literal `"false"` included. A setting declared that way can be switched on and never off, and
 * the failure is silent: the value is in the database, the admin sees it, and nothing applies it.
 * `configManager.getBackupScheduleSettings` already sidesteps this with a hand-written string
 * comparison; parsing the two words here means no reader has to know.
 */
const booleanConfigSchema = z.enum(['true', 'false']).transform(v => v === 'true');

/**
 * A setting stored as a JSON string, parsed and then validated by `inner`.
 *
 * The point is the `ctx.addIssue`/`.pipe()` shape rather than the obvious
 * `.transform(s => Inner.parse(JSON.parse(s)))`: a `parse` — or a `JSON.parse` `SyntaxError` —
 * thrown inside a bare `transform` propagates straight through `safeParse` instead of landing in
 * `result.error`. Every schema in this registry is expected to honour "safeParse never throws";
 * nine entries were written the obvious way and did not, so each caller had to know to wrap them.
 * Declaring the shape once here is the same move `booleanConfigSchema` makes above.
 */
const jsonConfigSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Valore non è JSON valido' });
        return z.NEVER;
      }
    })
    .pipe(inner);

export const AppConfigRegistry = {
  // ── App ──────────────────────────────────────────────────────────────────
  'app.name':            z.string().min(1),
  'app.version':         z.string(),
  'app.environment':     z.string(),
  'app.locale':          z.string(),
  'app.defaultTimezone': z.string(),
  'app.baseUrl':         z.string().url(),
  'app.sections.disabled': jsonConfigSchema(z.array(z.string())),
  'app.context.defaults':  jsonConfigSchema(AppContextDefaultsSchema),

  // ── Auth ─────────────────────────────────────────────────────────────────
  'auth.strategy':                       z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
  'auth.requireEmailVerification':       booleanConfigSchema,
  'auth.nextAuthSecret':                 z.string().min(32),

  // ── RBAC ─────────────────────────────────────────────────────────────────
  // `z.custom` accepts whatever parsed, which is what the previous `as` cast did — typing the
  // shape without checking it. Narrowing it to a real schema would start rejecting stored blobs
  // that are accepted today, which is a decision about RBAC defaults, not about JSON parsing.
  'rbac.sectionAccessDefaults': jsonConfigSchema(z.custom<Record<string, Record<string, string>>>()),

  // ── SMTP ─────────────────────────────────────────────────────────────────
  'smtp.host':   z.string().min(1),
  'smtp.port':   z.coerce.number().int().min(1).max(65535),
  'smtp.secure': booleanConfigSchema,
  'smtp.user':   z.string(),
  'smtp.pass':   z.string(),
  'smtp.from':   z.string().email(),

  // ── Security ─────────────────────────────────────────────────────────────
  // 8 is the floor, and this is where it is declared. It used to say 6 while `getPasswordPolicy`
  // clamped to 8 and `upsertConfig` refused anything under 8 by hand — three numbers for one rule,
  // so asking for 4 produced 12 and asking for 7 produced 8.
  'security.password.minLength':           z.coerce.number().int().min(8).max(128),
  'security.password.requireUppercase':    booleanConfigSchema,
  'security.password.requireLowercase':    booleanConfigSchema,
  'security.password.requireDigit':        booleanConfigSchema,
  'security.password.requireSpecialChar':  booleanConfigSchema,
  'security.tokenVersionCacheTTL':         z.coerce.number().int().min(0),
  'security.session.maxAge':               z.coerce.number().int().min(60),
  'security.session.updateAge':            z.coerce.number().int().min(60),
  'security.cors.developmentOrigins':      z.string(),

  // ── Storage ──────────────────────────────────────────────────────────────
  'storage.type':                z.enum(['local', 's3']),
  'storage.local.basePath':      z.string().min(1),
  'storage.local.maxFileSizeMB': z.coerce.number().int().min(1).max(1000),
  'storage.local.publicBaseUrl': z.string().url(),
  'storage.local.enableProxy':   booleanConfigSchema,

  // ── Storage — S3-compatible (MinIO, SeaweedFS, Ceph RGW, ...) ─────────────
  'storage.s3.endpoint':        z.string().min(1),
  'storage.s3.port':            z.coerce.number().int().min(1).max(65535),
  'storage.s3.useSSL':          booleanConfigSchema,
  'storage.s3.accessKey':       z.string().min(1),
  'storage.s3.secretKey':       z.string().min(1),
  'storage.s3.region':          z.string(),
  'storage.s3.publicBaseUrl':   z.string().url(),
  'storage.s3.presignedPutTtl': z.coerce.number().int().min(60),
  'storage.s3.presignedGetTtl': z.coerce.number().int().min(60),

  // ── Storage — asset derivative pipeline (thumb/card/export image variants) ────
  'storage.derivatives.enabled': booleanConfigSchema,

  // ── Storage — legacy providers, written as `storage.${provider}` JSON blobs ───
  // The only keys in the codebase assembled from a variable. They are registered rather than
  // exempted so `saveConfig` can validate them like every other key: the interpolation is over a
  // two-value enum, so both keys are known statically even though neither is spelled out.
  'storage.smb':   jsonConfigSchema(smbStorageProviderConfigSchema),
  'storage.drive': jsonConfigSchema(driveStorageProviderConfigSchema),

  // ── Rate limiting (JSON object) ───────────────────────────────────────────
  'rateLimit': jsonConfigSchema(RateLimitConfigSchema),

  // ── Collection Control — motore alert (JSON object) ──────────────────────
  'collectionControl.alertThresholds': jsonConfigSchema(CollectionAlertThresholdsSchema),

  // ── Edit lock — session-scoped entity lock (currently: planning wizard) ────
  'editLock.ttlMs': z.coerce.number().int().min(300_000).max(3_600_000),

  // ── LDAP ─────────────────────────────────────────────────────────────────
  'auth.ldap.enabled':        booleanConfigSchema,
  'auth.ldap.url':            z.string().url(),
  'auth.ldap.bindDN':         z.string(),
  'auth.ldap.bindPassword':   z.string(),
  'auth.ldap.searchBase':     z.string(),
  'auth.ldap.searchFilter':   z.string(),
  'auth.ldap.groupSearchBase':   z.string(),
  'auth.ldap.groupSearchFilter': z.string(),
  // Same as `rbac.sectionAccessDefaults`: types the shape, does not check it. `configManager`
  // has a stricter `RoleMappingSchema` it applies where it actually needs the guarantee.
  'auth.ldap.roleMapping':    jsonConfigSchema(z.custom<Record<string, string>>()),

  // ── LDAP resilience (scalari individuali) ────────────────────────────────
  'auth.ldap.resilience.timeoutMs':               z.coerce.number().int().min(100),
  'auth.ldap.resilience.maxRetries':              z.coerce.number().int().min(0),
  'auth.ldap.resilience.baseDelayMs':             z.coerce.number().int().min(10),
  'auth.ldap.resilience.breakerFailureThreshold': z.coerce.number().int().min(1),
  'auth.ldap.resilience.breakerCooldownMs':       z.coerce.number().int().min(500),
  'auth.ldap.resilience.halfOpenMaxAttempts':     z.coerce.number().int().min(1),

  // ── Microsoft NAV (SQL Server) ───────────────────────────────────────────
  'integrations.nav.host':                  z.string().min(1),
  'integrations.nav.port':                  z.coerce.number().int().min(1).max(65535),
  'integrations.nav.database':              z.string().min(1),
  'integrations.nav.user':                  z.string().min(1),
  'integrations.nav.password':              z.string(),
  'integrations.nav.company':               z.string().min(1),
  'integrations.nav.readOnly':              booleanConfigSchema,
  'integrations.nav.syncEnabled':           booleanConfigSchema,

  // ── Google Workspace ──────────────────────────────────────────────────────
  'integrations.google.authMode':              z.enum(['service_account', 'oauth_user']),
  'integrations.google.domain':                z.string().min(1),
  'integrations.google.calendarSync.enabled':  booleanConfigSchema,
  // Service account mode
  'integrations.google.serviceEmail':          z.string().email(),
  'integrations.google.serviceKey':            z.string().min(1),
  'integrations.google.impersonateEmail':      z.string().email(),
  // OAuth user mode
  'integrations.google.oauth.clientId':        z.string().min(1),
  'integrations.google.oauth.clientSecret':    z.string().min(1),
  'integrations.google.oauth.refreshToken':    z.string().min(1),
  'integrations.google.oauth.userEmail':       z.string().email(),

  // ── Feedback ──────────────────────────────────────────────────────────────
  'integrations.github.feedbackToken':          z.string().min(1),   // GitHub PAT (encrypted)
  'integrations.github.feedbackRepo':           z.string().min(1),   // format: "owner/repo"
  'integrations.github.feedbackSyncIntervalMs': z.coerce.number().int().min(300_000).max(604_800_000), // 5min–7d, default 24h (seed.ts)

  // ── Backup & Disaster Recovery ────────────────────────────────────────────
  'backup.schedule.enabled':        booleanConfigSchema,
  'backup.schedule.dailyTime':      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), // "HH:mm"
  'backup.schedule.scope':          z.enum(['DB', 'DB_AND_FILES']),
  'backup.retentionDays':           z.coerce.number().int().min(1),
  'backup.retentionMinCount':       z.coerce.number().int().min(0),
  'backup.target.bucket':           z.string().min(1),
  'backup.notifyOnFailure':         booleanConfigSchema,

  // ── Retention sweep (audit log + notifiche) ──────────────────────────────
  'auditLog.retentionDays':             z.coerce.number().int().min(1),
  'auditLog.criticalRetentionDays':     z.coerce.number().int().min(1),
  'notification.retentionDays':         z.coerce.number().int().min(1),
  'notification.dedupRetentionDays':    z.coerce.number().int().min(1),

  // ── Maintenance Mode (schedulable, system-wide) ───────────────────────────
  // Single JSON blob, not one key per field: nothing outside maintenanceMode.ts (apps/api)
  // ever reads an individual sub-field, so one row keeps writes atomic for free instead of
  // needing a $transaction across 9 rows.
  'maintenance.mode.state': jsonConfigSchema(MaintenanceModeStateSchema),
} as const satisfies Record<string, z.ZodTypeAny>;

export type AppConfigKey = keyof typeof AppConfigRegistry;
export type AppConfigValue<K extends AppConfigKey> = z.output<(typeof AppConfigRegistry)[K]>;

/**
 * Validates a raw string value against the registered Zod schema for the given key.
 * Pure function — no side effects, no framework dependencies, fully unit-testable.
 *
 * @param key - Registry key identifying the schema to use
 * @param raw - Raw string value as stored in the database
 * @returns Parsed and typed value
 * @throws {ZodError} When the value fails schema validation
 */
export function parseConfigValue<K extends AppConfigKey>(
  key: K,
  raw: string,
): AppConfigValue<K> {
  return (AppConfigRegistry[key] as z.ZodTypeAny).parse(raw) as AppConfigValue<K>;
}

/**
 * The value a key falls back to when AppConfig has no row for it.
 *
 * Declared once, in the string form AppConfig stores, so the seed writes it and every reader
 * parses it through the same registry schema. It used to be spelled at each call site, and the
 * copies had drifted: `storage.s3.endpoint` defaulted to `seaweedfs` in `prisma/seed.ts` and in
 * the settings router, but to `localhost` in `storage/index.ts` — the provider that actually opens
 * the connection. On an install that had not been seeded, the settings page showed one host and
 * the system talked to another.
 *
 * `satisfies Partial<Record<AppConfigKey, string>>` binds the keys; a test parses every entry
 * through `AppConfigRegistry`, so a default that its own schema would reject fails there rather
 * than at the first read on a fresh install.
 *
 * Two deliberate absences:
 * - `storage.local.basePath` — its default is `join(homedir(), …)`, which is not a constant.
 * - `storage.s3.accessKey` / `secretKey` — a default credential is not a default, it is a dev
 *   seed. `prisma/seed.ts` keeps them; nothing here hands them to a reader.
 */
export const APP_CONFIG_DEFAULTS = {
  'app.name':    'Luke',
  'app.baseUrl': 'http://localhost:3000',

  'smtp.secure': 'false',

  'integrations.google.calendarSync.enabled': 'false',

  'backup.schedule.enabled':  'false',
  'backup.notifyOnFailure':   'true',

  'storage.type':                'local',
  'storage.local.maxFileSizeMB': '50',
  'storage.local.enableProxy':   'true',
  'storage.local.publicBaseUrl': 'http://localhost:3001',

  'storage.s3.endpoint':        'seaweedfs',
  'storage.s3.port':            '8333',
  'storage.s3.useSSL':          'false',
  'storage.s3.region':          'us-east-1',
  'storage.s3.presignedPutTtl': '3600',
  'storage.s3.presignedGetTtl': '3600',

  'storage.derivatives.enabled': 'true',
} as const satisfies Partial<Record<AppConfigKey, string>>;

/** A key that has a declared fallback, so reading it can be total. */
export type AppConfigKeyWithDefault = keyof typeof APP_CONFIG_DEFAULTS;

/**
 * Narrows an arbitrary string to a registered key.
 *
 * The type on `saveConfig` closes typos at the call sites that spell a key out, but the config
 * router receives its key over the wire as a plain `string`; this is where that string earns the
 * type. Registry membership is strictly stronger than the router's prefix allowlist — it does not
 * replace it, because the allowlist additionally decides which registered keys the *generic*
 * endpoint may reach at all (`backup.*` and `rbac.*` are registered but only written by their own
 * routers).
 */
export function isAppConfigKey(key: string): key is AppConfigKey {
  return Object.hasOwn(AppConfigRegistry, key);
}

/**
 * Validates a raw string value against its key's schema. The write path needs the verdict, not the
 * value: `saveConfig` stores the string it was given.
 *
 * No try/catch: every registry entry composes safely under `safeParse`, which is what
 * `jsonConfigSchema` is for. A message rather than the `ZodError` because `@luke/core` has no
 * business knowing what transport the caller will turn it into.
 */
export function validateConfigValue(
  key: AppConfigKey,
  raw: string,
): { success: true } | { success: false; message: string } {
  const result = (AppConfigRegistry[key] as z.ZodTypeAny).safeParse(raw);
  return result.success
    ? { success: true }
    : { success: false, message: result.error.issues.map(i => i.message).join('; ') };
}

/**
 * Config keys that must be present and valid at API boot time.
 * A missing or malformed value for any of these keys causes the server to refuse to start in production.
 */
export const CRITICAL_CONFIG_KEYS: AppConfigKey[] = [
  'auth.strategy',
] satisfies AppConfigKey[];

// Re-export LdapResilienceSchema for use in configManager (avoids double-import)
export { LdapResilienceSchema };
