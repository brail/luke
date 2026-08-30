import { z } from 'zod';

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

export const AppConfigRegistry = {
  // ── App ──────────────────────────────────────────────────────────────────
  'app.name':            z.string().min(1),
  'app.version':         z.string(),
  'app.environment':     z.string(),
  'app.locale':          z.string(),
  'app.defaultTimezone': z.string(),
  'app.baseUrl':         z.string().url(),
  'app.sections.disabled': z.string().transform(s => z.array(z.string()).parse(JSON.parse(s))),
  'app.context.defaults':  z.string().transform(s => AppContextDefaultsSchema.parse(JSON.parse(s))),

  // ── Auth ─────────────────────────────────────────────────────────────────
  'auth.strategy':                       z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
  'auth.requireEmailVerification':       booleanConfigSchema,
  'auth.nextAuthSecret':                 z.string().min(32),

  // ── RBAC ─────────────────────────────────────────────────────────────────
  'rbac.sectionAccessDefaults': z.string().transform(s => JSON.parse(s) as Record<string, Record<string, string>>),

  // ── SMTP ─────────────────────────────────────────────────────────────────
  'smtp.host':   z.string().min(1),
  'smtp.port':   z.coerce.number().int().min(1).max(65535),
  'smtp.secure': booleanConfigSchema,
  'smtp.user':   z.string(),
  'smtp.pass':   z.string(),
  'smtp.from':   z.string().email(),

  // ── Security ─────────────────────────────────────────────────────────────
  'security.password.minLength':           z.coerce.number().int().min(6).max(128),
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

  // ── Rate limiting (JSON object) ───────────────────────────────────────────
  'rateLimit': z.string().transform(s => RateLimitConfigSchema.parse(JSON.parse(s))),

  // ── Collection Control — motore alert (JSON object) ──────────────────────
  'collectionControl.alertThresholds': z.string().transform(s => CollectionAlertThresholdsSchema.parse(JSON.parse(s))),

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
  'auth.ldap.roleMapping':    z.string().transform(s => JSON.parse(s) as Record<string, string>),

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
  'maintenance.mode.state': z.string().transform(s => MaintenanceModeStateSchema.parse(JSON.parse(s))),
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
 * Config keys that must be present and valid at API boot time.
 * A missing or malformed value for any of these keys causes the server to refuse to start in production.
 */
export const CRITICAL_CONFIG_KEYS: AppConfigKey[] = [
  'auth.strategy',
] satisfies AppConfigKey[];

// Re-export LdapResilienceSchema for use in configManager (avoids double-import)
export { LdapResilienceSchema };
