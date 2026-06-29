/**
 * Server-side section access guard for Next.js page layouts.
 * Replicates the four-layer `effectiveSectionAccess` logic from the API so that
 * unauthorised users are redirected before any page content is rendered.
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
 * Asserts that the currently authenticated user has access to the given section.
 * Redirects to `/login` if unauthenticated, or to `/app/dashboard` if access is denied.
 * Must be called from a server component or async layout.
 *
 * @param section - The section key to check (e.g. `'settings.ldap'`).
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
