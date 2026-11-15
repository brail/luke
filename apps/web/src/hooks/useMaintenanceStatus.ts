'use client';

import { useSession } from 'next-auth/react';

import { useSseMessage } from '../contexts/SseProvider';
import { trpc } from '../lib/trpc';

const POLL_MS = 60_000;

/**
 * Returns the current maintenance-mode state to a signed-in user, polled every 60s and refreshed
 * on the shared SSE connection's `maintenance-mode` push (`SseProvider`).
 *
 * `maintenance.mode.getStatus` needs a session (ADR-042), so without one nothing is asked and no
 * state is returned — a cached answer from before a logout included — and an SSE message is
 * ignored.
 */
export function useMaintenanceStatus() {
  const signedIn = useSession().status === 'authenticated';
  const statusQuery = trpc.maintenance.mode.getStatus.useQuery(undefined, {
    enabled: signedIn,
    refetchInterval: POLL_MS,
  });

  useSseMessage<{ type: string }>(data => {
    if (signedIn && data.type === 'maintenance-mode') {
      void statusQuery.refetch();
    }
  });

  return signedIn
    ? { state: statusQuery.data, isLoading: statusQuery.isLoading }
    : { state: undefined, isLoading: false };
}
