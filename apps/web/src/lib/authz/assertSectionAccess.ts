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
import { debugWarn } from '../../lib/debug';

async function safeFetchJson<T>(
  url: string,
  options: RequestInit,
  label: string
): Promise<T | undefined> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.result?.data as T;
  } catch (err) {
    debugWarn(`Errore fetch ${label}:`, err);
    return undefined;
  }
}

/**
 * Verifica accesso a una sezione e redirige se negato
 * @param section - Sezione da verificare
 */
export async function assertSectionAccess(section: Section) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const options: RequestInit = {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  const [overrides, defaults] = await Promise.all([
    safeFetchJson<Array<{ section: string; enabled: boolean }>>(
      buildTrpcUrl('sectionAccess.getForMe'),
      options,
      'section override'
    ),
    safeFetchJson<{ sectionAccessDefaults: Record<string, Record<string, string>>; disabledSections: string[] }>(
      buildTrpcUrl('sectionAccess.getDefaults'),
      options,
      'section defaults'
    ),
  ]);

  const found = overrides?.find(o => o.section === section);
  const userOverride = found ? { enabled: found.enabled } : undefined;

  const allowed = effectiveSectionAccess({
    role: session.user.role as string,
    sectionAccessDefaults: defaults?.sectionAccessDefaults ?? {},
    userOverride,
    section,
    disabledSections: defaults?.disabledSections ?? [],
  });

  if (!allowed) {
    redirect('/app/dashboard' as any);
  }
}
