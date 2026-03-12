/**
 * Server-side utility per controllo accesso alle sezioni
 * Implementa la stessa logica dell'API per enforcement uniforme
 */

import { redirect } from 'next/navigation';

import {
  effectiveSectionAccess,
  hasPermission,
  permissions,
  buildTrpcUrl,
} from '@luke/core';
import type { Section } from '@luke/core';

import { auth } from '../../auth';

const SECTION_TO_PERMISSION: Record<Section, string> = {
  dashboard: 'dashboard:read',
  settings: 'settings:read',
  maintenance: 'maintenance:read',
};

/**
 * Verifica accesso a una sezione e redirige se negato
 * @param section - Sezione da verificare
 */
export async function assertSectionAccess(section: Section) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  // Fetch RBAC config from API — cache: 'no-store' per enforcement immediato
  const rbacConfig = {
    sectionAccessDefaults: {},
    disabledSections: [] as any[],
  };
  let override: { enabled?: boolean } | undefined;

  try {
    const [defaultsRes, disabledRes, overrideRes] = await Promise.all([
      fetch(buildTrpcUrl('rbac.sectionDefaults.get'), {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }),
      fetch(buildTrpcUrl('rbac.disabledSections.get'), {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }),
      fetch(buildTrpcUrl('sectionAccess.getForMe'), {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }),
    ]);

    if (defaultsRes.ok) {
      const data = await defaultsRes.json();
      if (data.result?.data) {
        rbacConfig.sectionAccessDefaults = data.result.data;
      }
    }

    if (disabledRes.ok) {
      const data = await disabledRes.json();
      if (data.result?.data) {
        rbacConfig.disabledSections = data.result.data;
      }
    }

    if (overrideRes.ok) {
      const data = await overrideRes.json();
      const found = data.result?.data?.find(
        (o: any) => o.section === section
      );
      if (found) override = { enabled: found.enabled };
    }
  } catch (err) {
    console.warn('Errore fetch RBAC config:', err);
  }

  const userRole = session.user.role as string;

  // 1) User override esplicito
  if (override?.enabled === false) {
    redirect('/app/dashboard' as any);
  }
  if (override?.enabled === true) {
    return;
  }

  // 2) Nuovo sistema permissions: Resource:Action
  const permission = SECTION_TO_PERMISSION[section];
  if (permission && hasPermission({ role: userRole as any }, permission as any)) {
    return;
  }

  // 3) Fallback sistema legacy effectiveSectionAccess
  const allowed = effectiveSectionAccess({
    role: userRole,
    roleToPermissions:
      permissions[userRole as keyof typeof permissions] || {},
    sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
    userOverride: override,
    section,
    disabledSections: rbacConfig.disabledSections,
  });

  if (!allowed) {
    redirect('/app/dashboard' as any);
  }
}
