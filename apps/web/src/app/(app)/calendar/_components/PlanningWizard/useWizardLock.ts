'use client';

import { useEffect, useRef, useState } from 'react';

import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

interface LockTarget {
  entityType: 'SEASON_CALENDAR' | 'COLLECTION_LAYOUT';
  entityId: string;
}

interface WizardLockState {
  /** Cutoff of the current lock period — pushed forward on every successful heartbeat renewal. */
  expiresAt: Date | null;
  /** True once the lock has expired without being renewed — caller should force the wizard closed. */
  expired: boolean;
  /** Set if a lock could not be acquired, or a renewal was rejected (session lost/reclaimed). */
  error: string | null;
}

/** Renew this far into the remaining TTL (fraction), leaving margin for a missed/slow heartbeat. */
const RENEW_FRACTION = 0.5;

/**
 * Acquires session locks on the given entities for the lifetime of the planning wizard, releasing
 * them on unmount. Heartbeats via `editLock.renew` at RENEW_FRACTION of the remaining TTL, so a
 * session actively being worked on never hits the hard expiry — only one left idle/offline does.
 * A hard-expiry backstop timer (independent of the heartbeat) still force-closes the wizard if
 * renewal silently stops happening (e.g. the tab lost connectivity).
 */
export function useWizardLock(targets: LockTarget[], enabled: boolean): WizardLockState {
  const [state, setState] = useState<WizardLockState>({ expiresAt: null, expired: false, error: null });
  const acquiredRef = useRef(false);

  const acquireManyMutation = trpc.editLock.acquireMany.useMutation();
  const renewMutation = trpc.editLock.renew.useMutation();
  const releaseMutation = trpc.editLock.release.useMutation();

  useEffect(() => {
    if (!enabled || acquiredRef.current || targets.length === 0) return;
    acquiredRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const results = await acquireManyMutation.mutateAsync({ entities: targets });
        if (cancelled) return;
        setState({ expiresAt: new Date(results[0]!.expiresAt), expired: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          expiresAt: null,
          expired: false,
          error: getTrpcErrorMessage(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      releaseMutation.mutate({ entities: targets });
    };
    // Targets are stable for the wizard's lifetime (calendar/layout don't change mid-session).
  }, [enabled]);

  // Schedules both the hard-expiry backstop and the heartbeat renewal off one shared
  // `msRemaining` computation. A successful renewal moves `expiresAt` forward, which reruns this
  // effect and reschedules both timers from the new deadline; a failed renewal only sets `error`,
  // leaving `expiresAt` untouched — the backstop below still fires at the original deadline as a
  // final fallback if the session is truly gone.
  useEffect(() => {
    if (!state.expiresAt) return;

    const msRemaining = state.expiresAt.getTime() - Date.now();
    if (msRemaining <= 0) {
      setState(s => ({ ...s, expired: true }));
      return;
    }

    const backstop = setTimeout(() => setState(s => ({ ...s, expired: true })), msRemaining);
    if (state.error) {
      return () => clearTimeout(backstop);
    }

    let cancelled = false;
    const heartbeat = setTimeout(async () => {
      try {
        const results = await renewMutation.mutateAsync({ entities: targets });
        if (cancelled) return;
        setState({ expiresAt: new Date(results[0]!.expiresAt), expired: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState(s => ({ ...s, error: getTrpcErrorMessage(err) }));
      }
    }, msRemaining * RENEW_FRACTION);

    return () => { cancelled = true; clearTimeout(backstop); clearTimeout(heartbeat); };
  }, [state.expiresAt, state.error]);

  return state;
}
