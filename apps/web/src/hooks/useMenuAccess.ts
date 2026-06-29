'use client';

import { useMemo } from 'react';

import { useSectionAccess } from './useSectionAccess';

/**
 * Returns the sidebar visibility map for the current user, derived from
 * `useSectionAccess`. Parent sections (settings, maintenance, admin) act as
 * master switches: a sub-item is visible only when both the parent section and
 * its own sub-section are enabled. A parent dropdown is shown only when at
 * least one of its sub-items is visible.
 *
 * @returns Object with boolean flags for each sidebar entry and grouped
 *   sub-item maps (`settingsItems`, `maintenanceItems`, `adminItems`, `productItems`,
 *   `salesItems`) plus `showGeneralSection` and `showSystemSection` macro-flags.
 */
export function useMenuAccess() {
  const s = useSectionAccess();

  return useMemo(() => {
    // Settings: ogni sub-item richiede parent + sottosezione
    const settingsItems = {
      users: s.settings && s['settings.users'],
      company: s.settings && s['settings.company'],
      storage: s.settings && s['settings.storage'],
      mail: s.settings && s['settings.mail'],
      ldap: s.settings && s['settings.ldap'],
      nav: s.settings && s['settings.nav'],
      nav_sync: s.settings && s['settings.nav_sync'],
      google: s.settings && s['settings.google'],
    };
    const showSettings = Object.values(settingsItems).some(Boolean);

    // Maintenance: ogni sub-item richiede parent + sottosezione
    const maintenanceItems = {
      config: s.maintenance && s['maintenance.config'],
      import_export: s.maintenance && s['maintenance.import_export'],
    };
    const showMaintenance = Object.values(maintenanceItems).some(Boolean);

    // Admin: ogni sub-item richiede parent + sottosezione
    const adminItems = {
      brands: s.admin && s['admin.brands'],
      seasons: s.admin && s['admin.seasons'],
      vendors: s.admin && s['admin.vendors'],
      collectionLayoutConfiguration: s.admin && s['admin.collection_layout_configuration'],
      calendarConfiguration: s.admin && s['admin.calendar_configuration'],
    };
    const showAdmin = Object.values(adminItems).some(Boolean);

    // Prodotto: sub-items
    const productItems = {
      merchandisingPlan: s.product && s['product.merchandising_plan'],
    };

    const showCalendar = s['planning'];

    return {
      // Singole voci
      dashboard: s.dashboard,

      // Settings con sub-items
      settings: showSettings,
      settingsItems,

      // Maintenance con sub-items
      maintenance: showMaintenance,
      maintenanceItems,

      // Admin con sub-items
      admin: showAdmin,
      adminItems,

      // Prodotto
      product: s.product,
      productItems,

      // Vendite con sub-items
      sales: s.sales,
      salesItems: {
        statistics: s.sales && s['sales.statistics'],
      },

      // Calendario (trasversale — accesso OR su sezioni planning.*)
      calendar: showCalendar,

      // Macrosezioni
      showGeneralSection: s.dashboard,
      showSystemSection: showSettings || showMaintenance || showAdmin,
    };
  }, [s]);
}
