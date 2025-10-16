/**
 * Schema Zod per configurazione LDAP
 * Centralizzato in @luke/core per riuso tra API e frontend
 */

import { z } from 'zod';

/**
 * Schema per configurazione LDAP (input per saveLdapConfig)
 * Basato su quello esistente in apps/api/src/routers/integrations.ts
 */
export const ldapConfigSchema = z.object({
  enabled: z.boolean(),
  url: z
    .string()
    .min(1, 'URL LDAP è obbligatorio')
    .regex(/^ldaps?:\/\//, 'URL deve iniziare con ldap:// o ldaps://'),
  bindDN: z.string().optional().or(z.literal('')),
  bindPassword: z.string().optional().or(z.literal('')),
  searchBase: z.string().min(1, 'Search Base è obbligatorio'),
  searchFilter: z.string().min(1, 'Search Filter è obbligatorio'),
  groupSearchBase: z.string().optional().or(z.literal('')),
  groupSearchFilter: z.string().optional().or(z.literal('')),
  roleMapping: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine(
      val => {
        if (!val || val.trim() === '') return true; // Vuoto è valido
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Role Mapping deve essere un JSON valido' }
    ),
  strategy: z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
});

/**
 * Schema per risposta getLdapConfig (output con dati sensibili omessi)
 */
export const ldapConfigResponseSchema = z.object({
  enabled: z.boolean(),
  url: z.string(),
  hasBindDN: z.boolean(),
  hasBindPassword: z.boolean(),
  searchBase: z.string(),
  searchFilter: z.string(),
  groupSearchBase: z.string(),
  groupSearchFilter: z.string(),
  roleMapping: z.string(), // JSON string
  strategy: z.enum(['local-first', 'ldap-first', 'local-only', 'ldap-only']),
});

/**
 * Schema per test ricerca LDAP
 */
export const ldapSearchTestSchema = z.object({
  username: z.string().min(1, 'Username è obbligatorio'),
});

/**
 * Schema per risposta test ricerca LDAP
 */
export const ldapSearchTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  results: z.array(
    z.object({
      dn: z.string(),
      attributes: z.record(z.array(z.string())),
    })
  ),
  searchConfig: z.object({
    base: z.string(),
    filter: z.string(),
    username: z.string(),
  }),
});

/**
 * Schema per risposta test connessione LDAP
 */
export const ldapConnectionTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

/**
 * Schema per risposta generica operazioni LDAP
 */
export const ldapOperationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Tipi inferiti dagli schema
export type LdapConfigInput = z.infer<typeof ldapConfigSchema>;
export type LdapConfigResponse = z.infer<typeof ldapConfigResponseSchema>;
export type LdapSearchTestInput = z.infer<typeof ldapSearchTestSchema>;
export type LdapSearchTestResponse = z.infer<
  typeof ldapSearchTestResponseSchema
>;
export type LdapConnectionTestResponse = z.infer<
  typeof ldapConnectionTestResponseSchema
>;
export type LdapOperationResponse = z.infer<typeof ldapOperationResponseSchema>;

/**
 * Strategie di autenticazione LDAP supportate
 */
export const LDAP_STRATEGIES = [
  'local-first',
  'ldap-first',
  'local-only',
  'ldap-only',
] as const;

export type LdapStrategy = (typeof LDAP_STRATEGIES)[number];
