/**
 * Schema Zod per configurazione LDAP
 * Centralizzato in @luke/core per riuso tra API e frontend
 */
import { z } from 'zod';
/**
 * Schema per configurazione LDAP (input per saveLdapConfig)
 * Basato su quello esistente in apps/api/src/routers/integrations.ts
 */
export declare const ldapConfigSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    url: z.ZodString;
    bindDN: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    bindPassword: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    searchBase: z.ZodString;
    searchFilter: z.ZodString;
    groupSearchBase: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    groupSearchFilter: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    roleMapping: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    strategy: z.ZodEnum<{
        "local-first": "local-first";
        "ldap-first": "ldap-first";
        "local-only": "local-only";
        "ldap-only": "ldap-only";
    }>;
}, z.core.$strip>;
/**
 * Schema per risposta getLdapConfig (output con dati sensibili omessi)
 */
export declare const ldapConfigResponseSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    url: z.ZodString;
    hasBindDN: z.ZodBoolean;
    hasBindPassword: z.ZodBoolean;
    searchBase: z.ZodString;
    searchFilter: z.ZodString;
    groupSearchBase: z.ZodString;
    groupSearchFilter: z.ZodString;
    roleMapping: z.ZodString;
    strategy: z.ZodEnum<{
        "local-first": "local-first";
        "ldap-first": "ldap-first";
        "local-only": "local-only";
        "ldap-only": "ldap-only";
    }>;
}, z.core.$strip>;
/**
 * Schema per test ricerca LDAP
 */
export declare const ldapSearchTestSchema: z.ZodObject<{
    username: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per risposta test ricerca LDAP
 */
export declare const ldapSearchTestResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    message: z.ZodString;
    results: z.ZodArray<z.ZodObject<{
        dn: z.ZodString;
        attributes: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    searchConfig: z.ZodObject<{
        base: z.ZodString;
        filter: z.ZodString;
        username: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * Schema per risposta test connessione LDAP
 */
export declare const ldapConnectionTestResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    message: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per risposta generica operazioni LDAP
 */
export declare const ldapOperationResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    message: z.ZodString;
}, z.core.$strip>;
export type LdapConfigInput = z.infer<typeof ldapConfigSchema>;
export type LdapConfigResponse = z.infer<typeof ldapConfigResponseSchema>;
export type LdapSearchTestInput = z.infer<typeof ldapSearchTestSchema>;
export type LdapSearchTestResponse = z.infer<typeof ldapSearchTestResponseSchema>;
export type LdapConnectionTestResponse = z.infer<typeof ldapConnectionTestResponseSchema>;
export type LdapOperationResponse = z.infer<typeof ldapOperationResponseSchema>;
/**
 * Strategie di autenticazione LDAP supportate
 */
export declare const LDAP_STRATEGIES: readonly ["local-first", "ldap-first", "local-only", "ldap-only"];
export type LdapStrategy = (typeof LDAP_STRATEGIES)[number];
//# sourceMappingURL=ldap.d.ts.map