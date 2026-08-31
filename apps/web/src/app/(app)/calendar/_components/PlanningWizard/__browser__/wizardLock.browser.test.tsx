import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { computeLockTargets, useWizardLock } from '../useWizardLock';

import type { LockTarget } from '../useWizardLock';

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
const { acquireManyMock, renewMock, releaseMock } = vi.hoisted(() => ({
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
  releaseMock: vi.fn<(input: { entities: unknown }) => void>(() => undefined),
}));

// `PlanningWizard.tsx` also imports `narrowRouterOutput` from this module (unused here — this
// file only imports `computeLockTargets`, and never renders `<PlanningWizard>`) — provided anyway
// so the mock's shape matches the real module and nothing breaks on that unused named import.
vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    editLock: {
      acquireMany: { useMutation: () => ({ mutateAsync: acquireManyMock }) },
      renew: { useMutation: () => ({ mutateAsync: renewMock }) },
      release: { useMutation: () => ({ mutate: releaseMock }) },
    },
  },
  narrowRouterOutput: (value: unknown) => value,
}));

function lockRecord(expiresAt: Date) {
  return [{ expiresAt: expiresAt.toISOString() }];
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
  return renderHook<WizardLockProps, ReturnType<typeof useWizardLock>>(
    (props) => useWizardLock(props?.targets ?? null, props?.enabled ?? false),
    { initialProps }
  );
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
    expect(hook.result.current.expiresAt).toBeNull();
    expect(hook.result.current.error).toBeNull();

    // The transition PlanningWizard's memo produces once the layout query settles.
    await hook.rerender({ targets: COMPLETE_SET, enabled: true });
    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect(acquireManyMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });

    await vi.waitFor(() => expect(hook.result.current.expiresAt).not.toBeNull());
    expect(hook.result.current.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(hook.result.current.error).toBeNull();

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
    await vi.waitFor(() => expect(hook.result.current.expiresAt?.getTime()).toBe(firstExpiry.getTime()));

    // RENEW_FRACTION = 0.5 of the remaining TTL.
    await vi.advanceTimersByTimeAsync(5_001);

    await vi.waitFor(() => expect(renewMock).toHaveBeenCalledTimes(1));
    expect(renewMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
    await vi.waitFor(() => expect(hook.result.current.expiresAt?.getTime()).toBe(renewedExpiry.getTime()));

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
    await vi.waitFor(() => expect(hook.result.current.expiresAt).not.toBeNull());
    expect(releaseMock).not.toHaveBeenCalled();

    await hook.unmount();
    expect(releaseMock).toHaveBeenCalledTimes(1); // exactly once — not zero (leak), not twice
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
    await vi.waitFor(() => expect(releaseMock).toHaveBeenCalledTimes(1)); // exactly once, not orphaned
    expect(releaseMock).toHaveBeenCalledWith({ entities: COMPLETE_SET });
  });

  test('a failed acquisition surfaces an error and never calls renew', async () => {
    acquireManyMock.mockImplementationOnce(async () => {
      throw new Error('lock held by another session');
    });

    const hook = await renderWizardLock({ targets: COMPLETE_SET, enabled: true });

    await vi.waitFor(() => expect(hook.result.current.error).not.toBeNull());
    expect(hook.result.current.expiresAt).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled(); // nothing was ever acquired

    await hook.unmount();
  });
});
