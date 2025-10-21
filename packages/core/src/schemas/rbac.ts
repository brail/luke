import { z } from 'zod';

/**
 * Enum per le sezioni del sistema
 */
export const sectionEnum = z.enum(['dashboard', 'settings', 'maintenance']);
export type Section = z.infer<typeof sectionEnum>;

/**
 * Enum per i default di accesso alle sezioni
 */
export const sectionDefaultEnum = z.enum(['auto', 'enabled', 'disabled']);
export type SectionDefault = z.infer<typeof sectionDefaultEnum>;

/**
 * Schema per la configurazione RBAC completa
 */
export const rbacConfigSchema = z.object({
  /** Mapping ruoli -> permessi (esistente) */
  roleToPermissions: z.record(z.string(), z.array(z.string())),

  /** Default di accesso alle sezioni per ruolo */
  sectionAccessDefaults: z
    .record(
      z.string(), // role name
      z.record(sectionEnum, sectionDefaultEnum) // per ogni role, mapping sezione->default
    )
    .default({}),
});

/**
 * Tipo TypeScript per la configurazione RBAC
 */
export type RbacConfig = z.infer<typeof rbacConfigSchema>;
