'use client';

import { useSession } from 'next-auth/react';

import { useSseFallbackPoll, useSseMessage } from '../contexts/SseProvider';
import { trpc } from '../lib/trpc';

/**
 * Returns the current maintenance-mode state to a signed-in user, refreshed on the shared SSE
 * connection's `maintenance-mode` push (`SseProvider`) and when the stream (re)opens, and polled
 * every 2 minutes only while the stream is down (ADR-052).
 *
 * `maintenance.mode.getStatus` needs a session (ADR-042), so without one nothing is asked and no
 * state is returned — a cached answer from before a logout included — and an SSE message is
 * ignored.
 */
export function useMaintenanceStatus() {
  const signedIn = useSession().status === 'authenticated';
  const statusQuery = trpc.maintenance.mode.getStatus.useQuery(undefined, {
    enabled: signedIn,
    // During a window a user who cannot bypass it gets no stream: this poll shows its end.
    refetchInterval: useSseFallbackPoll(),
  });

  useSseMessage<{ type: string }>(data => {
    if (signedIn && (data.type === 'maintenance-mode' || data.type === 'connected')) {
      void statusQuery.refetch();
    }
  });

  return signedIn
    ? { state: statusQuery.data, isLoading: statusQuery.isLoading }
    : { state: undefined, isLoading: false };
}
