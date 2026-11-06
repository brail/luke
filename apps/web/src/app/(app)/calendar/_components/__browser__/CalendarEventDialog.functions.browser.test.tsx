import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CalendarEventDialog } from '../CalendarEventDialog';

/**
 * `Visibile a` offers every active company function. It used to be handed the calendar page's
 * filter list, limited to the functions present on the loaded events, so an event could not be
 * made visible to a function no event used yet (#196).
 */

// One object per query result, reused across renders as react-query keeps a settled result stable.
const h = vi.hoisted(() => ({
  updateMock: vi.fn(),
  idleMutation: () => ({ mutate: () => undefined, isPending: false }),
  emptyList: { data: [], isLoading: false, isError: false },
  noData: { data: undefined, isLoading: false, isError: false },
  me: { data: { timezone: 'Europe/Rome' }, error: null },
  functions: {
    data: [
      { id: '00000000-0000-4000-8000-000000000001', name: 'Prodotto' },
      { id: '00000000-0000-4000-8000-000000000002', name: 'Sales' },
    ],
    isLoading: false,
    isError: false,
  },
}));

vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    phase: { list: { useQuery: () => h.emptyList } },
    planningGroup: { list: { useQuery: () => h.emptyList } },
    auditLog: { getLastChange: { useQuery: () => h.noData } },
    me: { get: { useQuery: () => h.me } },
    company: { profile: { get: { useQuery: () => h.noData } }, function: { list: { useQuery: () => h.functions } } },
    seasonCalendar: {
      createMilestone: { useMutation: h.idleMutation },
      updateMilestone: { useMutation: () => ({ mutate: h.updateMock, isPending: false }) },
      deleteMilestone: { useMutation: h.idleMutation },
      cancelMilestone: { useMutation: h.idleMutation },
      uncancelMilestone: { useMutation: h.idleMutation },
      rescheduleMilestone: { useMutation: h.idleMutation },
      listGrantCandidates: { useQuery: () => h.emptyList },
      grantUserVisibility: { useMutation: h.idleMutation },
      revokeUserVisibility: { useMutation: h.idleMutation },
    },
    useUtils: () => ({}),
  },
}));
vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'token' }, status: 'authenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

afterEach(() => h.updateMock.mockReset());

const [PRODOTTO, SALES] = h.functions.data.map(f => f.id);

type DialogEvent = NonNullable<Parameters<typeof CalendarEventDialog>[0]['event']>;

function renderDialog(event?: DialogEvent) {
  return render(
    <TooltipProvider delayDuration={0}>
      <CalendarEventDialog open onClose={() => undefined} onSaved={() => undefined} brandId="b1" seasonId="s1" event={event} />
    </TooltipProvider>,
  );
}

test('a new event can be made visible to a function no event uses yet', async () => {
  const screen = await renderDialog();

  await expect.element(screen.getByRole('checkbox', { name: 'Sales' })).toBeVisible();
});

test('an event can be shared with a function absent from it, and saved', async () => {
  const event: DialogEvent = {
    id: 'e1', title: 'Evento', startAt: '2026-03-10T09:00:00.000Z', allDay: false, publishExternally: true,
    visibilities: [{ functionId: PRODOTTO }],
  };
  const screen = await renderDialog(event);

  await screen.getByRole('checkbox', { name: 'Sales' }).click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => h.updateMock.mock.calls.length).toBe(1);
  // The mock records its arguments untyped; this is the shape `updateMilestone` takes.
  const { data } = h.updateMock.mock.calls[0]?.[0] as { data: { visibilityFunctionIds: string[] } };
  expect(data.visibilityFunctionIds).toEqual([PRODOTTO, SALES]);
});
