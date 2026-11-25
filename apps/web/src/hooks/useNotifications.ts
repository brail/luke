'use client';

import { useRef } from 'react';

import { useAppContext } from '../contexts/AppContextProvider';
import { useSseFallbackPoll, useSseMessage } from '../contexts/SseProvider';
import { trpc } from '../lib/trpc';

interface SseMessage {
  type: string;
  entity?: string;
  seasonId?: string;
}

/**
 * Returns the current user's notifications: pushed over the shared SSE connection (`SseProvider`),
 * refetched when the stream (re)opens to catch up on what it missed, and polled every 2 minutes
 * only while the stream is down (ADR-052).
 *
 * @returns `{ notifications, nextCursor, unreadCount, readCount, isLoading, refetch }`
 */
export function useNotifications() {
  const utils = trpc.useUtils();
  const { season } = useAppContext();

  const refetchInterval = useSseFallbackPoll();
  const listQuery = trpc.notifications.list.useQuery({ limit: 20 }, { refetchInterval });
  const countQuery = trpc.notifications.counts.useQuery(undefined, { refetchInterval });

  // Read inside the SSE handler without forcing a reconnect when the user switches season —
  // the shared connection itself is season-agnostic.
  const seasonIdRef = useRef(season?.id);
  seasonIdRef.current = season?.id;

  useSseMessage<SseMessage>(data => {
    if (data.type === 'notification' || data.type === 'connected') {
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
  });

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
