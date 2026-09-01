import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { computeLockTargets, lockTargetsKey, reduceDiscovery, useWizardLock } from '../useWizardLock';

import type { LockTarget, WizardLockSession } from '../useWizardLock';

/**
 * BUG-B: on a cold React Query cache the wizard used to acquire `SEASON_CALENDAR` alone (the only
 * target ready at first render), latch a boolean so it never tried again once `COLLECTION_LAYOUT`
 * resolved, and later attempt to renew a lock it had never actually taken. The fix has two parts
 * this file proves independently, then together:
 *
 * - `computeLockTargets` (in `useWizardLock.ts`, consumed by `PlanningWizard.tsx`) — the pure
 *   translation from the layout query's `status` ('pending' | 'error' | 'success') and what it
 *   resolved to into `LockTarget[] | null`. `null` for anything but a settled success is the whole
 *   fix: it is what stops the wizard from acquiring an incomplete — or unknown — set instead of
 *   waiting. `PlanningWizard.browser.test.tsx` proves the same distinction end to end, including
 *   the query-error case this file's pure tests cover in isolation.
 * - `useWizardLock` — given that `null | LockTarget[]` sequence, acquires exactly once, only once
 *   the set is complete, and keeps renew/release pinned to what was actually granted.
 *
 * Reference: `docs/LUKE_MONOREPO_AUDIT_2026-08-30.md` Appendix A §A.5 (BUG-B), Appendix D §D.5.
 */

const CALENDAR_ID = 'calendar-1';
const LAYOUT_ID = 'layout-1';
const SEASON_CALENDAR: LockTarget = { entityType: 'SEASON_CALENDAR', entityId: CALENDAR_ID };
const COLLECTION_LAYOUT: LockTarget = { entityType: 'COLLECTION_LAYOUT', entityId: LAYOUT_ID };
const COMPLETE_SET: LockTarget[] = [SEASON_CALENDAR, COLLECTION_LAYOUT];

describe('computeLockTargets — target discovery (PlanningWizard.tsx)', () => {
  test('cold cache: layout query still pending → null, not a partial set', () => {
    expect(computeLockTargets(CALENDAR_ID, undefined, 'pending')).toBeNull();
  });

  test('warm cache / resolved with a layout: complete set in one call', () => {
    expect(computeLockTargets(CALENDAR_ID, LAYOUT_ID, 'success')).toEqual(COMPLETE_SET);
  });

  test('legitimate no-layout: settled successfully with no id → SEASON_CALENDAR only, not null', () => {
    // `collectionLayout.get` (apps/api/src/routers/collectionLayout.ts) returns `getLayout(...)`
    // unchanged, and `getLayout` (apps/api/src/services/collectionLayout.service.ts) is a bare
    // `prisma.collectionLayout.findUnique(...)`, typed `Promise<CollectionLayoutWithRelations |
    // null>` — `null` is Prisma's ordinary "no row" result, not an error path. This is the
    // settled-with-nothing state the fix distinguishes from both still-loading and failed.
    expect(computeLockTargets(CALENDAR_ID, undefined, 'success')).toEqual([SEASON_CALENDAR]);
  });

  test('query error: null, same as pending — never guess calendar-only from a failure', () => {
    // A failed `collectionLayout.get` is not evidence of "no layout" — the complete set is simply
    // unknown. Treated identically to 'pending' rather than falling through to the no-layout
    // branch, which would otherwise reproduce BUG-B's original defect class for this one cause.
    expect(computeLockTargets(CALENDAR_ID, undefined, 'error')).toBeNull();
    expect(computeLockTargets(CALENDAR_ID, LAYOUT_ID, 'error')).toBeNull();
  });

  test('deterministic: same inputs, deep-equal output, called twice', () => {
    const a = computeLockTargets(CALENDAR_ID, LAYOUT_ID, 'success');
    const b = computeLockTargets(CALENDAR_ID, LAYOUT_ID, 'success');
    expect(a).toEqual(b);
    // Identity stability across re-renders is `useMemo`'s job, not this function's — it is a
    // plain function and returns a fresh array every call, which is exactly why `PlanningWizard`
    // wraps it in `useMemo(..., [calendarId, layout?.id, layoutQuery.status])` rather than calling
    // it inline.
  });
});

describe('lockTargetsKey — content identity, not reference identity', () => {
  test('a fresh array with the same content keys the same', () => {
    expect(lockTargetsKey(COMPLETE_SET)).toBe(lockTargetsKey([SEASON_CALENDAR, COLLECTION_LAYOUT]));
  });

  test('order does not matter, but the entities do', () => {
    expect(lockTargetsKey([COLLECTION_LAYOUT, SEASON_CALENDAR])).toBe(lockTargetsKey(COMPLETE_SET));
    expect(lockTargetsKey([SEASON_CALENDAR])).not.toBe(lockTargetsKey(COMPLETE_SET));
    expect(lockTargetsKey([SEASON_CALENDAR, { entityType: 'COLLECTION_LAYOUT', entityId: 'layout-2' }]))
      .not.toBe(lockTargetsKey(COMPLETE_SET));
  });

  test('an empty set keys to the empty string — which is why the key is never tested for truthiness', () => {
    // Pinned deliberately: `''` is falsy, so any caller branching on `!key` would read "a concrete,
    // empty target set" as "discovery has not settled". `reduceDiscovery` tests `targets === null`
    // instead, and the test below proves the two stay distinguishable.
    expect(lockTargetsKey([])).toBe('');
  });
});

/**
 * The discovery→session boundary as a table. Everything the reopened BUG-B got wrong is one row
 * here: what a `held` session is allowed to do when discovery changes under it.
 */
describe('reduceDiscovery — what each phase may do with a discovery result', () => {
  const ACQUIRING: WizardLockSession = {
    status: 'acquiring',
    targets: COMPLETE_SET,
    key: lockTargetsKey(COMPLETE_SET),
  };
  const HELD: WizardLockSession = {
    status: 'held',
    targets: COMPLETE_SET,
    key: lockTargetsKey(COMPLETE_SET),
    expiresAt: new Date('2026-09-01T10:00:00.000Z'),
    renewError: null,
    scopeChanged: false,
  };
  const OTHER_LAYOUT: LockTarget[] = [SEASON_CALENDAR, { entityType: 'COLLECTION_LAYOUT', entityId: 'layout-2' }];

  test('idle: waits while discovery is unsettled, opens a session once it settles', () => {
    expect(reduceDiscovery({ status: 'idle' }, true, null)).toEqual({ status: 'idle' });
    expect(reduceDiscovery({ status: 'idle' }, true, COMPLETE_SET)).toEqual(ACQUIRING);
  });

  test('acquiring: discovery is still authoritative — it may switch or stand the acquisition down', () => {
    // Same content, fresh array: not a change, and must not restart the acquisition.
    expect(reduceDiscovery(ACQUIRING, true, [SEASON_CALENDAR, COLLECTION_LAYOUT])).toBe(ACQUIRING);
    expect(reduceDiscovery(ACQUIRING, true, OTHER_LAYOUT)).toMatchObject({
      status: 'acquiring',
      targets: OTHER_LAYOUT,
    });
    expect(reduceDiscovery(ACQUIRING, true, null)).toEqual({ status: 'idle' });
  });

  test('held: an unsettled query is not information about the session', () => {
    // The reopened BUG-B in one assertion: `null` here used to tear down the acquire effect and
    // release the lock. It must be inert.
    expect(reduceDiscovery(HELD, true, null)).toBe(HELD);
  });

  test('held: re-resolving to the same set is inert', () => {
    expect(reduceDiscovery(HELD, true, [COLLECTION_LAYOUT, SEASON_CALENDAR])).toBe(HELD);
  });

  test('held: a different set is reported, never acted on — the granted targets are unchanged', () => {
    const next = reduceDiscovery(HELD, true, OTHER_LAYOUT);
    expect(next).toMatchObject({ status: 'held', scopeChanged: true });
    expect(next).toHaveProperty('targets', COMPLETE_SET); // still exactly what was granted
    // And it clears again if discovery comes back to the set the session actually holds.
    expect(reduceDiscovery(next, true, COMPLETE_SET)).toMatchObject({ scopeChanged: false });
  });

  test('held: a renew failure is left alone — the heartbeat is its only writer', () => {
    const renewFailed: WizardLockSession = { ...HELD, renewError: 'Sessione scaduta' };
    expect(reduceDiscovery(renewFailed, true, OTHER_LAYOUT)).toMatchObject({
      renewError: 'Sessione scaduta',
      scopeChanged: true,
    });
  });

  test('an empty concrete set is a settled answer, never "still unknown"', () => {
    // `lockTargetsKey([])` is `''`, so a falsiness check on the key would fold this into the
    // `null` branch: `idle` would keep waiting for a discovery that has already answered, and —
    // the case that actually costs something — a `held` session would read a set it demonstrably
    // does not hold as "no information" and report itself healthy instead of `scopeChanged`.
    expect(reduceDiscovery({ status: 'idle' }, true, [])).toEqual({
      status: 'acquiring',
      targets: [],
      key: '',
    });
    expect(reduceDiscovery(ACQUIRING, true, [])).toMatchObject({ status: 'acquiring', targets: [] });
    expect(reduceDiscovery(HELD, true, [])).toMatchObject({ status: 'held', scopeChanged: true });
    // Whereas `null` really is "unknown", and leaves each phase exactly where it was.
    expect(reduceDiscovery(HELD, true, null)).toBe(HELD);
  });

  test('lost: discovery cannot resurrect a session', () => {
    const lost: WizardLockSession = { status: 'lost', cause: 'expired', message: 'x', wasHeld: true };
    expect(reduceDiscovery(lost, true, COMPLETE_SET)).toBe(lost);
  });

  test('disabling ends the session from any phase, and is idempotent', () => {
    expect(reduceDiscovery(HELD, false, COMPLETE_SET)).toEqual({ status: 'idle' });
    expect(reduceDiscovery(ACQUIRING, false, null)).toEqual({ status: 'idle' });
    const idle: WizardLockSession = { status: 'idle' };
    expect(reduceDiscovery(idle, false, COMPLETE_SET)).toBe(idle);
  });
});

/** Deferred promise — lets a test control exactly when a mutation "resolves", from the outside. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A stable, per-test mutation double, declared via `vi.hoisted` so it exists before the `vi.mock`
 * factory below runs (both are hoisted above the module's imports, in this relative order).
 *
 * Real tRPC/tanstack `useMutation` returns a `mutateAsync`/`mutate` pair bound once to the query
 * observer for the component's lifetime (`MutationObserver` binds `this.mutate =
 * this.mutate.bind(this)` once in its constructor, and the hook stores that observer in
 * `useState` — see `@tanstack/react-query`'s `useMutation.ts`), not a new function every render.
 * `useWizardLock` depends on that: `acquireMany`/`renew`/`release` sit in its effect dependency
 * arrays, and a mock that handed back a new function each call would make those effects rerun on
 * every render for a reason that has nothing to do with the fix. A `vi.fn()` created once and
 * returned unchanged by the mocked `useMutation()` reproduces that stability.
 */
const { acquireManyMock, renewMock, releaseMock, formatErrorMock } = vi.hoisted(() => ({
  acquireManyMock: vi.fn<(input: { entities: unknown }) => Promise<{ expiresAt: string }[]>>(
    async () => {
      throw new Error('acquireManyMock: no resolution configured for this call');
    }
  ),
  renewMock: vi.fn<(input: { entities: unknown }) => Promise<{ expiresAt: string }[]>>(
    async () => {
      throw new Error('renewMock: no resolution configured for this call');
    }
  ),
  // `release` is consumed as `mutateAsync`, not `mutate`: the hook has to be able to *await* a
  // release before issuing the next acquisition, since `releaseLocks` is scoped only to
  // `(userId, entity)` server-side and would otherwise be free to land after — and delete — a
  // successor's grant. The double resolves so that ordering is observable here.
  releaseMock: vi.fn<(input: { entities: unknown }) => Promise<{ success: true }>>(async () => ({
    success: true,
  })),
  /**
   * Stands in for `getTrpcErrorMessage`. Real formatting is irrelevant to these tests — what this
   * double buys is the ability to make a queue step throw from somewhere the step does *not* guard:
   * the formatter runs inside the acquire step's own `catch`, so a throw there escapes the step
   * entirely. That is the one concrete escape route into the serialization queue, and the queue has
   * to survive it structurally rather than because every current step happens to be exhaustive.
   */
  formatErrorMock: vi.fn<(err: unknown) => string>((err) => String(err)),
}));

// `PlanningWizard.tsx` also imports `narrowRouterOutput` from this module (unused here — this
// file only imports `computeLockTargets`, and never renders `<PlanningWizard>`) — provided anyway
// so the mock's shape matches the real module and nothing breaks on that unused named import.
vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    editLock: {
      acquireMany: { useMutation: () => ({ mutateAsync: acquireManyMock }) },
      renew: { useMutation: () => ({ mutateAsync: renewMock }) },
      release: { useMutation: () => ({ mutateAsync: releaseMock }) },
    },
  },
  narrowRouterOutput: (value: unknown) => value,
}));

vi.mock('../../../../../../lib/trpcErrorMessages', () => ({
  getTrpcErrorMessage: formatErrorMock,
}));

function lockRecord(expiresAt: Date) {
  return [{ expiresAt: expiresAt.toISOString() }];
}

/**
 * Every lock RPC this hook issues goes through one serialization queue, so a release enqueued by a
 * cleanup lands a microtask (or more) after the cleanup itself returns. Assertions about it are
 * therefore `waitFor`, never synchronous — the alternative would be a hook that fires release
 * immediately, which is exactly the unordered behaviour these tests exist to forbid.
 */
async function expectReleaseCalls(times: number) {
  await vi.waitFor(() => expect(releaseMock).toHaveBeenCalledTimes(times));
}

interface WizardLockProps {
  targets: LockTarget[] | null;
  enabled: boolean;
}

/**
 * `renderHook`'s callback type is `(initialProps?: Props) => Result` — optional, because nothing
 * stops a caller from omitting `initialProps` entirely. Every call site below always supplies one,
 * but the callback still has to handle the `undefined` case to satisfy that signature; explicit
 * type arguments (rather than letting them be inferred from the `initialProps` object literal at
 * each call site) are what keep `targets: LockTarget[] | null` from narrowing to whatever the
 * first test happens to pass.
 */
function renderWizardLock(initialProps: WizardLockProps) {
  return renderHook<WizardLockProps, WizardLockSession>(
    (props) => useWizardLock(props?.targets ?? null, props?.enabled ?? false),
    { initialProps }
  );
}

type RenderedWizardLock = Awaited<ReturnType<typeof renderWizardLock>>;

/**
 * Narrows to the `held` variant, failing the test with the actual session if the lock is not held.
 * Every assertion about `expiresAt`/`renewError`/`scopeChanged` needs that narrowing anyway, and
 * doing it here keeps a wrong phase reported as "the session was X" rather than as an undefined
 * property read three lines later.
 */
function heldSession(session: WizardLockSession) {
  expect(session.status).toBe('held');
  if (session.status !== 'held') throw new Error('unreachable — asserted above');
  return session;
}

/** Resolves once the grant has landed and the hook has committed it — i.e. the lock is held. */
async function waitUntilHeld(hook: RenderedWizardLock) {
  await vi.waitFor(() => expect(hook.result.current.status).toBe('held'));
  return heldSession(hook.result.current);
}

describe('useWizardLock — acquisition, renewal and release lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    acquireManyMock.mockClear();
    renewMock.mockClear();
    releaseMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('cold cache: no acquisition while targets is null, exactly one once the complete set arrives', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(expiresAt));

    const hook = await renderWizardLock({ targets: null, enabled: true });

    expect(acquireManyMock).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('idle');

    // The transition PlanningWizard's memo produces once the layout query settles.
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect(acquireManyMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });

    const held = await waitUntilHeld(hook);
    expect(held.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(held.renewError).toBeNull();
    expect(held.scopeChanged).toBe(false);

    // Same reference again (an unrelated re-render upstream, e.g. `stepIndex` changing) must not
    // trigger a second acquisition.
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    await hook.unmount();
  });

  test('warm cache: layout already resolved at mount — one acquisition, complete set, no release/reacquire cycle', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(expiresAt));

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect(acquireManyMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
    expect(releaseMock).not.toHaveBeenCalled();

    await hook.rerender({ targets: COMPLETE_SET, enabled: true });
    expect(acquireManyMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).not.toHaveBeenCalled();

    await hook.unmount();
  });

  test('legitimate no-layout: locks SEASON_CALENDAR only, does not wait for a layout that will never arrive', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(expiresAt));
    const seasonOnly: LockTarget[] = [SEASON_CALENDAR];

    const hook = await renderWizardLock({ targets: seasonOnly, enabled: true });

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect(acquireManyMock).toHaveBeenCalledWith({ entities: seasonOnly });

    await hook.unmount();
  });

  test('renew fires with exactly the acquired set, not a re-derived one', async () => {
    const firstExpiry = new Date(Date.now() + 10_000);
    const renewedExpiry = new Date(Date.now() + 20_000);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(firstExpiry));
    renewMock.mockImplementationOnce(async () => lockRecord(renewedExpiry));

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect((await waitUntilHeld(hook)).expiresAt.getTime()).toBe(firstExpiry.getTime());

    // RENEW_FRACTION = 0.5 of the remaining TTL.
    await vi.advanceTimersByTimeAsync(5_001);

    await vi.waitFor(() => expect(renewMock).toHaveBeenCalledTimes(1));
    expect(renewMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
    await vi.waitFor(() =>
      expect(heldSession(hook.result.current).expiresAt.getTime()).toBe(renewedExpiry.getTime())
    );

    await hook.unmount();
  });

  // The acquire effect's cleanup can run relative to the in-flight `acquireMany` promise in either
  // order, and both must release exactly the granted set exactly once — never zero times (a leaked
  // lock) and never twice (a spurious release racing something else's legitimate hold).

  test('ordering A — acquisition resolves before cleanup: cleanup releases the frozen set once', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(expiresAt));

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    // Fully acquired and mounted — nothing released yet.
    await waitUntilHeld(hook);
    expect(releaseMock).not.toHaveBeenCalled();

    await hook.unmount();
    await expectReleaseCalls(1); // exactly once — not zero (leak), not twice
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
  });

  test('ordering B — cleanup runs before acquisition resolves: the cancelled continuation releases the just-granted set once', async () => {
    // A cleanup that only read `acquiredTargetsRef.current` would miss this ordering: the ref is
    // still null when cleanup runs, since acquisition hasn't populated it yet. The async
    // continuation's own `cancelled` check is what catches the grant once it lands late.
    const grant = deferred<ReturnType<typeof lockRecord>>();
    acquireManyMock.mockImplementationOnce(() => grant.promise);

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    await hook.unmount();

    // Nothing to release yet — the grant hasn't arrived, and acquiredTargetsRef was never set.
    expect(releaseMock).not.toHaveBeenCalled();

    // The server responds after the caller has already left.
    grant.resolve(lockRecord(new Date(Date.now() + 60_000)));
    await expectReleaseCalls(1); // exactly once, not orphaned
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
  });

  test('a failed acquisition surfaces an error and never calls renew', async () => {
    acquireManyMock.mockImplementationOnce(async () => {
      throw new Error('lock held by another session');
    });

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });

    await vi.waitFor(() => expect(hook.result.current.status).toBe('lost'));
    expect(hook.result.current).toMatchObject({ cause: 'acquire-failed', wasHeld: false });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled(); // nothing was ever acquired

    await hook.unmount();
  });
});

/**
 * BUG-B reopened (Cycle 4 regression): the Cycle 4 fix bound the whole lock lifecycle to the
 * discovery query's live output. `targets` sat in the acquire effect's dependency array, so *any*
 * later identity change — including the `null` that `computeLockTargets` returns whenever the
 * layout query leaves `'success'` — ran that effect's cleanup, which released the lock the wizard
 * was actively holding, and the re-run then saw `targets === null` and acquired nothing.
 *
 * `@tanstack/query-core`'s reducer sets `status: 'error'` unconditionally on a failed fetch, prior
 * success or not, so a single background-refetch blip is enough to reach that state mid-session.
 *
 * These assertions are deliberately expressed only through the tRPC mocks — how many times the
 * server was asked to acquire/renew/release, and with which entities — so they describe the lock
 * protocol rather than whatever shape the hook returns.
 */
describe('useWizardLock — the granted set survives discovery churn after acquisition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    acquireManyMock.mockClear();
    renewMock.mockClear();
    releaseMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('background discovery error after acquisition: no release, no reacquire, renew still targets the granted set', async () => {
    const firstExpiry = new Date(Date.now() + 10_000);
    const renewedExpiry = new Date(Date.now() + 20_000);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(firstExpiry));
    renewMock.mockImplementationOnce(async () => lockRecord(renewedExpiry));

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await waitUntilHeld(hook);

    // `collectionLayout.get` background-refetches and fails once. The user is mid-session; nothing
    // about their session actually changed, only the discovery query's status.
    await hook.rerender({ targets: null, enabled: true });

    expect(releaseMock).not.toHaveBeenCalled();
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    // The heartbeat must still renew exactly what was granted, not a re-derived set.
    await vi.advanceTimersByTimeAsync(5_001);
    await vi.waitFor(() => expect(renewMock).toHaveBeenCalledTimes(1));
    expect(renewMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });

    await hook.unmount();
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
  });

  test('background discovery success with the same layout: no release, no reacquire', async () => {
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 60_000)));

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await waitUntilHeld(hook);

    // A refetch that resolves to the same layout still produces a *fresh array* from
    // `computeLockTargets` — the caller's `useMemo` is keyed on the query status, which changed.
    await hook.rerender({ targets: [SEASON_CALENDAR, COLLECTION_LAYOUT], enabled: true });

    expect(releaseMock).not.toHaveBeenCalled();
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    await hook.unmount();
    await expectReleaseCalls(1);
  });

  test('background discovery resolving to a different layout id: still no release, no reacquire', async () => {
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 60_000)));

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await waitUntilHeld(hook);

    // Policy: the granted set is frozen. A layout the session never locked must not be silently
    // acquired, and the set the session *does* hold must not be released to go get it — either
    // move is a concurrency gap. The divergence is reported to the caller instead.
    const otherLayout: LockTarget = { entityType: 'COLLECTION_LAYOUT', entityId: 'layout-2' };
    await hook.rerender({ targets: [SEASON_CALENDAR, otherLayout], enabled: true });

    expect(releaseMock).not.toHaveBeenCalled();
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    await hook.unmount();
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
  });

  test('in-flight targets disappearing before the grant lands: late grant released exactly once', async () => {
    const grant = deferred<ReturnType<typeof lockRecord>>();
    acquireManyMock.mockImplementationOnce(() => grant.promise);

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));

    // Discovery backslides before anything was granted — no session exists to protect.
    await hook.rerender({ targets: null, enabled: true });
    expect(releaseMock).not.toHaveBeenCalled();

    grant.resolve(lockRecord(new Date(Date.now() + 60_000)));
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });

    await hook.unmount();
    await expectReleaseCalls(1); // still exactly once — the grant was never held
    expect(acquireManyMock).toHaveBeenCalledTimes(1); // and nothing reacquired it
  });

  test('a rejected heartbeat degrades the held session, then the backstop ends it', async () => {
    // The two must stay distinguishable: a rejected renew means "this session can no longer vouch
    // for a write", not yet "no lock is held" — the original deadline is still the honest one, so
    // the backstop, not the failure, is what ends the session.
    const expiry = new Date(Date.now() + 10_000);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(expiry));
    renewMock.mockImplementationOnce(async () => {
      throw new Error('Sessione scaduta o elemento ripreso da un altro utente');
    });

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await waitUntilHeld(hook);

    await vi.advanceTimersByTimeAsync(5_001);
    await vi.waitFor(() => expect(renewMock).toHaveBeenCalledTimes(1));

    await vi.waitFor(() => expect(heldSession(hook.result.current).renewError).not.toBeNull());
    // Still held, and on the original deadline — a rejected renew moves neither.
    expect(heldSession(hook.result.current).expiresAt.getTime()).toBe(expiry.getTime());
    expect(releaseMock).not.toHaveBeenCalled();

    // No retry storm either — the heartbeat stands down and lets the backstop decide.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(renewMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(hook.result.current.status).toBe('lost'));
    expect(hook.result.current).toMatchObject({ cause: 'expired', wasHeld: true });

    await hook.unmount();
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
  });

  test('discovery churn after expiry cannot restart or leak a session', async () => {
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 10_000)));
    renewMock.mockImplementationOnce(async () => {
      throw new Error('Sessione scaduta o elemento ripreso da un altro utente');
    });

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await waitUntilHeld(hook);
    await vi.advanceTimersByTimeAsync(10_001);
    await vi.waitFor(() => expect(hook.result.current.status).toBe('lost'));

    await hook.rerender({ targets: null, enabled: true });
    await hook.rerender({ targets: [SEASON_CALENDAR], enabled: true });
    expect(hook.result.current.status).toBe('lost');
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    await hook.unmount();
    await expectReleaseCalls(1);
  });

  test('disabling after acquisition releases the granted set exactly once', async () => {
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 60_000)));

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await waitUntilHeld(hook);

    await hook.rerender({ targets: COMPLETE_SET, enabled: false });
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });

    await hook.unmount();
    await expectReleaseCalls(1); // not released a second time on unmount
  });
});

/**
 * The serialization invariant, and the reason it is not merely "subtract what is already held".
 *
 * `releaseLocks` (`apps/api/src/services/editLock.service.ts`) deletes by `(lockedByUserId,
 * entityType, entityId)` — there is no acquisition or session token in the row, so the server
 * cannot tell one attempt's release from another attempt's grant *by the same user on the same
 * entity*. Two overlapping `acquireMany` calls from one hook instance are therefore inseparable at
 * the boundary: whichever release lands last wins, and it may well be the obsolete one, deleting a
 * row the live session depends on while the UI still reports a healthy lock.
 *
 * The frontend closes this without a protocol change by never having two in flight:
 *
 *   at most one acquireMany RPC is outstanding per hook instance, and a successor is not sent
 *   until its predecessor has settled and — if it was granted — been released.
 *
 * Discovery may change any number of times meanwhile; only the newest desired set is ever
 * acquired (latest-wins), and every superseded attempt in between is dropped before it reaches the
 * network. These tests assert the RPC sequence itself, since that is where the invariant lives.
 */
describe('useWizardLock — no two acquisitions in flight at once', () => {
  const seasonOnly: LockTarget[] = [SEASON_CALENDAR];
  const otherLayout: LockTarget = { entityType: 'COLLECTION_LAYOUT', entityId: 'layout-2' };
  const THIRD_SET: LockTarget[] = [SEASON_CALENDAR, otherLayout];

  beforeEach(() => {
    vi.useFakeTimers();
    acquireManyMock.mockClear();
    renewMock.mockClear();
    releaseMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Every `entities` argument the hook has sent to `acquireMany` so far, in call order. */
  function acquiredSets() {
    return acquireManyMock.mock.calls.map(([input]) => input.entities);
  }

  test('a discovery change during an in-flight acquisition does not send a second acquireMany', async () => {
    const firstGrant = deferred<ReturnType<typeof lockRecord>>();
    acquireManyMock.mockImplementationOnce(() => firstGrant.promise);

    const hook = await renderWizardLock({ targets: seasonOnly, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect(acquireManyMock).toHaveBeenNthCalledWith(1, { entities: seasonOnly });

    // The layout resolves while the calendar-only acquisition is still in flight. The desired set
    // is now the complete one — but A has not settled, so nothing may go out yet.
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });

    // Give any unserialized implementation every chance to fire: timers, microtasks, a re-render.
    await vi.advanceTimersByTimeAsync(1_000);
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });
    expect(acquireManyMock).toHaveBeenCalledTimes(1);
    expect(acquiredSets()).not.toContainEqual(COMPLETE_SET);
    expect(releaseMock).not.toHaveBeenCalled(); // and A is not released before it has even landed

    firstGrant.resolve(lockRecord(new Date(Date.now() + 60_000)));
    await hook.unmount();
  });

  test('the obsolete grant is released before the successor is sent, and never after it', async () => {
    const firstGrant = deferred<ReturnType<typeof lockRecord>>();
    const firstRelease = deferred<{ success: true }>();
    acquireManyMock.mockImplementationOnce(() => firstGrant.promise);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 60_000)));
    releaseMock.mockImplementationOnce(() => firstRelease.promise);

    const hook = await renderWizardLock({ targets: seasonOnly, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });

    // A lands after it became obsolete: its grant is real and must be handed back.
    firstGrant.resolve(lockRecord(new Date(Date.now() + 60_000)));
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenNthCalledWith(1, { entities: seasonOnly });

    // The release is issued but has not come back yet. Sending B now is exactly the unsafe case:
    // `releaseLocks` deletes by `(userId, entity)`, so an A-release still in flight can arrive
    // after B's upsert and delete the `SEASON_CALENDAR` row B was just granted. So B must wait for
    // the release to *complete*, not merely to have been called before it.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    firstRelease.resolve({ success: true });

    // Only now may the successor go out.
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(2));
    expect(acquireManyMock).toHaveBeenNthCalledWith(2, { entities: COMPLETE_SET });
    expect(releaseMock.mock.invocationCallOrder[0]!)
      .toBeLessThan(acquireManyMock.mock.invocationCallOrder[1]!);

    // B is granted and held — with the set B asked for, not A's.
    const held = await waitUntilHeld(hook);
    expect(held.targets).toEqual(COMPLETE_SET);

    // And nothing releases any entity of B while it is held: the only release so far is still A's.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(releaseMock).toHaveBeenCalledTimes(1);

    await hook.unmount();
    await expectReleaseCalls(2);
    expect(releaseMock).toHaveBeenLastCalledWith({ entities: COMPLETE_SET });
  });

  test('A → B → C while A is unresolved: only C is acquired, and only after A is released', async () => {
    const firstGrant = deferred<ReturnType<typeof lockRecord>>();
    acquireManyMock.mockImplementationOnce(() => firstGrant.promise);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 60_000)));

    const hook = await renderWizardLock({ targets: seasonOnly, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));

    // Discovery settles twice more before A comes back — latest wins, the intermediate never runs.
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });
    await hook.rerender({ targets: THIRD_SET, enabled: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    firstGrant.resolve(lockRecord(new Date(Date.now() + 60_000)));
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenNthCalledWith(1, { entities: seasonOnly });

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(2));
    expect(acquireManyMock).toHaveBeenNthCalledWith(2, { entities: THIRD_SET });
    // B was superseded before its turn came up and never reached the network at all.
    expect(acquiredSets()).not.toContainEqual(COMPLETE_SET);

    const held = await waitUntilHeld(hook);
    expect(held.targets).toEqual(THIRD_SET);

    await hook.unmount();
    await expectReleaseCalls(2);
    expect(releaseMock).toHaveBeenLastCalledWith({ entities: THIRD_SET });
  });

  test('targets going null while A is in flight: A released on its late grant, nothing started', async () => {
    const firstGrant = deferred<ReturnType<typeof lockRecord>>();
    acquireManyMock.mockImplementationOnce(() => firstGrant.promise);

    const hook = await renderWizardLock({ targets: seasonOnly, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));

    await hook.rerender({ targets: null, enabled: true });
    firstGrant.resolve(lockRecord(new Date(Date.now() + 60_000)));

    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenCalledWith({ entities: seasonOnly });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(acquireManyMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('idle');

    await hook.unmount();
    await expectReleaseCalls(1); // nothing else was ever held
  });

  test('a superseded attempt that fails does not stall the successor', async () => {
    // The queue must survive a rejected predecessor: a failed acquisition is a normal outcome
    // (CONFLICT from `acquireLocks`), and it must not leave every later attempt queued forever.
    const firstAttempt = deferred<ReturnType<typeof lockRecord>>();
    acquireManyMock.mockImplementationOnce(() => firstAttempt.promise);
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 60_000)));

    const hook = await renderWizardLock({ targets: seasonOnly, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });

    firstAttempt.reject(new Error('Elemento in modifica da un altro utente'));

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(2));
    expect(acquireManyMock).toHaveBeenNthCalledWith(2, { entities: COMPLETE_SET });
    // Nothing was granted, so nothing was released — and the obsolete failure is not surfaced as
    // this session's error either: the session it belonged to no longer exists.
    expect(releaseMock).not.toHaveBeenCalled();
    const held = await waitUntilHeld(hook);
    expect(held.targets).toEqual(COMPLETE_SET);

    await hook.unmount();
    await expectReleaseCalls(1);
  });

  test('reopening after a release does not overlap that release with the new acquisition', async () => {
    // `enabled` false → true on a mounted hook: the release enqueued by the close must *complete*
    // before the reopen's acquire is sent, or it deletes the row the reopened session just took.
    // Deferred, like the obsolete-grant test above: an instant release mock would leave this
    // passing against a fire-and-forget implementation, which is exactly the defect.
    const closeRelease = deferred<{ success: true }>();
    acquireManyMock.mockImplementation(async () => lockRecord(new Date(Date.now() + 60_000)));
    releaseMock.mockImplementationOnce(() => closeRelease.promise);

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });
    await waitUntilHeld(hook);
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    await hook.rerender({ targets: COMPLETE_SET, enabled: false });
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenNthCalledWith(1, { entities: COMPLETE_SET });

    // Reopened while the close's release is still outstanding.
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(acquireManyMock).toHaveBeenCalledTimes(1); // nothing may go out yet

    closeRelease.resolve({ success: true });

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(2));
    expect(releaseMock.mock.invocationCallOrder[0]!)
      .toBeLessThan(acquireManyMock.mock.invocationCallOrder[1]!);

    await waitUntilHeld(hook);
    await hook.unmount();
    await expectReleaseCalls(2);
  });

  test('an unexpected throw inside a queue step does not poison the queue', async () => {
    // The queue's non-rejection has to be structural. Every step today catches its own expected
    // failures, but the acquire step's `catch` formats the error — so a throw from *there* escapes
    // the step and rejects the chain. If nothing recovers it, every later `.then` is skipped: no
    // further acquisition, and — the part that actually costs something — no release on unmount,
    // leaking the lock until its server-side TTL.
    acquireManyMock.mockImplementationOnce(async () => {
      throw new Error('Elemento in modifica da un altro utente');
    });
    formatErrorMock.mockImplementationOnce(() => {
      throw new Error('unexpected: error formatting blew up');
    });
    acquireManyMock.mockImplementationOnce(async () => lockRecord(new Date(Date.now() + 60_000)));

    const hook = await renderWizardLock({ targets: seasonOnly, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));

    // The step has now thrown out. Discovery settles on a different set, enqueueing a new step.
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });

    // A poisoned chain would never run it.
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(2));
    expect(acquireManyMock).toHaveBeenNthCalledWith(2, { entities: COMPLETE_SET });
    const held = await waitUntilHeld(hook);
    expect(held.targets).toEqual(COMPLETE_SET);
    // Nothing was granted by the failed attempt, so nothing was released for it.
    expect(releaseMock).not.toHaveBeenCalled();

    // And cleanup still reaches the queue.
    await hook.unmount();
    await expectReleaseCalls(1);
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
  });
});
