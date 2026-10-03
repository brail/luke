'use client';

import { useMemo } from 'react';

import { useSectionAccess } from './useSectionAccess';

/**
 * Returns the sidebar visibility map for the current user, derived from
 * `useSectionAccess`. A sub-item reads its own sub-section alone: the server
 * resolves a parent as on iff one of its children is, and a parent in the kill
 * switch turns its children off (ADR-027), so a child that is on implies its
 * parent. A parent dropdown is shown when at least one of its sub-items is
 * visible.
 *
 * @returns Object with boolean flags for each sidebar entry and grouped
 *   sub-item maps (`settingsItems`, `maintenanceItems`, `adminItems`, `productItems`,
 *   `salesItems`) plus `showGeneralSection` and `showSystemSection` macro-flags.
 */
export function useMenuAccess() {
  const s = useSectionAccess();

  return useMemo(() => {
    // Settings
    const settingsItems = {
      users: s['settings.users'],
      company: s['settings.company'],
      storage: s['settings.storage'],
      mail: s['settings.mail'],
      ldap: s['settings.ldap'],
      nav: s['settings.nav'],
      nav_sync: s['settings.nav_sync'],
      google: s['settings.google'],
      collectionControl: s['settings.collection_control'],
    };
    const showSettings = Object.values(settingsItems).some(Boolean);

    // Maintenance
    const maintenanceItems = {
      config: s['maintenance.config'],
      import_export: s['maintenance.import_export'],
      backup: s['maintenance.backup'],
      mode: s['maintenance.mode'],
      auditLog: s['maintenance.audit_log'],
    };
    const showMaintenance = Object.values(maintenanceItems).some(Boolean);

    // Admin
    const adminItems = {
      brands: s['admin.brands'],
      seasons: s['admin.seasons'],
      vendors: s['admin.vendors'],
      collectionLayoutConfiguration: s['admin.collection_layout_configuration'],
      calendarConfiguration: s['admin.calendar_configuration'],
      phaseCatalog: s['admin.phase_catalog'],
    };
    const showAdmin = Object.values(adminItems).some(Boolean);

    // Product
    const productItems = {
      pricing: s['product.pricing'],
      collectionLayout: s['product.collection_layout'],
      merchandisingPlan: s['product.merchandising_plan'],
      control: s['product.control'],
    };

    const showCalendar = s['planning'];

    return {
      // Standalone entries
      dashboard: s.dashboard,

      // Settings with sub-items
      settings: showSettings,
      settingsItems,

      // Maintenance with sub-items
      maintenance: showMaintenance,
      maintenanceItems,

      // Admin with sub-items
      admin: showAdmin,
      adminItems,

      // Product
      product: s.product,
      productItems,

      // Sales with sub-items
      sales: s.sales,
      salesItems: {
        statistics: s['sales.statistics'],
      },

      // Calendar: the `planning` section
      calendar: showCalendar,

      // Menu groups
      showGeneralSection: s.dashboard,
      showSystemSection: showSettings || showMaintenance || showAdmin,
    };
  }, [s]);
}
