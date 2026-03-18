import { z } from 'zod';

import type { Role } from '../rbac';

/**
 * Enum per le sezioni del sistema (incluse sotto-sezioni con dot-notation)
 */
export const sectionEnum = z.enum([
  'dashboard',
  // Settings e relative sotto-sezioni
  'settings',
  'settings.users',
  'settings.brands',
  'settings.seasons',
  'settings.storage',
  'settings.mail',
  'settings.ldap',
  // Manutenzione e relative sotto-sezioni
  'maintenance',
  'maintenance.config',
  'maintenance.import_export',
  // Prodotto e relative sotto-sezioni
  'product',
  'product.pricing',
  'product.collection_layout',
]);
export type Section = z.infer<typeof sectionEnum>;

/**
 * Mapping sezioni → permissions nel sistema Resource:Action
 * Unica source of truth, condivisa tra API e Web
 */
export const SECTION_TO_PERMISSION: Record<Section, string> = {
  dashboard: 'dashboard:read',
  settings: 'settings:read',
  'settings.users': 'users:read',
  'settings.brands': 'brands:read',
  'settings.seasons': 'seasons:read',
  'settings.storage': 'config:read',
  'settings.mail': 'config:read',
  'settings.ldap': 'config:read',
  maintenance: 'maintenance:read',
  'maintenance.config': 'maintenance:read',
  'maintenance.import_export': 'maintenance:read',
  product: 'pricing:read',
  'product.pricing': 'pricing:read',
  'product.collection_layout': 'collection_layout:read',
} as const;

/**
 * Sezione padre per le sotto-sezioni (dot-notation → parent)
 */
export function getParentSection(section: Section): Section | null {
  const dot = section.indexOf('.');
  if (dot === -1) return null;
  return section.slice(0, dot) as Section;
}

/**
 * Default di accesso alle sezioni per ruolo.
 * true  = visibile per default
 * false = nascosta per default (richiede override admin per abilitare)
 *
 * Questa è la source of truth statica — non va in DB.
 * Gli override per-utente vengono applicati sopra questo livello.
 */
export const SECTION_ACCESS_DEFAULTS: Record<Role, Record<Section, boolean>> =
  {
    admin: {
      dashboard: true,
      settings: true,
      'settings.users': true,
      'settings.brands': true,
      'settings.seasons': true,
      'settings.storage': true,
      'settings.mail': true,
      'settings.ldap': true,
      maintenance: true,
      'maintenance.config': true,
      'maintenance.import_export': true,
      product: true,
      'product.pricing': true,
      'product.collection_layout': true,
    },
    editor: {
      dashboard: true,
      settings: false,
      'settings.users': false,
      'settings.brands': false,
      'settings.seasons': false,
      'settings.storage': false,
      'settings.mail': false,
      'settings.ldap': false,
      maintenance: false,
      'maintenance.config': false,
      'maintenance.import_export': false,
      product: true,
      'product.pricing': true,
      'product.collection_layout': true,
    },
    viewer: {
      dashboard: true,
      settings: false,
      'settings.users': false,
      'settings.brands': false,
      'settings.seasons': false,
      'settings.storage': false,
      'settings.mail': false,
      'settings.ldap': false,
      maintenance: false,
      'maintenance.config': false,
      'maintenance.import_export': false,
      product: true,
      'product.pricing': true,
      'product.collection_layout': true,
    },
  };

