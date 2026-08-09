/**
 * Zod schemas for LDAP configuration — shared between API and frontend.
 * Password fields are never included in response schemas.
 */

import { z } from 'zod';

/**
 * Input schema for saving LDAP configuration.
 * `roleMapping` must be a valid JSON string mapping LDAP group names to Luke role names.
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
 * Response shape for `getLdapConfig`. Sensitive fields (`bindDN`, `bindPassword`) are replaced
 * with boolean presence flags.
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

/** Input schema for testing LDAP user search by username. */
export const ldapSearchTestSchema = z.object({
  username: z.string().min(1, 'Username è obbligatorio'),
});

/** Response shape for an LDAP search test, including matched entries and effective search config. */
export const ldapSearchTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  results: z.array(
    z.object({
      dn: z.string(),
      attributes: z.record(z.string(), z.array(z.string())),
    })
  ),
  searchConfig: z.object({
    base: z.string(),
    filter: z.string(),
    username: z.string(),
  }),
});

/** Response shape for an LDAP connectivity test (bind attempt). */
export const ldapConnectionTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

/** Generic success/failure response for LDAP write operations (save, enable, disable). */
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
 * Supported LDAP authentication strategies. Must match the `auth.strategy` AppConfig value.
 * `local-first` tries local credentials before LDAP; `ldap-only` disables local login entirely.
 */
export const LDAP_STRATEGIES = [
  'local-first',
  'ldap-first',
  'local-only',
  'ldap-only',
] as const;

export type LdapStrategy = (typeof LDAP_STRATEGIES)[number];
