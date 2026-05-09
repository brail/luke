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
  'product.merchandising_plan',
  // Amministrazione
  'admin',
  'admin.brands',
  'admin.seasons',
  'admin.vendors',
  'admin.collection_catalog',
  'admin.calendars',
  // Vendite e relative sotto-sezioni
  'sales',
  'sales.statistics',
  // Pianificazione stagionale (calendario milestones)
  'planning',
  'planning.sales',
  'planning.product',
  'planning.sourcing',
  'planning.merchandising',
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
  'product.merchandising_plan': 'merchandising_plan:read',
  admin: 'maintenance:read',
  'admin.brands': 'brands:read',
  'admin.seasons': 'seasons:read',
  'admin.vendors': 'vendors:read',
  'admin.collection_catalog': 'collection_layout:read',
  'admin.calendars': 'milestone_template:read',
  sales: 'sales:read',
  'sales.statistics': 'sales:read',
  planning: 'season_calendar:read',
  'planning.sales': 'season_calendar:read',
  'planning.product': 'season_calendar:read',
  'planning.sourcing': 'season_calendar:read',
  'planning.merchandising': 'season_calendar:read',
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
      'product.merchandising_plan': true,
      admin: true,
      'admin.brands': true,
      'admin.seasons': true,
      'admin.vendors': true,
      'admin.collection_catalog': true,
      'admin.calendars': true,
      sales: true,
      'sales.statistics': true,
      planning: true,
      'planning.sales': true,
      'planning.product': true,
      'planning.sourcing': true,
      'planning.merchandising': true,
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
      'product.merchandising_plan': true,
      admin: false,
      'admin.brands': false,
      'admin.seasons': false,
      'admin.vendors': false,
      'admin.collection_catalog': false,
      'admin.calendars': false,
      sales: true,
      'sales.statistics': true,
      planning: true,
      'planning.sales': true,
      'planning.product': true,
      'planning.sourcing': true,
      'planning.merchandising': true,
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
      'product.merchandising_plan': true,
      admin: false,
      'admin.brands': false,
      'admin.seasons': false,
      'admin.vendors': false,
      'admin.collection_catalog': false,
      'admin.calendars': false,
      sales: false,
      'sales.statistics': false,
      planning: true,
      'planning.sales': true,
      'planning.product': true,
      'planning.sourcing': true,
      'planning.merchandising': true,
    },
  };

