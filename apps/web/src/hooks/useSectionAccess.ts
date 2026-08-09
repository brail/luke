'use client';

import { useSession } from 'next-auth/react';

import { trpc } from '../lib/trpc';

/**
 * Returns the effective section access map for the current user.
 * All 4 layers evaluated server-side — no logic duplicated here.
 */
export function useSectionAccess() {
  const { data: session } = useSession();

  const { data } = trpc.sectionAccess.getEffectiveForMe.useQuery(undefined, {
    enabled: !!session?.user,
    retry: false,
    trpc: { context: { skipBatch: true } },
  });

  return data ?? ({} as Record<string, boolean>);
}
