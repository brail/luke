'use client';

import { useSseMessage } from '../contexts/SseProvider';
import { trpc } from '../lib/trpc';

const POLL_MS = 60_000;

/**
 * Returns the current maintenance-mode state, polled every 60s so it works even pre-login
 * (login screen, no session — `maintenance.mode.getStatus` is a public procedure). Also
 * subscribes to the shared SSE connection (`SseProvider`) for near-real-time push on top of
 * the poll — no session means no active connection to subscribe to, so this is a no-op pre-login.
 */
export function useMaintenanceStatus() {
  const statusQuery = trpc.maintenance.mode.getStatus.useQuery(undefined, {
    refetchInterval: POLL_MS,
  });

  useSseMessage<{ type: string }>(data => {
    if (data.type === 'maintenance-mode') {
      void statusQuery.refetch();
    }
  });

  return {
    state: statusQuery.data,
    isLoading: statusQuery.isLoading,
  };
}
