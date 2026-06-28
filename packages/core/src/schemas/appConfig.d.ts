import { z } from 'zod';
/**
 * Schema Zod per il modello AppConfig
 * Definisce la struttura di una configurazione dell'applicazione
 */
export declare const AppConfigSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodUnknown;
    version: z.ZodNumber;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, z.core.$strip>;
/**
 * Tipo TypeScript inferito dallo schema AppConfig
 */
export type AppConfig = z.infer<typeof AppConfigSchema>;
/**
 * Schema per una singola policy di rate limiting
 */
export declare const RateLimitPolicySchema: z.ZodObject<{
    max: z.ZodNumber;
    timeWindow: z.ZodString;
    keyBy: z.ZodDefault<z.ZodEnum<{
        ip: "ip";
        userId: "userId";
    }>>;
}, z.core.$strip>;
/**
 * Schema per la configurazione completa del rate limiting
 */
export declare const RateLimitConfigSchema: z.ZodObject<{
    login: z.ZodOptional<z.ZodObject<{
        max: z.ZodNumber;
        timeWindow: z.ZodString;
        keyBy: z.ZodDefault<z.ZodEnum<{
            ip: "ip";
            userId: "userId";
        }>>;
    }, z.core.$strip>>;
    passwordChange: z.ZodOptional<z.ZodObject<{
        max: z.ZodNumber;
        timeWindow: z.ZodString;
        keyBy: z.ZodDefault<z.ZodEnum<{
            ip: "ip";
            userId: "userId";
        }>>;
    }, z.core.$strip>>;
    passwordReset: z.ZodOptional<z.ZodObject<{
        max: z.ZodNumber;
        timeWindow: z.ZodString;
        keyBy: z.ZodDefault<z.ZodEnum<{
            ip: "ip";
            userId: "userId";
        }>>;
    }, z.core.$strip>>;
    configMutations: z.ZodOptional<z.ZodObject<{
        max: z.ZodNumber;
        timeWindow: z.ZodString;
        keyBy: z.ZodDefault<z.ZodEnum<{
            ip: "ip";
            userId: "userId";
        }>>;
    }, z.core.$strip>>;
    userMutations: z.ZodOptional<z.ZodObject<{
        max: z.ZodNumber;
        timeWindow: z.ZodString;
        keyBy: z.ZodDefault<z.ZodEnum<{
            ip: "ip";
            userId: "userId";
        }>>;
    }, z.core.$strip>>;
    companyStructureMutations: z.ZodOptional<z.ZodObject<{
        max: z.ZodNumber;
        timeWindow: z.ZodString;
        keyBy: z.ZodDefault<z.ZodEnum<{
            ip: "ip";
            userId: "userId";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Schema per la configurazione di resilienza LDAP
 */
export declare const LdapResilienceSchema: z.ZodObject<{
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    maxRetries: z.ZodDefault<z.ZodNumber>;
    baseDelayMs: z.ZodDefault<z.ZodNumber>;
    breakerFailureThreshold: z.ZodDefault<z.ZodNumber>;
    breakerCooldownMs: z.ZodDefault<z.ZodNumber>;
    halfOpenMaxAttempts: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
/**
 * Tipi TypeScript per rate limiting
 */
export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
/**
 * Tipo TypeScript per configurazione resilienza LDAP
 */
export type LdapResilienceConfig = z.infer<typeof LdapResilienceSchema>;
/**
 * Schema per i defaults del context (Brand/Season)
 * Utilizzato per configurare i default organizzativi
 */
export declare const AppContextDefaultsSchema: z.ZodObject<{
    context: z.ZodDefault<z.ZodOptional<z.ZodObject<{
        brandId: z.ZodOptional<z.ZodString>;
        seasonId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/**
 * Tipo TypeScript per defaults del context
 */
export type AppContextDefaults = z.infer<typeof AppContextDefaultsSchema>;
//# sourceMappingURL=appConfig.d.ts.map