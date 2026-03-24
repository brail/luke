'use client';

import { useSession } from 'next-auth/react';
import { useMemo } from 'react';

import {
  SECTION_ACCESS_DEFAULTS,
  getParentSection,
} from '@luke/core';
import type { Role, Section } from '@luke/core';

import { trpc } from '../lib/trpc';

/**
 * Hook per verificare l'accesso alle sezioni per l'utente corrente
 *
 * Logica a 2 livelli (in ordine di precedenza):
 * 1. Override per-utente (da UserSectionAccess in DB)
 * 2. Default di ruolo (da SECTION_ACCESS_DEFAULTS in @luke/core)
 *
 * Per le sotto-sezioni (es. product.pricing), se non c'è un override specifico
 * si controlla anche l'override della sezione padre, poi il default di ruolo.
 */
export function useSectionAccess() {
  const { data: session } = useSession();

  const { data: userOverrides } = trpc.sectionAccess.getForMe.useQuery(
    undefined,
    {
      enabled: !!session?.user,
      retry: false,
      trpc: { context: { skipBatch: true } },
    }
  );

  const sectionAccess = useMemo(() => {
    const role = session?.user?.role as Role | undefined;

    const checkAccess = (section: Section): boolean => {
      // 1. Override specifico per questa sezione
      const override = userOverrides?.find(o => o.section === section);
      if (override?.enabled === false) return false;
      if (override?.enabled === true) return true;

      // 2. Override sulla sezione padre (per le sotto-sezioni)
      const parent = getParentSection(section);
      if (parent) {
        const parentOverride = userOverrides?.find(o => o.section === parent);
        if (parentOverride?.enabled === false) return false;
        // parent enabled → fallthrough to role default for this sub-section
      }

      // 3. Default di ruolo
      if (!role) return false;
      const roleDefaults = SECTION_ACCESS_DEFAULTS[role];
      return roleDefaults?.[section] ?? false;
    };

    return {
      dashboard: checkAccess('dashboard'),
      settings: checkAccess('settings'),
      'settings.users': checkAccess('settings.users'),
      'settings.storage': checkAccess('settings.storage'),
      'settings.mail': checkAccess('settings.mail'),
      'settings.ldap': checkAccess('settings.ldap'),
      'settings.nav': checkAccess('settings.nav'),
      maintenance: checkAccess('maintenance'),
      'maintenance.config': checkAccess('maintenance.config'),
      'maintenance.import_export': checkAccess('maintenance.import_export'),
      product: checkAccess('product'),
      'product.pricing': checkAccess('product.pricing'),
      'product.collection_layout': checkAccess('product.collection_layout'),
      admin: checkAccess('admin'),
      'admin.brands': checkAccess('admin.brands'),
      'admin.seasons': checkAccess('admin.seasons'),
      'admin.nav_sync': checkAccess('admin.nav_sync'),
      'admin.vendors': checkAccess('admin.vendors'),
    };
  }, [session?.user, userOverrides]);

  return sectionAccess;
}
