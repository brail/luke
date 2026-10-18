'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

export interface LockTarget {
  entityType: 'SEASON_CALENDAR' | 'COLLECTION_LAYOUT';
  entityId: string;
}

/** Renew this far into the remaining TTL (fraction), leaving margin for a missed/slow heartbeat. */
const RENEW_FRACTION = 0.5;

export const EXPIRED_MESSAGE = 'Sessione di pianificazione scaduta — ricomincia';
/** Rendered by the caller on a `scopeChanged` session — exported so it is not respelled there. */
export const SCOPE_CHANGED_MESSAGE =
  'Il collection layout di questa stagione è cambiato durante la sessione: il blocco copre ancora quello iniziale. Chiudi e ricomincia la pianificazione.';

/** The three states a discovery query settles into — `tanstack/react-query`'s own `status`. */
export type LayoutQueryStatus = 'pending' | 'error' | 'success';

/**
 * The lock session's own lifecycle, deliberately **not** a projection of the discovery query.
 *
 * Discovery and an active lock session are two phases, and only the first one is allowed to read
 * the query:
 *
 * - Before a grant exists (`idle` → `acquiring`) discovery is authoritative. Nothing is held, so
 *   abandoning an obsolete in-flight acquisition costs no guarantee, and `pending`/`error` mean the
 *   dependency set is unknown — never a partial acquisition.
 * - Once a grant lands (`held`) the granted set is frozen for the rest of the session. Discovery
 *   can only *report* — it can never release, replace or extend that set. This is the invariant the
 *   Cycle 4 fix got wrong: it left `targets` in the acquire effect's dependency array, so a
 *   background refetch failure (which `@tanstack/query-core` reports as `status: 'error'`
 *   unconditionally, prior success or not) ran the effect's cleanup, released a lock the user was
 *   actively working under, and reacquired nothing.
 *
 * `renewError` and `scopeChanged` are two independent degradations of a session that is still held,
 * each with exactly one writer — the heartbeat and the discovery reducer respectively — so neither
 * can clobber the other's signal. Both mean "this session can no longer vouch for a mutation";
 * neither means "no lock is held", which is why they do not collapse into `lost`.
 */
export type WizardLockSession =
  /** No session: disabled, or discovery has not settled yet. */
  | { status: 'idle' }
  /** `acquireMany` in flight for exactly `targets`. */
  | { status: 'acquiring'; targets: LockTarget[]; key: string }
  /** The lock is held. `targets` is the exact granted set — renew and release use only this. */
  | {
      status: 'held';
      targets: LockTarget[];
      key: string;
      expiresAt: Date;
      /** Set when a heartbeat was rejected: the lock may already be gone, or was reclaimed. */
      renewError: string | null;
      /** Set when discovery now reports a target set this session never acquired. */
      scopeChanged: boolean;
    }
  /** No lock is held and none will be, without a fresh session. */
  | { status: 'lost'; cause: 'acquire-failed' | 'expired'; message: string; wasHeld: boolean };

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
 * This is a statement about *discovery*, not about the session. Returning `null` once a lock is
 * already held says "the answer is unknown again", never "release what you hold" — see
 * `reduceDiscovery`, which is where that distinction is actually enforced.
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
 * Content signature of a target set. `computeLockTargets` returns a fresh array on every settle,
 * so reference identity cannot distinguish "the layout query re-resolved to the same thing" from
 * "the dependency set actually changed" — and the first must be a no-op at every phase.
 */
export function lockTargetsKey(targets: LockTarget[]): string {
  return [...targets].map(t => `${t.entityType}:${t.entityId}`).sort().join('|');
}

/**
 * The whole discovery→session boundary, as one pure transition so it can be read (and tested) as a
 * table rather than inferred from effect dependency arrays. `targets` is the *live* discovery
 * output; what the function is allowed to do with it depends entirely on the phase `prev` is in.
 */
export function reduceDiscovery(
  prev: WizardLockSession,
  enabled: boolean,
  targets: LockTarget[] | null
): WizardLockSession {
  // Closing the wizard ends the session outright — the release itself is the acquire effect's job.
  if (!enabled) return prev.status === 'idle' ? prev : { status: 'idle' };

  // `targets === null` is the only "discovery has not answered" value, and every phase tests for it
  // explicitly rather than through the key's truthiness: `lockTargetsKey([])` is `''`, so a
  // falsiness check would read a concrete empty set as an unsettled one — and at `held` that
  // difference is the whole point, since an empty set is demonstrably not what the session holds.
  switch (prev.status) {
    case 'idle':
      return targets === null ? prev : { status: 'acquiring', targets, key: lockTargetsKey(targets) };

    case 'acquiring': {
      // Pre-grant: discovery is authoritative. Nothing is held, so switching or standing down
      // costs no guarantee; the obsolete grant is released by the acquire effect when it lands.
      if (targets === null) return { status: 'idle' };
      const liveKey = lockTargetsKey(targets);
      return liveKey === prev.key ? prev : { status: 'acquiring', targets, key: liveKey };
    }

    case 'held': {
      // Post-grant: the granted set is frozen. An unsettled query says nothing about the session.
      if (targets === null) return prev;
      // A genuinely different set is real information, but acting on it is not an option: releasing
      // to reacquire opens exactly the concurrency gap this hook exists to close, and extending the
      // set mid-session is BUG-B's original defect class. So the session keeps precisely what it
      // was granted and reports the divergence, which the caller turns into a blocked mutation.
      if (lockTargetsKey(targets) !== prev.key) {
        return prev.scopeChanged ? prev : { ...prev, scopeChanged: true };
      }
      return prev.scopeChanged ? { ...prev, scopeChanged: false } : prev;
    }

    case 'lost':
      return prev;
  }
}

/**
 * Acquires session locks on the given entities for the lifetime of the planning wizard, releasing
 * them exactly once when the wizard closes or unmounts. Heartbeats via `editLock.renew` at
 * RENEW_FRACTION of the remaining TTL, so a session actively being worked on never hits the hard
 * expiry — only one left idle/offline does. A hard-expiry backstop timer (independent of the
 * heartbeat) still ends the session if renewal silently stops happening.
 *
 * `targets` is the *live* output of target discovery, `null` while it has not settled. See
 * `WizardLockSession` for which phase is allowed to act on it: the short version is that discovery
 * decides what to acquire, and after that it decides nothing at all.
 *
 * Every RPC it issues — acquire, and both flavours of release — is serialized through one queue per
 * hook instance, so no two of them are ever outstanding together. See `lockRpcQueueRef` for why
 * that is a correctness requirement here rather than politeness toward the server.
 */
export function useWizardLock(targets: LockTarget[] | null, enabled: boolean): WizardLockSession {
  const [storedSession, setSession] = useState<WizardLockSession>({ status: 'idle' });
  /**
   * The set the server actually granted, held outside React state because releasing it is a
   * cleanup obligation that must fire exactly once regardless of which phase the session is in
   * when the wizard closes.
   */
  const grantedRef = useRef<LockTarget[] | null>(null);
  /**
   * Serializes every lock RPC this hook instance issues, so that **at most one `acquireMany` is
   * ever outstanding** and a successor is not sent until its predecessor has settled and — if it
   * was granted — been released.
   *
   * This is not belt-and-braces around "release only what nobody else holds". `releaseLocks`
   * (`apps/api/src/services/editLock.service.ts`) deletes by `(lockedByUserId, entityType,
   * entityId)`; the row carries no acquisition or session token, so the server cannot tell one
   * attempt's release from another attempt's grant *by the same user on the same entity*. Two
   * overlapping acquisitions from one wizard are therefore inseparable at the boundary: whichever
   * request lands last wins, and it may be the obsolete release, deleting the row the live session
   * depends on while the UI still reports a healthy lock. Subtracting the already-granted set from
   * an abandoned release would close only the orderings where a grant already exists — not two
   * acquisitions racing before either has landed.
   *
   * Ordering the requests instead removes the ambiguity without a protocol change: the frontend
   * never puts the server in a position where it would have to distinguish them.
   */
  const lockRpcQueueRef = useRef<Promise<void>>(Promise.resolve());

  const { mutateAsync: acquireMany } = trpc.editLock.acquireMany.useMutation();
  const { mutateAsync: renew } = trpc.editLock.renew.useMutation();
  const { mutateAsync: releaseAsync } = trpc.editLock.release.useMutation();

  /**
   * A release whose failure is deliberately swallowed. It is awaited wherever ordering matters, and
   * a rejection there must not propagate into the queue: it would stall every later acquisition on
   * this instance behind a request that is never coming back. A release that genuinely fails costs
   * at most one `editLock` TTL of a stale row, which is what the TTL is for.
   */
  const releaseTargets = useCallback(async (entities: LockTarget[]) => {
    try {
      await releaseAsync({ entities });
    } catch {
      // Reclaimed by the server-side TTL; see above.
    }
  }, [releaseAsync]);

  /**
   * Appends one step to the serialization queue.
   *
   * The trailing `catch` is what keeps the chain permanently un-rejected, and it is structural on
   * purpose rather than a bet that every step is internally exhaustive: a throw from anywhere a
   * step does not guard — the acquire step formats its error inside its own `catch`, for one —
   * would otherwise leave `lockRpcQueueRef.current` rejected forever, and every later `.then` would
   * be skipped. The step that matters there is the release on unmount: a poisoned queue does not
   * merely stop acquiring, it leaks the held lock until its server-side TTL.
   *
   * Recovering here cannot let a successor overtake its predecessor: a rejection is a settled
   * state, so the `catch` still runs strictly after the step it recovers, and the next step is
   * chained after the `catch`. Serialization is unchanged; only the poisoning is removed.
   */
  const enqueueLockRpc = useCallback((step: () => Promise<void>) => {
    lockRpcQueueRef.current = lockRpcQueueRef.current.then(step).catch(() => {
      // Nothing actionable at this level, and the queue must keep draining regardless of which
      // step failed or why. Every failure the hook can interpret is already handled inside its own
      // step, where it reaches the user as session state.
    });
  }, []);

  // Phase transitions driven by discovery, adjusted during render rather than in an effect
  // (https://react.dev/learn/you-might-not-need-an-effect): `reduceDiscovery` is pure and returns
  // `prev` unchanged for every inert input — which is the common case once a lock is held — so
  // discovery churn is absorbed here without a state write, without an extra committed render, and
  // without ever reaching an effect that talks to the server.
  const session = reduceDiscovery(storedSession, enabled, targets);
  if (session !== storedSession) setSession(session);

  // Acquisition. Keyed on the committed set rather than on `targets`, which is the whole point:
  // once this resolves into `held`, no discovery change can re-run or tear down this effect.
  const pendingTargets = session.status === 'acquiring' ? session.targets : null;
  useEffect(() => {
    if (!pendingTargets) return;

    let obsolete = false;
    // Queued rather than started: if a predecessor is still outstanding, this attempt waits for it
    // to settle *and* hand back whatever it was granted before a single byte of it goes out.
    enqueueLockRpc(async () => {
      // Latest-wins. Discovery may have moved on several times while this attempt sat in the
      // queue; every superseded one drops here, without ever reaching the network.
      if (obsolete) return;
      try {
        const results = await acquireMany({ entities: pendingTargets });
        if (obsolete) {
          // The session moved on (or ended) while this was in flight — the server granted a lock
          // nothing will ever hold. Awaiting the release (rather than firing and forgetting it) is
          // what keeps it ordered before the successor's acquire, so it cannot delete a row that
          // successor is about to be granted. `grantedRef` was deliberately never set, so the
          // session-scoped release below cannot double-release this same set.
          await releaseTargets(pendingTargets);
          return;
        }
        grantedRef.current = pendingTargets;
        setSession({
          status: 'held',
          targets: pendingTargets,
          key: lockTargetsKey(pendingTargets),
          expiresAt: new Date(results[0]!.expiresAt),
          renewError: null,
          scopeChanged: false,
        });
      } catch (err) {
        // An obsolete attempt's failure belongs to a session that no longer exists — reporting it
        // would overwrite the state of whatever superseded it.
        if (obsolete) return;
        setSession({
          status: 'lost',
          cause: 'acquire-failed',
          message: getTrpcErrorMessage(err),
          wasHeld: false,
        });
      }
    });

    return () => { obsolete = true; };
  }, [pendingTargets, acquireMany, enqueueLockRpc, releaseTargets]);

  // Release, scoped to the whole `enabled` window rather than to any one phase — the grant has to
  // outlive the acquire effect (which tears down the moment the session becomes `held`) and must
  // survive every expiry/degradation transition, since the server-side lock does. Queued like every
  // other lock RPC, so that a wizard closed and immediately reopened cannot have its release racing
  // the reopened session's acquire.
  useEffect(() => {
    if (!enabled) return;
    return () => {
      const granted = grantedRef.current;
      if (!granted) return;
      grantedRef.current = null;
      enqueueLockRpc(() => releaseTargets(granted));
    };
  }, [enabled, enqueueLockRpc, releaseTargets]);

  // Schedules both the hard-expiry backstop and the heartbeat renewal off one shared
  // `msRemaining` computation. A successful renewal moves `expiresAt` forward, which reruns this
  // effect and reschedules both timers from the new deadline; a failed renewal only sets
  // `renewError`, leaving `expiresAt` untouched — the backstop below still fires at the original
  // deadline as a final fallback if the session is truly gone.
  const heldTargets = session.status === 'held' ? session.targets : null;
  const heldExpiresAt = session.status === 'held' ? session.expiresAt : null;
  const renewFailed = session.status === 'held' && session.renewError !== null;
  useEffect(() => {
    if (!heldTargets || !heldExpiresAt) return;

    const expire = () => setSession(s =>
      s.status === 'held'
        ? { status: 'lost', cause: 'expired', message: EXPIRED_MESSAGE, wasHeld: true }
        : s
    );

    const msRemaining = heldExpiresAt.getTime() - Date.now();
    if (msRemaining <= 0) {
      expire();
      return;
    }

    const backstop = setTimeout(expire, msRemaining);
    if (renewFailed) {
      return () => clearTimeout(backstop);
    }

    let cancelled = false;
    const heartbeat = setTimeout(async () => {
      try {
        const results = await renew({ entities: heldTargets });
        if (cancelled) return;
        setSession(s => (s.status === 'held'
          ? { ...s, expiresAt: new Date(results[0]!.expiresAt), renewError: null }
          : s));
      } catch (err) {
        if (cancelled) return;
        const message = getTrpcErrorMessage(err);
        setSession(s => (s.status === 'held' ? { ...s, renewError: message } : s));
      }
    }, msRemaining * RENEW_FRACTION);

    return () => { cancelled = true; clearTimeout(backstop); clearTimeout(heartbeat); };
  }, [heldTargets, heldExpiresAt, renewFailed, renew]);

  return session;
}
