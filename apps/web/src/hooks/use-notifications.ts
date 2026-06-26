'use client';

import { useEffect, useRef } from 'react';

import { buildApiUrl } from '@luke/core';

import { trpc } from '../lib/trpc';

/**
 * Hook notifiche con dual-track: SSE push + React Query polling 30s come fallback.
 * SSE auth via ticket monouso (60s TTL) emesso da notifications.getSseTicket.
 */
export function useNotifications() {
  const utils = trpc.useUtils();

  const listQuery = trpc.notifications.list.useQuery({ limit: 20 }, { refetchInterval: 30_000 });
  const countQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const getSseTicketMutation = trpc.notifications.getSseTicket.useMutation();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let isMounted = true;

    const connect = async () => {
      try {
        const { ticket } = await getSseTicketMutation.mutateAsync();
        if (!isMounted) return;

        const url = buildApiUrl(`/api/sse?ticket=${encodeURIComponent(ticket)}`);
        const es = new EventSource(url);
        esRef.current = es;

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as { type: string; entity?: string };
            if (data.type === 'notification') {
              void utils.notifications.list.invalidate();
              void utils.notifications.unreadCount.invalidate();
            } else if (data.type === 'sync-state') {
              if (data.entity === 'portafoglio') {
                void utils.sales.statistics.portafoglio.getSyncState.invalidate();
              } else if (data.entity === 'kimo') {
                void utils.sales.statistics.kimo.getSyncState.invalidate();
              }
            }
          } catch {
            // Ignore malformed events
          }
        };

        es.onerror = () => {
          es.close();
          esRef.current = null;
          // SSE caduta: React Query polling a 30s copre il fallback
        };
      } catch {
        // Ticket fetch failed — polling fallback attivo
      }
    };

    void connect();

    return () => {
      isMounted = false;
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  return {
    notifications: listQuery.data?.items ?? [],
    nextCursor: listQuery.data?.nextCursor ?? null,
    unreadCount: countQuery.data ?? 0,
    isLoading: listQuery.isLoading,
    refetch: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  };
}
