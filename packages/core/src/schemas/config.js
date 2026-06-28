"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LdapResilienceSchema = exports.CRITICAL_CONFIG_KEYS = exports.AppConfigRegistry = void 0;
exports.parseConfigValue = parseConfigValue;
const zod_1 = require("zod");
const appConfig_1 = require("./appConfig");
Object.defineProperty(exports, "LdapResilienceSchema", { enumerable: true, get: function () { return appConfig_1.LdapResilienceSchema; } });
/**
 * Registry centrale delle chiavi AppConfig con i relativi schemi Zod.
 *
 * Ogni chiave mappa al suo schema di validazione. I valori in DB sono sempre
 * stringhe; i tipi coerce (z.coerce.*) gestiscono la conversione automatica.
 *
 * Aggiungere nuove chiavi qui per ottenere type safety a compile-time
 * e validazione automatica al boot tramite validateCriticalConfig().
 */
exports.AppConfigRegistry = {
    // ── App ──────────────────────────────────────────────────────────────────
    'app.name': zod_1.z.string().min(1),
    'app.version': zod_1.z.string(),
    'app.environment': zod_1.z.string(),
    'app.locale': zod_1.z.string(),
    'app.defaultTimezone': zod_1.z.string(),
    'app.baseUrl': zod_1.z.string().url(),
    // ── Auth ─────────────────────────────────────────────────────────────────
    'auth.strategy': zod_1.z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
    'auth.requireEmailVerification': zod_1.z.coerce.boolean(),
    'auth.nextAuthSecret': zod_1.z.string().min(32),
    'auth.provisioning.defaultTeamId': zod_1.z.string(),
    // ── SMTP ─────────────────────────────────────────────────────────────────
    'smtp.host': zod_1.z.string().min(1),
    'smtp.port': zod_1.z.coerce.number().int().min(1).max(65535),
    'smtp.secure': zod_1.z.coerce.boolean(),
    'smtp.user': zod_1.z.string(),
    'smtp.pass': zod_1.z.string(),
    'smtp.from': zod_1.z.string().email(),
    // ── Security ─────────────────────────────────────────────────────────────
    'security.password.minLength': zod_1.z.coerce.number().int().min(6).max(128),
    'security.password.requireUppercase': zod_1.z.coerce.boolean(),
    'security.password.requireLowercase': zod_1.z.coerce.boolean(),
    'security.password.requireDigit': zod_1.z.coerce.boolean(),
    'security.password.requireSpecialChar': zod_1.z.coerce.boolean(),
    'security.tokenVersionCacheTTL': zod_1.z.coerce.number().int().min(0),
    'security.session.maxAge': zod_1.z.coerce.number().int().min(60),
    'security.session.updateAge': zod_1.z.coerce.number().int().min(60),
    'security.cors.developmentOrigins': zod_1.z.string(),
    // ── Storage ──────────────────────────────────────────────────────────────
    'storage.type': zod_1.z.enum(['local', 'minio']),
    'storage.local.basePath': zod_1.z.string().min(1),
    'storage.local.maxFileSizeMB': zod_1.z.coerce.number().int().min(1),
    'storage.local.buckets': zod_1.z.string().transform(s => JSON.parse(s)),
    'storage.local.publicBaseUrl': zod_1.z.string().url(),
    'storage.local.enableProxy': zod_1.z.coerce.boolean(),
    // ── Storage — MinIO ───────────────────────────────────────────────────────
    'storage.minio.endpoint': zod_1.z.string().min(1),
    'storage.minio.port': zod_1.z.coerce.number().int().min(1).max(65535),
    'storage.minio.useSSL': zod_1.z.coerce.boolean(),
    'storage.minio.accessKey': zod_1.z.string().min(1),
    'storage.minio.secretKey': zod_1.z.string().min(1),
    'storage.minio.region': zod_1.z.string(),
    'storage.minio.publicBaseUrl': zod_1.z.string().url(),
    'storage.minio.presignedPutTtl': zod_1.z.coerce.number().int().min(60),
    'storage.minio.presignedGetTtl': zod_1.z.coerce.number().int().min(60),
    // ── Rate limiting (JSON object) ───────────────────────────────────────────
    'rateLimit': zod_1.z.string().transform(s => appConfig_1.RateLimitConfigSchema.parse(JSON.parse(s))),
    // ── LDAP ─────────────────────────────────────────────────────────────────
    'auth.ldap.enabled': zod_1.z.coerce.boolean(),
    'auth.ldap.url': zod_1.z.string().url(),
    'auth.ldap.bindDN': zod_1.z.string(),
    'auth.ldap.bindPassword': zod_1.z.string(),
    'auth.ldap.searchBase': zod_1.z.string(),
    'auth.ldap.searchFilter': zod_1.z.string(),
    'auth.ldap.groupSearchBase': zod_1.z.string(),
    'auth.ldap.groupSearchFilter': zod_1.z.string(),
    'auth.ldap.roleMapping': zod_1.z.string().transform(s => JSON.parse(s)),
    // ── LDAP resilience (scalari individuali) ────────────────────────────────
    'auth.ldap.resilience.timeoutMs': zod_1.z.coerce.number().int().min(100),
    'auth.ldap.resilience.maxRetries': zod_1.z.coerce.number().int().min(0),
    'auth.ldap.resilience.baseDelayMs': zod_1.z.coerce.number().int().min(10),
    'auth.ldap.resilience.breakerFailureThreshold': zod_1.z.coerce.number().int().min(1),
    'auth.ldap.resilience.breakerCooldownMs': zod_1.z.coerce.number().int().min(500),
    'auth.ldap.resilience.halfOpenMaxAttempts': zod_1.z.coerce.number().int().min(1),
    // ── Microsoft NAV (SQL Server) ───────────────────────────────────────────
    'integrations.nav.host': zod_1.z.string().min(1),
    'integrations.nav.port': zod_1.z.coerce.number().int().min(1).max(65535),
    'integrations.nav.database': zod_1.z.string().min(1),
    'integrations.nav.user': zod_1.z.string().min(1),
    'integrations.nav.password': zod_1.z.string(),
    'integrations.nav.company': zod_1.z.string().min(1),
    'integrations.nav.readOnly': zod_1.z.coerce.boolean(),
    // ── Google Workspace ──────────────────────────────────────────────────────
    'integrations.google.authMode': zod_1.z.enum(['service_account', 'oauth_user']),
    'integrations.google.domain': zod_1.z.string().min(1),
    'integrations.google.calendarSync.enabled': zod_1.z.coerce.boolean(),
    // Service account mode
    'integrations.google.serviceEmail': zod_1.z.string().email(),
    'integrations.google.serviceKey': zod_1.z.string().min(1),
    'integrations.google.impersonateEmail': zod_1.z.string().email(),
    // OAuth user mode
    'integrations.google.oauth.clientId': zod_1.z.string().min(1),
    'integrations.google.oauth.clientSecret': zod_1.z.string().min(1),
    'integrations.google.oauth.refreshToken': zod_1.z.string().min(1),
    'integrations.google.oauth.userEmail': zod_1.z.string().email(),
    // ── Feedback ──────────────────────────────────────────────────────────────
    'integrations.github.feedbackToken': zod_1.z.string().min(1), // GitHub PAT (encrypted)
    'integrations.github.feedbackRepo': zod_1.z.string().min(1), // format: "owner/repo"
};
/**
 * Funzione pura: valida una stringa grezza contro lo schema registrato per la chiave.
 * Non ha side effect, non dipende da framework — testabile in isolamento.
 *
 * @throws ZodError se il valore non supera la validazione
 */
function parseConfigValue(key, raw) {
    return exports.AppConfigRegistry[key].parse(raw);
}
/**
 * Chiavi critiche che devono essere presenti e valide al boot dell'API.
 * Se una di queste manca o è malformata, l'avvio fallisce in produzione.
 */
exports.CRITICAL_CONFIG_KEYS = [
    'auth.strategy',
];
//# sourceMappingURL=config.js.map