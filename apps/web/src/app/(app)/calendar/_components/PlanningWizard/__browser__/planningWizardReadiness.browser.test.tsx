import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { PlanningWizard } from '../PlanningWizard';

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
  releaseMock: vi.fn<(input: { entities: unknown }) => void>(() => undefined),
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
      release: { useMutation: () => ({ mutate: releaseMock }) },
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
function wizardElement() {
  return (
    <TooltipProvider delayDuration={0}>
      <PlanningWizard
        open
        onClose={() => undefined}
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

function renderWizard() {
  return render(wizardElement());
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
