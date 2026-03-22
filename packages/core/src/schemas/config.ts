import { z } from 'zod';
import { RateLimitConfigSchema, LdapResilienceSchema } from './appConfig';

/**
 * Registry centrale delle chiavi AppConfig con i relativi schemi Zod.
 *
 * Ogni chiave mappa al suo schema di validazione. I valori in DB sono sempre
 * stringhe; i tipi coerce (z.coerce.*) gestiscono la conversione automatica.
 *
 * Aggiungere nuove chiavi qui per ottenere type safety a compile-time
 * e validazione automatica al boot tramite validateCriticalConfig().
 */
export const AppConfigRegistry = {
  // ── App ──────────────────────────────────────────────────────────────────
  'app.name':            z.string().min(1),
  'app.version':         z.string(),
  'app.environment':     z.string(),
  'app.locale':          z.string(),
  'app.defaultTimezone': z.string(),
  'app.baseUrl':         z.string().url(),

  // ── Auth ─────────────────────────────────────────────────────────────────
  'auth.strategy':                 z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
  'auth.requireEmailVerification': z.coerce.boolean(),
  'auth.nextAuthSecret':           z.string().min(32),

  // ── SMTP ─────────────────────────────────────────────────────────────────
  'smtp.host':   z.string().min(1),
  'smtp.port':   z.coerce.number().int().min(1).max(65535),
  'smtp.secure': z.coerce.boolean(),
  'smtp.user':   z.string(),
  'smtp.pass':   z.string(),
  'smtp.from':   z.string().email(),

  // ── Security ─────────────────────────────────────────────────────────────
  'security.password.minLength':           z.coerce.number().int().min(6).max(128),
  'security.password.requireUppercase':    z.coerce.boolean(),
  'security.password.requireLowercase':    z.coerce.boolean(),
  'security.password.requireDigit':        z.coerce.boolean(),
  'security.password.requireSpecialChar':  z.coerce.boolean(),
  'security.tokenVersionCacheTTL':         z.coerce.number().int().min(0),
  'security.session.maxAge':               z.coerce.number().int().min(60),
  'security.session.updateAge':            z.coerce.number().int().min(60),
  'security.cors.developmentOrigins':      z.string(),

  // ── Storage ──────────────────────────────────────────────────────────────
  'storage.type':                z.enum(['local']),
  'storage.local.basePath':      z.string().min(1),
  'storage.local.maxFileSizeMB': z.coerce.number().int().min(1),
  'storage.local.buckets':       z.string().transform(s => JSON.parse(s) as string[]),
  'storage.local.publicBaseUrl': z.string().url(),
  'storage.local.enableProxy':   z.coerce.boolean(),

  // ── Rate limiting (JSON object) ───────────────────────────────────────────
  'rateLimit': z.string().transform(s => RateLimitConfigSchema.parse(JSON.parse(s))),

  // ── LDAP ─────────────────────────────────────────────────────────────────
  'auth.ldap.enabled':        z.coerce.boolean(),
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
} as const satisfies Record<string, z.ZodTypeAny>;

export type AppConfigKey = keyof typeof AppConfigRegistry;
export type AppConfigValue<K extends AppConfigKey> = z.output<(typeof AppConfigRegistry)[K]>;

/**
 * Funzione pura: valida una stringa grezza contro lo schema registrato per la chiave.
 * Non ha side effect, non dipende da framework — testabile in isolamento.
 *
 * @throws ZodError se il valore non supera la validazione
 */
export function parseConfigValue<K extends AppConfigKey>(
  key: K,
  raw: string,
): AppConfigValue<K> {
  return (AppConfigRegistry[key] as z.ZodTypeAny).parse(raw) as AppConfigValue<K>;
}

/**
 * Chiavi critiche che devono essere presenti e valide al boot dell'API.
 * Se una di queste manca o è malformata, l'avvio fallisce in produzione.
 */
export const CRITICAL_CONFIG_KEYS: AppConfigKey[] = [
  'auth.strategy',
  'auth.nextAuthSecret',
  'app.baseUrl',
] satisfies AppConfigKey[];

// Re-export LdapResilienceSchema for use in configManager (avoids double-import)
export { LdapResilienceSchema };
