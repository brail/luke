'use client';

import { useSession } from 'next-auth/react';
import { useMemo } from 'react';

import { effectiveSectionAccess, permissions, hasPermission } from '@luke/core';
import type { Section } from '@luke/core';

import { trpc } from '../lib/trpc';

import { useAccess } from './useAccess';

/**
 * Mapping sezioni -> permissions per nuovo sistema
 * Mantiene consistency con API middleware
 */
const SECTION_TO_PERMISSION: Record<Section, string> = {
  dashboard: 'dashboard:read',
  settings: 'settings:read',
  maintenance: 'maintenance:read',
};

/**
 * Hook per verificare l'accesso alle sezioni per l'utente corrente
 * Integra nuovo sistema Resource:Action con UserSectionAccess legacy
 *
 * Precedenza: user override > permission check > role default
 */
export function useSectionAccess() {
  const { data: session } = useSession();
  const { can } = useAccess();

  // Query per override dell'utente corrente (solo se admin)
  const { data: userOverrides } = trpc.sectionAccess.getForMe.useQuery(
    undefined,
    {
      enabled: !!session?.user && session.user.role === 'admin',
      retry: false, // Non riprovare se 403
    }
  );

  // Query per default di ruolo (solo se admin)
  const { data: roleDefaults } = trpc.rbac.sectionDefaults.get.useQuery(
    undefined,
    {
      enabled: !!session?.user && session.user.role === 'admin',
      retry: false, // Non riprovare se 403
    }
  );

  const sectionAccess = useMemo(() => {
    if (!session?.user) {
      return {
        dashboard: false,
        settings: false,
        maintenance: false,
      };
    }

    const userRole = session.user.role as string;
    const rolePermissions =
      permissions[userRole as keyof typeof permissions] || {};

    const checkAccess = (section: Section): boolean => {
      // 1) User override: se l'utente ha un override specifico, rispettalo
      const override = userOverrides?.find(o => o.section === section);
      if (override?.enabled === false) return false;
      if (override?.enabled === true) return true;

      // 2) Nuovo sistema permissions: verifica permission specifica
      const permission = SECTION_TO_PERMISSION[section];
      if (
        permission &&
        hasPermission({ role: userRole as any }, permission as any)
      ) {
        return true;
      }

      // 3) Fallback: sistema legacy effectiveSectionAccess
      return effectiveSectionAccess({
        role: userRole,
        roleToPermissions: rolePermissions,
        sectionAccessDefaults: roleDefaults || {},
        userOverride: override ? { enabled: override.enabled } : undefined,
        section,
        disabledSections: [], // TODO: fetch da API se necessario
      });
    };

    return {
      dashboard: checkAccess('dashboard'),
      settings: checkAccess('settings'),
      maintenance: checkAccess('maintenance'),
    };
  }, [session?.user, userOverrides, roleDefaults, can]);

  return sectionAccess;
}
