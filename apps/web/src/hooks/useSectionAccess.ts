'use client';

import { useSession } from 'next-auth/react';
import { useMemo } from 'react';

import { effectiveSectionAccess, permissions } from '@luke/core';
import type { Section } from '@luke/core';

import { trpc } from '../lib/trpc';

/**
 * Hook per verificare l'accesso alle sezioni per l'utente corrente
 * Implementa la stessa logica di effectiveSectionAccess con override utente
 */
export function useSectionAccess() {
  const { data: session } = useSession();

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
      // Se non abbiamo accesso alle query admin, usa solo RBAC
      if (!userOverrides && !roleDefaults) {
        return effectiveSectionAccess({
          role: userRole,
          roleToPermissions: rolePermissions,
          sectionAccessDefaults: {},
          userOverride: undefined,
          section,
        });
      }

      // 1) Override utente (se disponibili)
      const override = userOverrides?.find(o => o.section === section);
      if (override?.enabled === false) return false;
      if (override?.enabled === true) return true;

      // 2) Default di ruolo (se disponibili)
      const roleDefault = roleDefaults?.[userRole]?.[section];
      if (roleDefault === 'disabled') return false;
      if (roleDefault === 'enabled') return true;

      // 3) RBAC di ruolo (fallback)
      return effectiveSectionAccess({
        role: userRole,
        roleToPermissions: rolePermissions,
        sectionAccessDefaults: roleDefaults || {},
        userOverride: override ? { enabled: override.enabled } : undefined,
        section,
      });
    };

    return {
      dashboard: checkAccess('dashboard'),
      settings: checkAccess('settings'),
      maintenance: checkAccess('maintenance'),
    };
  }, [session?.user, userOverrides, roleDefaults]);

  return sectionAccess;
}
