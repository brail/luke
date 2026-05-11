'use client';

import { useMemo } from 'react';

import { useSectionAccess } from './useSectionAccess';

/**
 * Hook per verificare l'accesso ai menu della sidebar
 *
 * Il parent (settings/maintenance) fa da master switch:
 * - se il parent è false, nessun sub-item è visibile
 * - se il parent è true, ogni sub-item è visibile solo se anche la sua
 *   sotto-sezione è abilitata
 * La voce dropdown del parent appare solo se almeno un sub-item è visibile.
 */
export function useMenuAccess() {
  const s = useSectionAccess();

  return useMemo(() => {
    // Settings: ogni sub-item richiede parent + sottosezione
    const settingsItems = {
      users: s.settings && s['settings.users'],
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
      collectionCatalog: s.admin && s['admin.collection_catalog'],
      calendars: s.admin && s['admin.calendars'],
    };
    const showAdmin = Object.values(adminItems).some(Boolean);

    // Prodotto: sub-items
    const productItems = {
      merchandisingPlan: s.product && s['product.merchandising_plan'],
    };

    // Calendario: visibile se l'utente ha accesso ad almeno una sezione planning.*
    const showCalendar =
      s['planning.sales'] ||
      s['planning.product'] ||
      s['planning.sourcing'] ||
      s['planning.merchandising'];

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
