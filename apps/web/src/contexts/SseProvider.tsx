'use client';

import { isTRPCClientError } from '@trpc/client';
import { useSession } from 'next-auth/react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { AppRouter } from '@luke/api';
import { buildApiUrl, calcBackoffDelay } from '@luke/core';

import { debugWarn } from '../lib/debug';
import { endSession, isSessionEnded } from '../lib/sessionEnd';
import { trpc } from '../lib/trpc';

type Listener = (data: unknown) => void;

/**
 * Silence after which an open stream counts as dead: the API beats every 30 s (`routes/sse.ts`), and
 * a stream a sleeping laptop or a proxy left half open reports no error, so polling would stay off.
 */
const STALE_STREAM_MS = 75_000;

/** Polling while the stream is down; while it is open, pushes replace it (ADR-052, owner W8d). */
const FALLBACK_POLL_MS = 120_000;

interface SseContextType {
  subscribe: (fn: Listener) => () => void;
  /** Whether the stream is open: pushes arrive, so polling can stop (`useSseConnected`). */
  connected: boolean;
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
  const [connected, setConnected] = useState(false);

  // Offline, fail and back off instead of pausing until reconnect: the reconnect timer owns retries.
  const getSseTicketMutation = trpc.notifications.getSseTicket.useMutation({ networkMode: 'always' });
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    // The first open needs no catch-up: the page's queries were just fetched. A reopen does.
    let opened = false;
    reconnectAttemptRef.current = 0;

    /** `minDelayMs`: a wait the server asked for (a refused ticket's `retryAfterSeconds`). */
    const scheduleReconnect = (minDelayMs = 0) => {
      if (!isMounted) return;
      setConnected(false);
      clearTimeout(watchdogRef.current ?? undefined);
      // Equal jitter: after an API restart or a network drop, the tabs of every user reconnect apart,
      // and never sooner than half the backoff — a stream that opens and drops at once cannot loop.
      const backoff = calcBackoffDelay(reconnectAttemptRef.current, 5_000, 60_000);
      const delay = Math.max(minDelayMs, backoff / 2 + (Math.random() * backoff) / 2);
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

        // Re-armed by every message; fires only on a stream silent past two beats.
        const watch = () => {
          clearTimeout(watchdogRef.current ?? undefined);
          watchdogRef.current = setTimeout(() => {
            es.close();
            esRef.current = null;
            scheduleReconnect();
          }, STALE_STREAM_MS);
        };

        es.onopen = () => {
          reconnectAttemptRef.current = 0;
          setConnected(true);
          watch();
        };

        es.onmessage = event => {
          watch();
          let data: unknown;
          try {
            data = JSON.parse(event.data);
          } catch {
            return; // Ignore malformed events
          }
          const type = typeof data === 'object' && data !== null && 'type' in data ? data.type : undefined;
          // The sessions were revoked (ADR-052): the server ends the stream right after.
          if (type === 'session-revoked') {
            endSession();
            return;
          }
          if (type === 'connected') {
            const reopened = opened;
            opened = true;
            if (!reopened) return;
          }
          listenersRef.current.forEach(fn => fn(data));
        };

        // Ticket is single-use: automatic browser reconnect would fail with 401.
        // Get a new ticket and reconnect after backoff.
        es.onerror = () => {
          es.close();
          esRef.current = null;
          scheduleReconnect();
        };
      } catch (error) {
        // The session is over: the global handler signs out (`createQueryClient`); nothing to retry.
        if (isSessionEnded(error)) return;
        // A refused ticket waits as long as the server asks; anything else backs off.
        const retryAfterSeconds = isTRPCClientError<AppRouter>(error) ? error.data?.retryAfterSeconds : undefined;
        debugWarn('SSE ticket refused; reconnecting with backoff', error);
        scheduleReconnect((retryAfterSeconds ?? 0) * 1000);
      }
    };

    void connect();

    return () => {
      isMounted = false;
      setConnected(false);
      clearTimeout(watchdogRef.current ?? undefined);
      clearTimeout(reconnectTimerRef.current ?? undefined);
      reconnectTimerRef.current = null;
      esRef.current?.close();
      esRef.current = null;
    };
    // `getSseTicketMutation` deliberately excluded: its object identity changes on every
    // isPending/data/status transition (a `useMutation()` result is not referentially stable
    // across renders), so depending on it would tear down and reopen the EventSource connection
    // right after every ticket fetch — a reconnect storm, not a fix. `enabled` is the only signal
    // this effect needs to know when to (re)connect or disconnect.
  }, [enabled]);

  const subscribe = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => { listenersRef.current.delete(fn); };
  }, []);

  // Changes only when the stream opens or drops; `subscribe` never changes identity, and
  // `useSseMessage` depends on it alone, so no consumer resubscribes.
  const value = useMemo(() => ({ subscribe, connected }), [subscribe, connected]);

  return <SseContext.Provider value={value}>{children}</SseContext.Provider>;
}

/** Subscribes `onMessage` to every message received on the shared SSE connection (see `SseProvider`). */
export function useSseMessage<T = unknown>(onMessage: (data: T) => void): void {
  // The stable `subscribe`, not the context value, which changes when the stream opens or drops.
  const subscribe = useContext(SseContext)?.subscribe;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!subscribe) return;
    return subscribe(data => onMessageRef.current(data as T));
  }, [subscribe]);
}

/**
 * The `refetchInterval` for data the stream pushes: none while it is open, every 2 minutes while it
 * is down (ADR-052). Such a hook also refetches on `connected`, sent when the stream reopens.
 */
export function useSseFallbackPoll(): number | false {
  return useSseConnected() ? false : FALLBACK_POLL_MS;
}

/**
 * Whether the shared SSE stream is open. While it is, its pushes replace polling: a hook polls only
 * when this is `false` (ADR-052).
 */
export function useSseConnected(): boolean {
  return useContext(SseContext)?.connected ?? false;
}
