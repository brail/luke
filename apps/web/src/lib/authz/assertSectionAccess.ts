/**
 * Server-side utility per controllo accesso alle sezioni
 * Implementa la stessa logica dell'API per enforcement uniforme
 */

import { redirect } from 'next/navigation';

import {
  effectiveSectionAccess,
  buildTrpcUrl,
} from '@luke/core';
import type { Section } from '@luke/core';

import { auth } from '../../auth';

/**
 * Verifica accesso a una sezione e redirige se negato
 * @param section - Sezione da verificare
 */
export async function assertSectionAccess(section: Section) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  // Fetch user-specific section overrides from API
  const rbacConfig = {
    sectionAccessDefaults: {},
    disabledSections: [] as string[],
  };
  let override: { enabled?: boolean } | undefined;

  try {
    const overrideRes = await fetch(buildTrpcUrl('sectionAccess.getForMe'), {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (overrideRes.ok) {
      const data = await overrideRes.json();
      const found = data.result?.data?.find((o: any) => o.section === section);
      if (found) override = { enabled: found.enabled };
    }
  } catch (err) {
    console.warn('Errore fetch section access:', err);
  }

  const userRole = session.user.role as string;

  const allowed = effectiveSectionAccess({
    role: userRole,
    sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
    userOverride: override,
    section,
    disabledSections: rbacConfig.disabledSections,
  });

  if (!allowed) {
    redirect('/app/dashboard' as any);
  }
}
