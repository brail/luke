'use client';

import { useSession } from 'next-auth/react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

import { buildApiUrl, calcBackoffDelay } from '@luke/core';

import { trpc } from '../lib/trpc';

type Listener = (data: unknown) => void;

interface SseContextType {
  subscribe: (fn: Listener) => () => void;
}

const SseContext = createContext<SseContextType | null>(null);

/**
 * Owns the single ticket-authenticated SSE connection for the whole app and fans out every
 * message to any number of subscribers (`useSseMessage`). Mounted once at the root
 * (`Providers.tsx`) so it stays alive for the whole authenticated session regardless of which
 * page-specific components happen to be mounted — `useNotifications` and `useMaintenanceStatus`
 * both subscribe here instead of each opening their own `EventSource`.
 *
 * The connect/reconnect/backoff logic below was previously its own `useTicketSse` hook; now that
 * this is its only caller (both consumers go through `useSseMessage` instead), it's inlined here
 * directly rather than kept as a separately-exported abstraction with one call site.
 */
export function SseProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const enabled = status === 'authenticated';
  const listenersRef = useRef(new Set<Listener>());

  const getSseTicketMutation = trpc.notifications.getSseTicket.useMutation();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

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

        es.onmessage = event => {
          try {
            const data: unknown = JSON.parse(event.data);
            listenersRef.current.forEach(fn => fn(data));
          } catch {
            // Ignore malformed events
          }
        };

        // Ticket è monouso: il reconnect automatico del browser fallirebbe con 401.
        // Ottieni un nuovo ticket e riconnetti dopo un backoff.
        es.onerror = () => {
          es.close();
          esRef.current = null;
          scheduleReconnect();
        };
      } catch {
        // Ticket fetch fallito — retry con backoff.
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
  }, [enabled]);

  const subscribe = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => { listenersRef.current.delete(fn); };
  }, []);

  // Stable across renders (subscribe never changes identity) so a next-auth session refetch
  // (e.g. on window focus) doesn't churn context identity and force every consumer to
  // unsubscribe/resubscribe from the shared listener set for no functional reason.
  const value = useMemo(() => ({ subscribe }), [subscribe]);

  return <SseContext.Provider value={value}>{children}</SseContext.Provider>;
}

/** Subscribes `onMessage` to every message received on the shared SSE connection (see `SseProvider`). */
export function useSseMessage<T = unknown>(onMessage: (data: T) => void): void {
  const ctx = useContext(SseContext);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(data => onMessageRef.current(data as T));
  }, [ctx]);
}
