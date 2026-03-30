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
  'settings.storage',
  'settings.mail',
  'settings.ldap',
  'settings.nav',
  'settings.nav_sync',
  // Manutenzione e relative sotto-sezioni
  'maintenance',
  'maintenance.config',
  'maintenance.import_export',
  // Prodotto e relative sotto-sezioni
  'product',
  'product.pricing',
  'product.collection_layout',
  // Amministrazione
  'admin',
  'admin.brands',
  'admin.seasons',
  'admin.vendors',
  // Vendite e relative sotto-sezioni
  'sales',
  'sales.statistics',
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
  'settings.storage': 'config:read',
  'settings.mail': 'config:read',
  'settings.ldap': 'config:read',
  'settings.nav': 'config:read',
  'settings.nav_sync': 'config:read',
  maintenance: 'maintenance:read',
  'maintenance.config': 'maintenance:read',
  'maintenance.import_export': 'maintenance:read',
  product: 'pricing:read',
  'product.pricing': 'pricing:read',
  'product.collection_layout': 'collection_layout:read',
  admin: 'maintenance:read',
  'admin.brands': 'brands:read',
  'admin.seasons': 'seasons:read',
  'admin.vendors': 'vendors:read',
  sales: 'sales:read',
  'sales.statistics': 'sales:read',
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
      'settings.storage': true,
      'settings.mail': true,
      'settings.ldap': true,
      'settings.nav': true,
      'settings.nav_sync': true,
      maintenance: true,
      'maintenance.config': true,
      'maintenance.import_export': true,
      product: true,
      'product.pricing': true,
      'product.collection_layout': true,
      admin: true,
      'admin.brands': true,
      'admin.seasons': true,
      'admin.vendors': true,
      sales: true,
      'sales.statistics': true,
    },
    editor: {
      dashboard: true,
      settings: false,
      'settings.users': false,
      'settings.storage': false,
      'settings.mail': false,
      'settings.ldap': false,
      'settings.nav': false,
      'settings.nav_sync': false,
      maintenance: false,
      'maintenance.config': false,
      'maintenance.import_export': false,
      product: true,
      'product.pricing': true,
      'product.collection_layout': true,
      admin: false,
      'admin.brands': false,
      'admin.seasons': false,
      'admin.vendors': false,
      sales: true,
      'sales.statistics': true,
    },
    viewer: {
      dashboard: true,
      settings: false,
      'settings.users': false,
      'settings.storage': false,
      'settings.mail': false,
      'settings.ldap': false,
      'settings.nav': false,
      'settings.nav_sync': false,
      maintenance: false,
      'maintenance.config': false,
      'maintenance.import_export': false,
      product: true,
      'product.pricing': true,
      'product.collection_layout': true,
      admin: false,
      'admin.brands': false,
      'admin.seasons': false,
      'admin.vendors': false,
      sales: false,
      'sales.statistics': false,
    },
  };

