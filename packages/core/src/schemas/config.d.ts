import { z } from 'zod';
import { LdapResilienceSchema } from './appConfig';
/**
 * Registry centrale delle chiavi AppConfig con i relativi schemi Zod.
 *
 * Ogni chiave mappa al suo schema di validazione. I valori in DB sono sempre
 * stringhe; i tipi coerce (z.coerce.*) gestiscono la conversione automatica.
 *
 * Aggiungere nuove chiavi qui per ottenere type safety a compile-time
 * e validazione automatica al boot tramite validateCriticalConfig().
 */
export declare const AppConfigRegistry: {
    readonly 'app.name': z.ZodString;
    readonly 'app.version': z.ZodString;
    readonly 'app.environment': z.ZodString;
    readonly 'app.locale': z.ZodString;
    readonly 'app.defaultTimezone': z.ZodString;
    readonly 'app.baseUrl': z.ZodString;
    readonly 'auth.strategy': z.ZodEnum<{
        "local-first": "local-first";
        "ldap-first": "ldap-first";
        "local-only": "local-only";
        "ldap-only": "ldap-only";
    }>;
    readonly 'auth.requireEmailVerification': z.ZodCoercedBoolean<unknown>;
    readonly 'auth.nextAuthSecret': z.ZodString;
    readonly 'auth.provisioning.defaultTeamId': z.ZodString;
    readonly 'smtp.host': z.ZodString;
    readonly 'smtp.port': z.ZodCoercedNumber<unknown>;
    readonly 'smtp.secure': z.ZodCoercedBoolean<unknown>;
    readonly 'smtp.user': z.ZodString;
    readonly 'smtp.pass': z.ZodString;
    readonly 'smtp.from': z.ZodString;
    readonly 'security.password.minLength': z.ZodCoercedNumber<unknown>;
    readonly 'security.password.requireUppercase': z.ZodCoercedBoolean<unknown>;
    readonly 'security.password.requireLowercase': z.ZodCoercedBoolean<unknown>;
    readonly 'security.password.requireDigit': z.ZodCoercedBoolean<unknown>;
    readonly 'security.password.requireSpecialChar': z.ZodCoercedBoolean<unknown>;
    readonly 'security.tokenVersionCacheTTL': z.ZodCoercedNumber<unknown>;
    readonly 'security.session.maxAge': z.ZodCoercedNumber<unknown>;
    readonly 'security.session.updateAge': z.ZodCoercedNumber<unknown>;
    readonly 'security.cors.developmentOrigins': z.ZodString;
    readonly 'storage.type': z.ZodEnum<{
        local: "local";
        minio: "minio";
    }>;
    readonly 'storage.local.basePath': z.ZodString;
    readonly 'storage.local.maxFileSizeMB': z.ZodCoercedNumber<unknown>;
    readonly 'storage.local.buckets': z.ZodPipe<z.ZodString, z.ZodTransform<string[], string>>;
    readonly 'storage.local.publicBaseUrl': z.ZodString;
    readonly 'storage.local.enableProxy': z.ZodCoercedBoolean<unknown>;
    readonly 'storage.minio.endpoint': z.ZodString;
    readonly 'storage.minio.port': z.ZodCoercedNumber<unknown>;
    readonly 'storage.minio.useSSL': z.ZodCoercedBoolean<unknown>;
    readonly 'storage.minio.accessKey': z.ZodString;
    readonly 'storage.minio.secretKey': z.ZodString;
    readonly 'storage.minio.region': z.ZodString;
    readonly 'storage.minio.publicBaseUrl': z.ZodString;
    readonly 'storage.minio.presignedPutTtl': z.ZodCoercedNumber<unknown>;
    readonly 'storage.minio.presignedGetTtl': z.ZodCoercedNumber<unknown>;
    readonly rateLimit: z.ZodPipe<z.ZodString, z.ZodTransform<{
        login?: {
            max: number;
            timeWindow: string;
            keyBy: "ip" | "userId";
        } | undefined;
        passwordChange?: {
            max: number;
            timeWindow: string;
            keyBy: "ip" | "userId";
        } | undefined;
        passwordReset?: {
            max: number;
            timeWindow: string;
            keyBy: "ip" | "userId";
        } | undefined;
        configMutations?: {
            max: number;
            timeWindow: string;
            keyBy: "ip" | "userId";
        } | undefined;
        userMutations?: {
            max: number;
            timeWindow: string;
            keyBy: "ip" | "userId";
        } | undefined;
        companyStructureMutations?: {
            max: number;
            timeWindow: string;
            keyBy: "ip" | "userId";
        } | undefined;
    }, string>>;
    readonly 'auth.ldap.enabled': z.ZodCoercedBoolean<unknown>;
    readonly 'auth.ldap.url': z.ZodString;
    readonly 'auth.ldap.bindDN': z.ZodString;
    readonly 'auth.ldap.bindPassword': z.ZodString;
    readonly 'auth.ldap.searchBase': z.ZodString;
    readonly 'auth.ldap.searchFilter': z.ZodString;
    readonly 'auth.ldap.groupSearchBase': z.ZodString;
    readonly 'auth.ldap.groupSearchFilter': z.ZodString;
    readonly 'auth.ldap.roleMapping': z.ZodPipe<z.ZodString, z.ZodTransform<Record<string, string>, string>>;
    readonly 'auth.ldap.resilience.timeoutMs': z.ZodCoercedNumber<unknown>;
    readonly 'auth.ldap.resilience.maxRetries': z.ZodCoercedNumber<unknown>;
    readonly 'auth.ldap.resilience.baseDelayMs': z.ZodCoercedNumber<unknown>;
    readonly 'auth.ldap.resilience.breakerFailureThreshold': z.ZodCoercedNumber<unknown>;
    readonly 'auth.ldap.resilience.breakerCooldownMs': z.ZodCoercedNumber<unknown>;
    readonly 'auth.ldap.resilience.halfOpenMaxAttempts': z.ZodCoercedNumber<unknown>;
    readonly 'integrations.nav.host': z.ZodString;
    readonly 'integrations.nav.port': z.ZodCoercedNumber<unknown>;
    readonly 'integrations.nav.database': z.ZodString;
    readonly 'integrations.nav.user': z.ZodString;
    readonly 'integrations.nav.password': z.ZodString;
    readonly 'integrations.nav.company': z.ZodString;
    readonly 'integrations.nav.readOnly': z.ZodCoercedBoolean<unknown>;
    readonly 'integrations.google.authMode': z.ZodEnum<{
        service_account: "service_account";
        oauth_user: "oauth_user";
    }>;
    readonly 'integrations.google.domain': z.ZodString;
    readonly 'integrations.google.calendarSync.enabled': z.ZodCoercedBoolean<unknown>;
    readonly 'integrations.google.serviceEmail': z.ZodString;
    readonly 'integrations.google.serviceKey': z.ZodString;
    readonly 'integrations.google.impersonateEmail': z.ZodString;
    readonly 'integrations.google.oauth.clientId': z.ZodString;
    readonly 'integrations.google.oauth.clientSecret': z.ZodString;
    readonly 'integrations.google.oauth.refreshToken': z.ZodString;
    readonly 'integrations.google.oauth.userEmail': z.ZodString;
    readonly 'integrations.github.feedbackToken': z.ZodString;
    readonly 'integrations.github.feedbackRepo': z.ZodString;
};
export type AppConfigKey = keyof typeof AppConfigRegistry;
export type AppConfigValue<K extends AppConfigKey> = z.output<(typeof AppConfigRegistry)[K]>;
/**
 * Funzione pura: valida una stringa grezza contro lo schema registrato per la chiave.
 * Non ha side effect, non dipende da framework — testabile in isolamento.
 *
 * @throws ZodError se il valore non supera la validazione
 */
export declare function parseConfigValue<K extends AppConfigKey>(key: K, raw: string): AppConfigValue<K>;
/**
 * Chiavi critiche che devono essere presenti e valide al boot dell'API.
 * Se una di queste manca o è malformata, l'avvio fallisce in produzione.
 */
export declare const CRITICAL_CONFIG_KEYS: AppConfigKey[];
export { LdapResilienceSchema };
//# sourceMappingURL=config.d.ts.map