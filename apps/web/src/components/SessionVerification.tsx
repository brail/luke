'use client';

import { focusManager, onlineManager } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';

import { useSseConnected } from '../contexts/SseProvider';
import { debugWarn } from '../lib/debug';
import { trpc } from '../lib/trpc';

/**
 * Checks the session when the tab becomes visible or the network comes back: a revocation pushed
 * while the tab slept or was offline (`session-revoked`) never reached it. The check is a fresh
 * `me.get`; a `sessionEnded` answer signs out through the global handler (`createQueryClient`),
 * anything else (429, 5xx, offline) is ignored here. Skipped while the SSE stream is open, which
 * delivers the revocation itself. No timer: a running tab learns from the push, the heartbeat or its
 * next call (ADR-052). Renders nothing.
 */
export function SessionVerification() {
  const signedIn = useSession().status === 'authenticated';
  const utils = trpc.useUtils();
  // The watchdog drops a dead stream (`SseProvider`), so `connected` stays honest.
  const connected = useSseConnected();

  useEffect(() => {
    if (!signedIn || connected) return;
    const check = (active: boolean) => {
      if (active) {
        void utils.me.get
          .fetch(undefined, { staleTime: 0 })
          .catch((error: unknown) => debugWarn('Session check failed', error));
      }
    };
    const unsubscribeFocus = focusManager.subscribe(check);
    const unsubscribeOnline = onlineManager.subscribe(check);
    return () => {
      unsubscribeFocus();
      unsubscribeOnline();
    };
  }, [signedIn, connected, utils]);

  return null;
}
