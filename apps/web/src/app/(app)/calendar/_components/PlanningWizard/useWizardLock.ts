'use client';

import { useEffect, useRef, useState } from 'react';

import { trpc } from '../../../../../lib/trpc';

interface LockTarget {
  entityType: 'SEASON_CALENDAR' | 'COLLECTION_LAYOUT';
  entityId: string;
}

interface WizardLockState {
  /** Fixed cutoff shared by all acquired locks (the earliest of the two). No renewal. */
  expiresAt: Date | null;
  /** True once `expiresAt` has passed — caller should force the wizard closed. */
  expired: boolean;
  /** Set if a lock could not be acquired (e.g. another user is already planning). */
  error: string | null;
}

/**
 * Acquires session locks on the given entities for the lifetime of the planning wizard, releasing
 * them on unmount. TTL is fixed (set server-side, ~15 min) — no heartbeat/renewal, matching the
 * "wizard restarts from scratch on expiry" behavior decided for this feature.
 */
export function useWizardLock(targets: LockTarget[], enabled: boolean): WizardLockState {
  const [state, setState] = useState<WizardLockState>({ expiresAt: null, expired: false, error: null });
  const acquiredRef = useRef(false);

  const acquireMutation = trpc.editLock.acquire.useMutation();
  const releaseMutation = trpc.editLock.release.useMutation();

  useEffect(() => {
    if (!enabled || acquiredRef.current || targets.length === 0) return;
    acquiredRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(targets.map(t => acquireMutation.mutateAsync(t)));
        if (cancelled) return;
        const earliest = results.reduce<Date | null>((min, r) => {
          const exp = new Date(r.expiresAt);
          return !min || exp < min ? exp : min;
        }, null);
        setState({ expiresAt: earliest, expired: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          expiresAt: null,
          expired: false,
          error: err instanceof Error ? err.message : 'Impossibile acquisire il lock di pianificazione',
        });
      }
    })();

    return () => {
      cancelled = true;
      targets.forEach(t => releaseMutation.mutate(t));
    };
    // Targets are stable for the wizard's lifetime (calendar/layout don't change mid-session).
  }, [enabled]);

  useEffect(() => {
    if (!state.expiresAt) return;
    const ms = state.expiresAt.getTime() - Date.now();
    if (ms <= 0) {
      setState(s => ({ ...s, expired: true }));
      return;
    }
    const timer = setTimeout(() => setState(s => ({ ...s, expired: true })), ms);
    return () => clearTimeout(timer);
  }, [state.expiresAt]);

  return state;
}
