'use client';

import { useEffect, useRef, useState } from 'react';

import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

export interface LockTarget {
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

/** The three states a discovery query settles into — `tanstack/react-query`'s own `status`. */
export type LayoutQueryStatus = 'pending' | 'error' | 'success';

/**
 * `null` while the caller's target set is not yet a known-complete answer — the wizard must not
 * acquire a partial set and extend it once the rest resolves. Two `LayoutQueryStatus` values mean
 * that: `'pending'` (still loading) obviously, and `'error'` too — a failed `collectionLayout.get`
 * leaves the complete dependency set genuinely unknown, and treating that failure as "no layout"
 * would silently lock `SEASON_CALENDAR` alone on the same defect class BUG-B already was. Only
 * `'success'` is trusted, and even then a resolved-but-absent id (`layoutId === undefined`) is a
 * real, permanent answer — `collectionLayout.get` returns `null` when no layout row exists for the
 * brand/season pair, not an error — handled the same as a resolved one: lock `SEASON_CALENDAR`
 * only, and don't invent a `COLLECTION_LAYOUT` lock for a layout that doesn't exist.
 *
 * Colocated with `useWizardLock` rather than with its caller so a test can import it without
 * pulling in `PlanningWizard.tsx`'s own import graph (Dialog, sonner, the trpc client) — this
 * file's only imports are `trpc` (mockable) and a pure error-formatting helper.
 *
 * Takes `layoutId` rather than the whole layout object on purpose: the lock only cares about
 * *which* layout this is, not its content (`groups`/`rows`), so a background refetch that changes
 * unrelated layout content but leaves the id the same must not look like a target-set change.
 */
export function computeLockTargets(
  calendarId: string,
  layoutId: string | undefined,
  layoutStatus: LayoutQueryStatus
): LockTarget[] | null {
  if (layoutStatus !== 'success') return null;
  const targets: LockTarget[] = [{ entityType: 'SEASON_CALENDAR', entityId: calendarId }];
  if (layoutId) targets.push({ entityType: 'COLLECTION_LAYOUT', entityId: layoutId });
  return targets;
}

/**
 * Acquires session locks on the given entities for the lifetime of the planning wizard, releasing
 * them on unmount (or when `enabled` turns false). Heartbeats via `editLock.renew` at
 * RENEW_FRACTION of the remaining TTL, so a session actively being worked on never hits the hard
 * expiry — only one left idle/offline does. A hard-expiry backstop timer (independent of the
 * heartbeat) still force-closes the wizard if renewal silently stops happening.
 *
 * `targets` is `null` while the caller's target set is still being discovered (e.g. a query that
 * hasn't settled yet). No lock is acquired until it resolves to a concrete array: acquiring
 * `SEASON_CALENDAR` alone and extending the set once the rest resolves would leave a window where
 * a concurrent editor takes `COLLECTION_LAYOUT` out from under a session already in progress — the
 * bug this hook used to have. Once acquisition succeeds, `acquiredTargetsRef` freezes the set that
 * was actually granted; renew and release always operate on that, never on whatever `targets` is
 * by the time they run, so a later, unrelated identity change of `targets` cannot desync them from
 * what the server actually holds.
 */
export function useWizardLock(targets: LockTarget[] | null, enabled: boolean): WizardLockState {
  const [state, setState] = useState<WizardLockState>({ expiresAt: null, expired: false, error: null });
  const acquiredTargetsRef = useRef<LockTarget[] | null>(null);

  const { mutateAsync: acquireMany } = trpc.editLock.acquireMany.useMutation();
  const { mutateAsync: renew } = trpc.editLock.renew.useMutation();
  const { mutate: release } = trpc.editLock.release.useMutation();

  useEffect(() => {
    if (!enabled || !targets || targets.length === 0 || acquiredTargetsRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const results = await acquireMany({ entities: targets });
        if (cancelled) {
          // Left (unmounted, or `enabled`/`targets` moved on) before this resolved — the server
          // already granted the lock, and nothing will ever release it through the normal path
          // below, since `acquiredTargetsRef` is never set for a cancelled run.
          release({ entities: targets });
          return;
        }
        acquiredTargetsRef.current = targets;
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
      if (acquiredTargetsRef.current) {
        const acquired = acquiredTargetsRef.current;
        acquiredTargetsRef.current = null;
        release({ entities: acquired });
      }
    };
  }, [enabled, targets, acquireMany, release]);

  // Schedules both the hard-expiry backstop and the heartbeat renewal off one shared
  // `msRemaining` computation. A successful renewal moves `expiresAt` forward, which reruns this
  // effect and reschedules both timers from the new deadline; a failed renewal only sets `error`,
  // leaving `expiresAt` untouched — the backstop below still fires at the original deadline as a
  // final fallback if the session is truly gone.
  useEffect(() => {
    if (!state.expiresAt) return;
    const acquired = acquiredTargetsRef.current;
    if (!acquired) return; // Renew only ever targets what acquisition actually secured.

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
        const results = await renew({ entities: acquired });
        if (cancelled) return;
        setState({ expiresAt: new Date(results[0]!.expiresAt), expired: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState(s => ({ ...s, error: getTrpcErrorMessage(err) }));
      }
    }, msRemaining * RENEW_FRACTION);

    return () => { cancelled = true; clearTimeout(backstop); clearTimeout(heartbeat); };
  }, [state.expiresAt, state.error, renew]);

  return state;
}
