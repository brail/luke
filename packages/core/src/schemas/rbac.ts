import { z } from 'zod';

/**
 * Enum per le sezioni del sistema
 */
export const sectionEnum = z.enum(['dashboard', 'settings', 'maintenance', 'product']);
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

/**
 * Mapping sezioni → permissions nel sistema Resource:Action
 * Unica source of truth, condivisa tra API e Web
 */
export const SECTION_TO_PERMISSION: Record<Section, string> = {
  dashboard: 'dashboard:read',
  settings: 'settings:read',
  maintenance: 'maintenance:read',
  product: 'pricing:read',
} as const;

