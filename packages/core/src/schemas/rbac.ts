import { z } from 'zod';

import type { Role } from '../rbac';

/**
 * All navigable sections in the system, including sub-sections expressed in dot-notation
 * (e.g. `'settings.ldap'`, `'product.pricing'`). Used as access-control keys throughout the RBAC layer.
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
  'settings.google',
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
  'admin.collection_layout_configuration',
  'admin.calendar_configuration',
  // Vendite e relative sotto-sezioni
  'sales',
  'sales.statistics',
  // Pianificazione stagionale (calendario milestones)
  'planning',
  // Azienda
  'settings.company',
]);
export type Section = z.infer<typeof sectionEnum>;

/**
 * Maps each section key to the `Resource:Action` permission required to access it.
 * Single source of truth shared between API and Web. Do not duplicate this mapping.
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
  'settings.google': 'config:read',
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
  'admin.collection_layout_configuration': 'collection_layout:read',
  'admin.calendar_configuration': 'milestone_template:read',
  sales: 'sales:read',
  'sales.statistics': 'sales:read',
  planning: 'season_calendar:read',
  'settings.company': 'company_profile:read',
} as const;

/**
 * Returns the parent section for a dot-notation sub-section, or `null` if already a top-level section.
 *
 * @example
 * getParentSection('settings.ldap') // → 'settings'
 * getParentSection('dashboard')     // → null
 */
export function getParentSection(section: Section): Section | null {
  const dot = section.indexOf('.');
  if (dot === -1) return null;
  return section.slice(0, dot) as Section;
}

/**
 * Static default section visibility per role.
 * `true` = visible by default; `false` = hidden (requires an admin override to enable).
 *
 * This is the version-controlled source of truth — it does not live in the database.
 * Per-user overrides are layered on top at runtime by `effectiveSectionAccess`.
 * Runtime per-role overrides live in AppConfig (`rbac.sectionAccessDefaults`).
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
      'settings.google': true,
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
      'admin.collection_layout_configuration': true,
      'admin.calendar_configuration': true,
      sales: true,
      'sales.statistics': true,
      planning: true,
      'settings.company': true,
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
      'settings.google': false,
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
      'admin.collection_layout_configuration': false,
      'admin.calendar_configuration': false,
      sales: true,
      'sales.statistics': true,
      planning: true,
      'settings.company': false,
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
      'settings.google': false,
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
      'admin.collection_layout_configuration': false,
      'admin.calendar_configuration': false,
      sales: false,
      'sales.statistics': false,
      planning: true,
      'settings.company': false,
    },
  };

