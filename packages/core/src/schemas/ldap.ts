/**
 * Zod schemas for LDAP configuration — shared between API and frontend.
 * Password fields are never included in response schemas.
 */

import { z } from 'zod';

import { Roles } from '../rbac.js';

/**
 * Supported LDAP authentication strategies — the one list the `auth.strategy` AppConfig schema,
 * the LDAP config schemas below and the API's config reader all derive from.
 * `local-first` tries local credentials before LDAP; `ldap-only` refuses local login except to an
 * administrator, as the break-glass path.
 */
export const LDAP_STRATEGIES = [
  'local-first',
  'ldap-first',
  'local-only',
  'ldap-only',
] as const;

export type LdapStrategy = (typeof LDAP_STRATEGIES)[number];

/**
 * LDAP group DN → Luke role, as `auth.ldap.roleMapping` stores it (as JSON) and the sign-in reads it.
 * A role outside `Roles` is refused on save (#112); one stored by an earlier release makes the reader
 * drop the whole mapping, never a part of it, which could silently change who is an administrator.
 */
export const RoleMappingSchema = z.record(z.string(), z.enum(Roles));
export type RoleMapping = z.infer<typeof RoleMappingSchema>;

/**
 * Input schema for saving LDAP configuration.
 * `roleMapping` is the JSON text of a `RoleMappingSchema`; a mistyped role names its group.
 * `ldap-only` with LDAP disabled is refused: only the local administrators could log in. The issue
 * sits on `strategy` so the settings form shows it under that field. A convenience for this form
 * and `saveLdapConfig`; Maintenance → Config writes the same keys without it.
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
    .superRefine((val, ctx) => {
      if (!val || val.trim() === '') return; // Empty is valid
      let parsed: unknown;
      try {
        parsed = JSON.parse(val);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Role Mapping deve essere un JSON valido' });
        return;
      }
      const result = RoleMappingSchema.safeParse(parsed);
      if (result.success) return;
      const group = result.error.issues[0]?.path[0];
      ctx.addIssue({
        code: 'custom',
        message: typeof group === 'string'
          ? `Ruolo non valido per il gruppo "${group}": usa ${Roles.join(', ')}`
          : 'Role Mapping deve associare ogni gruppo LDAP a un ruolo: { "gruppo": "ruolo" }',
      });
    }),
  strategy: z.enum(LDAP_STRATEGIES),
}).superRefine((config, ctx) => {
  if (config.strategy === 'ldap-only' && !config.enabled) {
    ctx.addIssue({
      code: 'custom',
      path: ['strategy'],
      message: 'La strategia ldap-only richiede LDAP abilitato',
    });
  }
});

/** Input schema for testing LDAP user search by username. */
export const ldapSearchTestSchema = z.object({
  // Bounds the filter string sent to the directory; nothing else does.
  username: z
    .string()
    .min(1, 'Username è obbligatorio')
    .max(256, 'Username troppo lungo (max 256 caratteri)'),
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

// Types inferred from the schemas
export type LdapConfigInput = z.infer<typeof ldapConfigSchema>;
export type LdapSearchTestInput = z.infer<typeof ldapSearchTestSchema>;
export type LdapSearchTestResponse = z.infer<
  typeof ldapSearchTestResponseSchema
>;
export type LdapConnectionTestResponse = z.infer<
  typeof ldapConnectionTestResponseSchema
>;
export type LdapOperationResponse = z.infer<typeof ldapOperationResponseSchema>;

/** The LDAP settings stored under `auth.ldap.`, encrypted by the settings form. */
export const LDAP_STORED_FIELDS = [
  'url',
  'bindDN',
  'bindPassword',
  'searchBase',
  'searchFilter',
  'groupSearchBase',
  'groupSearchFilter',
  'roleMapping',
] as const;
export type LdapStoredField = (typeof LDAP_STORED_FIELDS)[number];

const LDAP_CONNECTION_TEST_FIELDS = ['url', 'bindDN', 'bindPassword'] as const satisfies readonly LdapStoredField[];

/**
 * The fields each settings test reads: only an unreadable one of these stops that test, so an
 * unreadable optional value (the role mapping, the group search) does not block either (#193).
 */
export const LDAP_TEST_FIELDS = {
  connection: LDAP_CONNECTION_TEST_FIELDS,
  search: [...LDAP_CONNECTION_TEST_FIELDS, 'searchBase', 'searchFilter'],
} as const satisfies Record<string, readonly LdapStoredField[]>;
