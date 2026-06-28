"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppContextDefaultsSchema = exports.LdapResilienceSchema = exports.RateLimitConfigSchema = exports.RateLimitPolicySchema = exports.AppConfigSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema Zod per il modello AppConfig
 * Definisce la struttura di una configurazione dell'applicazione
 */
exports.AppConfigSchema = zod_1.z.object({
    /** Chiave identificativa della configurazione */
    key: zod_1.z.string().min(1),
    /** Valore della configurazione (oggetto serializzabile generico) */
    value: zod_1.z.unknown(),
    /** Versione della configurazione per gestire aggiornamenti */
    version: zod_1.z.number().int().positive(),
    /** Data di creazione della configurazione */
    createdAt: zod_1.z.date(),
    /** Data dell'ultimo aggiornamento */
    updatedAt: zod_1.z.date(),
});
/**
 * Schema per una singola policy di rate limiting
 */
exports.RateLimitPolicySchema = zod_1.z.object({
    /** Numero massimo di richieste consentite */
    max: zod_1.z.number().int().positive(),
    /** Finestra temporale (es. '1m', '15m', '2h') */
    timeWindow: zod_1.z.string().min(2),
    /** Tipo di chiave per il rate limiting */
    keyBy: zod_1.z.enum(['ip', 'userId']).default('ip'),
});
/**
 * Schema per la configurazione completa del rate limiting
 */
exports.RateLimitConfigSchema = zod_1.z.object({
    /** Policy per endpoint di login */
    login: exports.RateLimitPolicySchema.optional(),
    /** Policy per cambio password */
    passwordChange: exports.RateLimitPolicySchema.optional(),
    /** Policy per reset password */
    passwordReset: exports.RateLimitPolicySchema.optional(),
    /** Policy per mutazioni di configurazione */
    configMutations: exports.RateLimitPolicySchema.optional(),
    /** Policy per mutazioni di utenti */
    userMutations: exports.RateLimitPolicySchema.optional(),
    /** Policy per mutazioni struttura company (funzioni, team, membri) */
    companyStructureMutations: exports.RateLimitPolicySchema.optional(),
});
/**
 * Schema per la configurazione di resilienza LDAP
 */
exports.LdapResilienceSchema = zod_1.z.object({
    /** Timeout per operazione LDAP in millisecondi */
    timeoutMs: zod_1.z.number().int().positive().default(3000),
    /** Numero massimo di retry per operazioni fallite */
    maxRetries: zod_1.z.number().int().min(0).default(2),
    /** Delay base per exponential backoff in millisecondi */
    baseDelayMs: zod_1.z.number().int().min(10).default(200),
    /** Soglia di failure per aprire il circuit breaker */
    breakerFailureThreshold: zod_1.z.number().int().min(1).default(5),
    /** Cooldown del circuit breaker in millisecondi */
    breakerCooldownMs: zod_1.z.number().int().min(500).default(10000),
    /** Numero massimo di tentativi in stato half-open */
    halfOpenMaxAttempts: zod_1.z.number().int().min(1).default(1),
});
/**
 * Schema per i defaults del context (Brand/Season)
 * Utilizzato per configurare i default organizzativi
 */
exports.AppContextDefaultsSchema = zod_1.z.object({
    context: zod_1.z
        .object({
        brandId: zod_1.z.string().uuid().optional(),
        seasonId: zod_1.z.string().uuid().optional(),
    })
        .optional()
        .default({}),
});
//# sourceMappingURL=appConfig.js.map