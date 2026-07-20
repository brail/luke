'use client';

import { useEffect, useRef } from 'react';

import { buildApiUrl, calcBackoffDelay } from '@luke/core';

import { useAppContext } from '../contexts/AppContextProvider';
import { trpc } from '../lib/trpc';

/**
 * Returns the current user's notifications, using a dual-track strategy:
 * SSE push for real-time delivery and React Query polling every 30 s as fallback.
 * The SSE connection is authenticated via a single-use ticket (60 s TTL) issued
 * by `notifications.getSseTicket`. The connection is closed and cleaned up on unmount.
 *
 * @returns `{ notifications, nextCursor, unreadCount, readCount, isLoading, refetch }`
 */
export function useNotifications() {
  const utils = trpc.useUtils();
  const { season } = useAppContext();

  const listQuery = trpc.notifications.list.useQuery({ limit: 20 }, { refetchInterval: 30_000 });
  const countQuery = trpc.notifications.counts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const getSseTicketMutation = trpc.notifications.getSseTicket.useMutation();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  // Read inside the SSE handler without forcing a reconnect when the user switches season —
  // the EventSource connection itself is season-agnostic (see empty deps array below).
  const seasonIdRef = useRef(season?.id);
  seasonIdRef.current = season?.id;

  useEffect(() => {
    let isMounted = true;
    reconnectAttemptRef.current = 0;

    const scheduleReconnect = () => {
      if (!isMounted) return;
      const delay = calcBackoffDelay(reconnectAttemptRef.current, 5_000, 60_000);
      reconnectAttemptRef.current += 1;
      clearTimeout(reconnectTimerRef.current ?? undefined);
      reconnectTimerRef.current = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      try {
        const { ticket } = await getSseTicketMutation.mutateAsync();
        if (!isMounted) return;

        const url = buildApiUrl(`/api/sse?ticket=${encodeURIComponent(ticket)}`);
        const es = new EventSource(url);
        esRef.current = es;

        es.onopen = () => { reconnectAttemptRef.current = 0; };

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as { type: string; entity?: string; seasonId?: string };
            if (data.type === 'notification') {
              void utils.notifications.list.invalidate();
              void utils.notifications.counts.invalidate();
            } else if (data.type === 'sync-state') {
              if (data.entity === 'portafoglio') {
                void utils.sales.statistics.portafoglio.getSyncState.invalidate();
              } else if (data.entity === 'kimo') {
                void utils.sales.statistics.kimo.getSyncState.invalidate();
              }
            } else if (data.type === 'calendar-updated' && data.seasonId === seasonIdRef.current) {
              // Scoped to the season currently in view — otherwise every connected client would
              // refetch calendar/alert-engine data for seasons it isn't even looking at.
              void utils.seasonCalendar.listMilestones.invalidate();
              void utils.phaseAlert.invalidate();
            }
          } catch {
            // Ignore malformed events
          }
        };

        // Ticket è monouso: il reconnect automatico del browser fallirebbe con 401.
        // Ottieni un nuovo ticket e riconnetti dopo 5s.
        es.onerror = () => {
          es.close();
          esRef.current = null;
          scheduleReconnect();
        };
      } catch {
        // Ticket fetch failed — polling fallback attivo; retry dopo 5s.
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimerRef.current ?? undefined);
      reconnectTimerRef.current = null;
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  return {
    notifications: listQuery.data?.items ?? [],
    nextCursor: listQuery.data?.nextCursor ?? null,
    unreadCount: countQuery.data?.unread ?? 0,
    readCount: countQuery.data?.read ?? 0,
    isLoading: listQuery.isLoading,
    refetch: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.counts.invalidate();
    },
  };
}
