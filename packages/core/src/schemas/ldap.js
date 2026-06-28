"use strict";
/**
 * Schema Zod per configurazione LDAP
 * Centralizzato in @luke/core per riuso tra API e frontend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LDAP_STRATEGIES = exports.ldapOperationResponseSchema = exports.ldapConnectionTestResponseSchema = exports.ldapSearchTestResponseSchema = exports.ldapSearchTestSchema = exports.ldapConfigResponseSchema = exports.ldapConfigSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema per configurazione LDAP (input per saveLdapConfig)
 * Basato su quello esistente in apps/api/src/routers/integrations.ts
 */
exports.ldapConfigSchema = zod_1.z.object({
    enabled: zod_1.z.boolean(),
    url: zod_1.z
        .string()
        .min(1, 'URL LDAP è obbligatorio')
        .regex(/^ldaps?:\/\//, 'URL deve iniziare con ldap:// o ldaps://'),
    bindDN: zod_1.z.string().optional().or(zod_1.z.literal('')),
    bindPassword: zod_1.z.string().optional().or(zod_1.z.literal('')),
    searchBase: zod_1.z.string().min(1, 'Search Base è obbligatorio'),
    searchFilter: zod_1.z.string().min(1, 'Search Filter è obbligatorio'),
    groupSearchBase: zod_1.z.string().optional().or(zod_1.z.literal('')),
    groupSearchFilter: zod_1.z.string().optional().or(zod_1.z.literal('')),
    roleMapping: zod_1.z
        .string()
        .optional()
        .or(zod_1.z.literal(''))
        .refine(val => {
        if (!val || val.trim() === '')
            return true; // Vuoto è valido
        try {
            JSON.parse(val);
            return true;
        }
        catch {
            return false;
        }
    }, { message: 'Role Mapping deve essere un JSON valido' }),
    strategy: zod_1.z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
});
/**
 * Schema per risposta getLdapConfig (output con dati sensibili omessi)
 */
exports.ldapConfigResponseSchema = zod_1.z.object({
    enabled: zod_1.z.boolean(),
    url: zod_1.z.string(),
    hasBindDN: zod_1.z.boolean(),
    hasBindPassword: zod_1.z.boolean(),
    searchBase: zod_1.z.string(),
    searchFilter: zod_1.z.string(),
    groupSearchBase: zod_1.z.string(),
    groupSearchFilter: zod_1.z.string(),
    roleMapping: zod_1.z.string(), // JSON string
    strategy: zod_1.z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
});
/**
 * Schema per test ricerca LDAP
 */
exports.ldapSearchTestSchema = zod_1.z.object({
    username: zod_1.z.string().min(1, 'Username è obbligatorio'),
});
/**
 * Schema per risposta test ricerca LDAP
 */
exports.ldapSearchTestResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string(),
    results: zod_1.z.array(zod_1.z.object({
        dn: zod_1.z.string(),
        attributes: zod_1.z.record(zod_1.z.string(), zod_1.z.array(zod_1.z.string())),
    })),
    searchConfig: zod_1.z.object({
        base: zod_1.z.string(),
        filter: zod_1.z.string(),
        username: zod_1.z.string(),
    }),
});
/**
 * Schema per risposta test connessione LDAP
 */
exports.ldapConnectionTestResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string(),
});
/**
 * Schema per risposta generica operazioni LDAP
 */
exports.ldapOperationResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string(),
});
/**
 * Strategie di autenticazione LDAP supportate
 */
exports.LDAP_STRATEGIES = [
    'local-first',
    'ldap-first',
    'local-only',
    'ldap-only',
];
//# sourceMappingURL=ldap.js.map