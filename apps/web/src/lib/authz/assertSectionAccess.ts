/**
 * Server-side section access guard for Next.js page layouts.
 * Delegates all evaluation to the API's `sectionAccess.getEffectiveForMe` endpoint
 * so logic lives in one place and all four access layers are applied correctly.
 */

import { redirect } from 'next/navigation';
import { cache } from 'react';

import type { Section } from '@luke/core';

import { auth } from '../../auth';
import { debugWarn } from '../../lib/debug';
import { createAuthedTrpcClient } from '../../lib/trpc-auth';

import type { Route } from 'next';

// cache() deduplicates auth() across multiple assertSectionAccess calls in one render.
const getSession = cache(auth);

// cache() deduplicates the tRPC call across nested layouts in the same server render.
const fetchEffectiveAccess = cache(async (accessToken: string): Promise<Record<string, boolean> | undefined> => {
  try {
    return await createAuthedTrpcClient(accessToken).sectionAccess.getEffectiveForMe.query();
  } catch (err) {
    debugWarn('assertSectionAccess: fetch failed:', err);
    return undefined;
  }
});

/**
 * Asserts that the currently authenticated user has access to the given section.
 * Redirects to `/login` if unauthenticated, or to `/app/dashboard` if access is denied.
 * Must be called from a server component or async layout.
 *
 * @param section - The section key to check (e.g. `'settings.ldap'`).
 */
export async function assertSectionAccess(section: Section) {
  const session = await getSession();

  if (!session?.user) redirect('/login');
  if (!session.accessToken) redirect('/login');

  const effectiveAccess = await fetchEffectiveAccess(session.accessToken);

  if (!effectiveAccess?.[section]) {
    redirect('/app/dashboard' as Route);
  }
}
