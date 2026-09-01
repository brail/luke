import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { PlanningWizard } from '../PlanningWizard';
import { EXPIRED_MESSAGE, SCOPE_CHANGED_MESSAGE } from '../useWizardLock';

import type { CalendarEventItem } from '../../types';

/**
 * BUG-B, gap 1 and gap 2: proves the invariant at the real `PlanningWizard` boundary, not only at
 * the `useWizardLock` hook level (`wizardLock.browser.test.tsx` covers the hook and
 * `computeLockTargets` in isolation).
 *
 *   unresolved targets OR acquisition in flight → wizard not usable
 *   acquisition succeeds                        → wizard usable
 *   acquisition fails, or discovery itself fails → existing error path, never usable
 *
 * "Usable" is read off the real DOM: whether the current event's content is rendered and whether
 * Next/Indietro are enabled — not off internal state, since the whole point is what a user could
 * actually do before the fix (BUG-B's failure was invisible at the `useWizardLock` level too,
 * until this exact boundary was exercised).
 */

const CALENDAR_ID = 'calendar-1';
const BRAND_ID = 'brand-1';
const SEASON_ID = 'season-1';
const PLANNING_GROUP_ID = 'group-1';

const EVENTS: CalendarEventItem[] = [
  {
    id: 'event-1',
    title: 'Consegna materiali',
    startAt: '2026-09-01T00:00:00.000Z',
    allDay: true,
    publishExternally: false,
    visibilities: [],
    planningGroupId: PLANNING_GROUP_ID,
  },
  {
    id: 'event-2',
    title: 'Fine produzione',
    startAt: '2026-09-15T00:00:00.000Z',
    allDay: true,
    publishExternally: false,
    visibilities: [],
    planningGroupId: PLANNING_GROUP_ID,
  },
];

/** Deferred promise — lets a test control exactly when a mutation/query "resolves". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const {
  acquireManyMock,
  renewMock,
  releaseMock,
  updateMilestoneMock,
  layoutQueryState,
  toastErrorMock,
} = vi.hoisted(() => ({
  acquireManyMock: vi.fn<(input: { entities: unknown }) => Promise<{ expiresAt: string }[]>>(
    async () => {
      throw new Error('acquireManyMock: no resolution configured for this call');
    }
  ),
  renewMock: vi.fn<(input: { entities: unknown }) => Promise<{ expiresAt: string }[]>>(async () => {
    throw new Error('renewMock: not used by these tests');
  }),
  releaseMock: vi.fn<(input: { entities: unknown }) => Promise<{ success: true }>>(async () => ({
    success: true,
  })),
  updateMilestoneMock: vi.fn<(input: unknown) => Promise<unknown>>(async () => {
    throw new Error('updateMilestoneMock: not used by these tests — Next stays disabled throughout');
  }),
  // Mutable, read fresh by the mocked `useQuery` on every `PlanningWizard` render — driven by
  // `setLayoutQuery` + `rerender()` in each test, the same way the real query would transition.
  layoutQueryState: {
    status: 'pending' as 'pending' | 'error' | 'success',
    data: undefined as { id: string; groups: never[] } | null | undefined,
    isPending: true,
    isError: false,
    error: null as unknown,
  },
  toastErrorMock: vi.fn(),
}));

function setLayoutQuery(next: Partial<typeof layoutQueryState>) {
  Object.assign(layoutQueryState, next);
}

// Only the routers `PlanningWizard` and its direct children (`useVendorClosures`) actually call.
// `narrowRouterOutput` is provided because `PlanningWizard.tsx` imports it from the same module.
vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    collectionLayout: { get: { useQuery: () => layoutQueryState } },
    editLock: {
      acquireMany: { useMutation: () => ({ mutateAsync: acquireManyMock }) },
      renew: { useMutation: () => ({ mutateAsync: renewMock }) },
      // `mutateAsync`, matching `useWizardLock`: a release has to be awaitable so it can be
      // ordered before the next acquisition on the same hook instance.
      release: { useMutation: () => ({ mutateAsync: releaseMock }) },
    },
    seasonCalendar: {
      updateMilestone: {
        useMutation: () => ({ mutateAsync: updateMilestoneMock, isPending: false }),
      },
    },
    holidays: { listVendorClosuresBatch: { useQuery: () => ({ data: [] }) } },
  },
  narrowRouterOutput: (value: unknown) => value,
}));

// `PlanningWizard.tsx` calls `toast.error` directly (mutation `onError`, expiry). A real toast
// needs no DOM assertions here — the point of these tests is the gating, not the notification.
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));

// Real `PlanningWizard` renders a `Tooltip` once the lock is acquired (the session-expiry hint) —
// `TooltipProvider` is mounted once app-wide in `components/Providers.tsx`; a real render outside
// it throws, so it is provided here the same way `PermissionControls.browser.test.tsx` does.
function wizardElement(onClose: () => void = () => undefined) {
  return (
    <TooltipProvider delayDuration={0}>
      <PlanningWizard
        open
        onClose={onClose}
        onFrozen={() => undefined}
        calendarId={CALENDAR_ID}
        planningGroupId={PLANNING_GROUP_ID}
        brandId={BRAND_ID}
        seasonId={SEASON_ID}
        events={EVENTS}
        holidayDates={new Map()}
      />
    </TooltipProvider>
  );
}

function renderWizard(onClose?: () => void) {
  return render(wizardElement(onClose));
}

describe('PlanningWizard — readiness gating at the component boundary', () => {
  beforeEach(() => {
    acquireManyMock.mockReset();
    renewMock.mockReset();
    releaseMock.mockReset();
    updateMilestoneMock.mockReset();
    toastErrorMock.mockReset();
    setLayoutQuery({ status: 'pending', data: undefined, isPending: true, isError: false, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('cold layout pending → not usable: no event content, Next and Indietro disabled', async () => {
    const screen = await renderWizard();

    await expect
      .element(screen.getByText('Preparazione sessione di pianificazione…'))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain(EVENTS[0]!.title);
    await expect.element(screen.getByRole('button', { name: 'Avanti' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Indietro' })).toBeDisabled();
    expect(acquireManyMock).not.toHaveBeenCalled();
  });

  test('layout resolves but acquireMany is still pending → still not usable', async () => {
    const screen = await renderWizard();
    const grant = deferred<{ expiresAt: string }[]>();
    acquireManyMock.mockImplementationOnce(() => grant.promise);

    setLayoutQuery({ status: 'success', data: null, isPending: false, isError: false, error: null });
    await screen.rerender(wizardElement());

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect(acquireManyMock).toHaveBeenCalledWith({
      entities: [{ entityType: 'SEASON_CALENDAR', entityId: CALENDAR_ID }],
    });

    // Still not usable — the grant hasn't landed yet.
    await expect
      .element(screen.getByText('Preparazione sessione di pianificazione…'))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain(EVENTS[0]!.title);
    await expect.element(screen.getByRole('button', { name: 'Avanti' })).toBeDisabled();

    grant.resolve([{ expiresAt: new Date(Date.now() + 60_000).toISOString() }]);
  });

  test('acquireMany resolves successfully → wizard becomes usable', async () => {
    setLayoutQuery({ status: 'success', data: null, isPending: false, isError: false, error: null });
    acquireManyMock.mockResolvedValueOnce([
      { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    ]);

    const screen = await renderWizard();

    await expect
      .element(screen.getByText(EVENTS[0]!.title))
      .toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Avanti' })).toBeEnabled();
    await expect.element(screen.getByRole('button', { name: 'Indietro' })).toBeDisabled(); // step 0
    expect(screen.container.textContent).not.toContain('Preparazione sessione');
  });
});

describe('PlanningWizard — layout query error vs. legitimate no-layout', () => {
  beforeEach(() => {
    acquireManyMock.mockReset();
    renewMock.mockReset();
    releaseMock.mockReset();
    toastErrorMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('success with null: calendar-only acquisition, wizard still becomes usable', async () => {
    setLayoutQuery({ status: 'success', data: null, isPending: false, isError: false, error: null });
    acquireManyMock.mockResolvedValueOnce([
      { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    ]);

    const screen = await renderWizard();

    await vi.waitFor(() => expect(acquireManyMock).toHaveBeenCalledTimes(1));
    expect(acquireManyMock).toHaveBeenCalledWith({
      entities: [{ entityType: 'SEASON_CALENDAR', entityId: CALENDAR_ID }],
    });
    await expect.element(screen.getByText(EVENTS[0]!.title)).toBeVisible();
  });

  test('layout query error: zero acquisition, wizard stays unusable, error surfaced', async () => {
    setLayoutQuery({
      status: 'error',
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'Errore di rete' },
    });

    const screen = await renderWizard();

    // Discovery failed — the complete target set is unknown, so no lock is ever attempted.
    expect(acquireManyMock).not.toHaveBeenCalled();
    await expect.element(screen.getByText('Errore di rete')).toBeVisible();
    expect(screen.container.textContent).not.toContain('Preparazione sessione');
    expect(screen.container.textContent).not.toContain(EVENTS[0]!.title);
    await expect.element(screen.getByRole('button', { name: 'Avanti' })).toBeDisabled();
  });
});

/**
 * BUG-B reopened (Cycle 4 regression), at the component boundary.
 *
 * `PlanningWizard` collapsed three different things into one `displayError`: a discovery failure
 * that happened *before* any session existed, a background query failure *after* the session was
 * already usable, and an actual lock loss. Only the first proves there cannot be unsaved user
 * edits, yet all three took the confirmation-free exit — so a single background refetch blip could
 * discard a user's in-progress date edit on a click they thought was a plain dismissal.
 */
describe('PlanningWizard — discovery failure before vs. after the session became usable', () => {
  beforeEach(() => {
    acquireManyMock.mockReset();
    renewMock.mockReset();
    releaseMock.mockReset();
    updateMilestoneMock.mockReset();
    toastErrorMock.mockReset();
    setLayoutQuery({ status: 'pending', data: undefined, isPending: true, isError: false, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Renders, resolves discovery + the grant, and returns once the wizard is usable. */
  async function renderUsableWizard(onClose?: () => void) {
    setLayoutQuery({ status: 'success', data: null, isPending: false, isError: false, error: null });
    acquireManyMock.mockResolvedValueOnce([
      { expiresAt: new Date(Date.now() + 60_000).toISOString() },
    ]);
    const screen = await renderWizard(onClose);
    await expect.element(screen.getByText(EVENTS[0]!.title)).toBeVisible();
    return screen;
  }

  /** The background refetch that BUG-B's reopened defect turns into a lost lock. */
  async function failLayoutRefetch(screen: Awaited<ReturnType<typeof renderWizard>>, onClose?: () => void) {
    setLayoutQuery({
      status: 'error',
      data: null,
      isPending: false,
      isError: true,
      error: { message: 'Errore di rete' },
    });
    await screen.rerender(wizardElement(onClose));
  }

  test('background refetch error after readiness: session survives, wizard stays usable, nothing released', async () => {
    const screen = await renderUsableWizard();

    await failLayoutRefetch(screen);

    // The lock is untouched: the discovery query failing says nothing about whether this session
    // still holds `SEASON_CALENDAR`.
    expect(releaseMock).not.toHaveBeenCalled();
    expect(acquireManyMock).toHaveBeenCalledTimes(1);

    // And the user keeps the session they were already working in.
    await expect.element(screen.getByText(EVENTS[0]!.title)).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Avanti' })).toBeEnabled();
  });

  test('background refetch error after readiness: closing still asks for confirmation', async () => {
    let closed = 0;
    const onClose = () => { closed += 1; };
    const screen = await renderUsableWizard(onClose);

    await failLayoutRefetch(screen, onClose);
    await screen.getByRole('button', { name: 'Annulla' }).click();

    // A step was rendered, so a draft date could have been edited — the exit must be confirmed.
    await expect
      .element(screen.getByText('Uscire dalla pianificazione guidata?'))
      .toBeVisible();
    expect(closed).toBe(0);
  });

  test('layout id changes mid-session: lock kept as granted, mutation blocked, exit still confirmed', async () => {
    // The explicit policy for a genuinely different dependency set: neither release-and-reacquire
    // (a concurrency gap) nor extend-in-place (BUG-B's original defect class). The session keeps
    // exactly what it holds and says so, and the user's unsaved work is still protected on exit.
    const screen = await renderUsableWizard();

    setLayoutQuery({
      status: 'success',
      data: { id: 'layout-2', groups: [] },
      isPending: false,
      isError: false,
      error: null,
    });
    await screen.rerender(wizardElement());

    expect(releaseMock).not.toHaveBeenCalled();
    expect(acquireManyMock).toHaveBeenCalledTimes(1);
    expect(acquireManyMock).toHaveBeenCalledWith({
      entities: [{ entityType: 'SEASON_CALENDAR', entityId: CALENDAR_ID }],
    });

    await expect.element(screen.getByText(SCOPE_CHANGED_MESSAGE)).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Avanti' })).toBeDisabled();
    expect(updateMilestoneMock).not.toHaveBeenCalled();

    await screen.getByRole('button', { name: 'Annulla' }).click();
    await expect
      .element(screen.getByText('Uscire dalla pianificazione guidata?'))
      .toBeVisible();
  });

  test('a degraded session cannot be navigated: Indietro is disabled behind the error banner', async () => {
    // The step body renders only under a session that can still vouch for a write. Leaving
    // Indietro enabled once the banner replaces it lets `stepIndex` move under content the user
    // cannot see — and if the degradation later clears, they resume on a different event than the
    // one they were editing.
    const screen = await renderUsableWizard();

    // Step 2, so `stepIndex === 0` is not what disables the button in the assertion below.
    await screen.getByRole('button', { name: 'Avanti' }).click();
    await expect.element(screen.getByText(EVENTS[1]!.title)).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Indietro' })).toBeEnabled();

    setLayoutQuery({
      status: 'success',
      data: { id: 'layout-2', groups: [] },
      isPending: false,
      isError: false,
      error: null,
    });
    await screen.rerender(wizardElement());

    await expect.element(screen.getByText(SCOPE_CHANGED_MESSAGE)).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Indietro' })).toBeDisabled();
    // And the step really did not move: the event heading is gone, not swapped for event 1's.
    expect(screen.container.textContent).not.toContain(EVENTS[0]!.title);
  });

  test('discovery error before the session was ever usable: closing skips the confirmation', async () => {
    // The sanctioned bypass, kept: `EventStep` never rendered, so no draft date can exist.
    setLayoutQuery({
      status: 'error',
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'Errore di rete' },
    });
    let closed = 0;
    const screen = await renderWizard(() => { closed += 1; });

    await expect.element(screen.getByText('Errore di rete')).toBeVisible();
    await screen.getByRole('button', { name: 'Annulla' }).click();

    expect(closed).toBe(1);
    expect(screen.container.textContent).not.toContain('Uscire dalla pianificazione guidata?');
  });
});

/**
 * Expiry is a lifecycle transition, not a rendering concern. It used to be handled in the render
 * body — `toast.error(...)` plus `onClose()` before `return null` — which calls the parent's
 * setState during this component's render (`onClose` is `setPostApplyWizard(null)` in
 * `calendar/page.tsx`) and fires the notification once per render attempt rather than once per
 * expiry. React's double-invoked render under `StrictMode` is the cheap, deterministic way to
 * observe exactly that, so it is what these tests render under.
 */
describe('PlanningWizard — session expiry closes once and notifies once', () => {
  beforeEach(() => {
    acquireManyMock.mockReset();
    renewMock.mockReset();
    releaseMock.mockReset();
    updateMilestoneMock.mockReset();
    toastErrorMock.mockReset();
    setLayoutQuery({ status: 'success', data: null, isPending: false, isError: false, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A grant whose TTL has already elapsed: the hook commits it as `held`, and the heartbeat
   * effect's own `msRemaining <= 0` branch ends the session on the next tick. Same transition the
   * backstop timer produces, without depending on timer control inside a real browser render.
   */
  function grantAlreadyExpired() {
    acquireManyMock.mockResolvedValueOnce([
      { expiresAt: new Date(Date.now() - 1_000).toISOString() },
    ]);
  }

  test('one expiry transition → one toast and one onClose, under StrictMode', async () => {
    grantAlreadyExpired();
    let closed = 0;
    const screen = await render(
      <StrictMode>{wizardElement(() => { closed += 1; })}</StrictMode>
    );

    await vi.waitFor(() => expect(closed).toBe(1));
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(EXPIRED_MESSAGE);
    expect(screen.container.textContent).not.toContain(EVENTS[0]!.title);

    // Still exactly one after the tree has settled — a render-body call would keep firing for as
    // long as the parent leaves the wizard mounted.
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(closed).toBe(1);
  });

  test('re-rendering an expired wizard does not close or notify again', async () => {
    grantAlreadyExpired();
    let closed = 0;
    const onClose = () => { closed += 1; };
    const screen = await render(<StrictMode>{wizardElement(onClose)}</StrictMode>);

    await vi.waitFor(() => expect(closed).toBe(1));

    // The parent has not unmounted it yet (its own state update is still in flight) and something
    // unrelated re-renders — discovery refetching, for instance.
    setLayoutQuery({ status: 'error', data: null, isPending: false, isError: true, error: { message: 'x' } });
    await screen.rerender(<StrictMode>{wizardElement(onClose)}</StrictMode>);

    expect(closed).toBe(1);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});
