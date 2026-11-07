import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CalendarEventDialog } from '../CalendarEventDialog';

/**
 * `Visibile a` offers every active company function. It used to be handed the calendar page's
 * filter list, limited to the functions present on the loaded events, so an event could not be
 * made visible to a function no event used yet (#196). An inactive function shows only where the
 * event has it, by name, and can be removed; a save the server refuses because the event would
 * leave the saver's calendar asks before it is sent again as confirmed (#199).
 */

const HIDDEN_MESSAGE = "Così l'evento non comparirà nel tuo calendario: non fai parte di nessuna delle sue funzioni e non ti è condiviso.";

// One object per query result, reused across renders as react-query keeps a settled result stable.
const h = vi.hoisted(() => ({
  updateMock: vi.fn(),
  /** When set, the update mutation answers an unconfirmed save as the server does for #199. */
  refuseUnconfirmed: false,
  idleMutation: () => ({ mutate: () => undefined, isPending: false }),
  emptyList: { data: [], isLoading: false, isError: false },
  noData: { data: undefined, isLoading: false, isError: false },
  me: { data: { timezone: 'Europe/Rome' }, error: null },
  functions: {
    data: [
      { id: '00000000-0000-4000-8000-000000000001', name: 'Prodotto', isActive: true },
      { id: '00000000-0000-4000-8000-000000000002', name: 'Sales', isActive: true },
      { id: '00000000-0000-4000-8000-000000000003', name: 'Vecchia', isActive: false },
    ],
    isLoading: false,
    isError: false,
  },
}));

type UpdateOptions = { onError?: (err: unknown, variables: { confirmHidesFromCaller?: boolean }) => void };

vi.mock('../../../../../lib/trpc', async () => {
  const { TRPCClientError } = await import('@trpc/client');
  // `TRPCClientError` keeps the response shape it is given; the prompt reads only `data.code`.
  const refusal = () => TRPCClientError.from({ error: { code: -1, message: HIDDEN_MESSAGE, data: { code: 'PRECONDITION_REQUIRED' } } } as never);
  return { trpc: {
    phase: { list: { useQuery: () => h.emptyList } },
    planningGroup: { list: { useQuery: () => h.emptyList } },
    auditLog: { getLastChange: { useQuery: () => h.noData } },
    me: { get: { useQuery: () => h.me } },
    company: { profile: { get: { useQuery: () => h.noData } }, function: { list: { useQuery: () => h.functions } } },
    seasonCalendar: {
      createMilestone: { useMutation: h.idleMutation },
      updateMilestone: {
        useMutation: (options: UpdateOptions) => ({
          mutate: (variables: { confirmHidesFromCaller?: boolean }) => {
            h.updateMock(variables);
            if (h.refuseUnconfirmed && !variables.confirmHidesFromCaller) {
              options.onError?.(refusal(), variables);
            }
          },
          isPending: false,
        }),
      },
      deleteMilestone: { useMutation: h.idleMutation },
      cancelMilestone: { useMutation: h.idleMutation },
      uncancelMilestone: { useMutation: h.idleMutation },
      rescheduleMilestone: { useMutation: h.idleMutation },
      listGrantCandidates: { useQuery: () => h.emptyList },
      grantUserVisibility: { useMutation: h.idleMutation },
      revokeUserVisibility: { useMutation: h.idleMutation },
    },
    useUtils: () => ({}),
  } };
});
vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'token' }, status: 'authenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

afterEach(() => {
  h.updateMock.mockReset();
  h.refuseUnconfirmed = false;
});

const [PRODOTTO, SALES, VECCHIA] = h.functions.data.map(f => f.id);

type DialogEvent = NonNullable<Parameters<typeof CalendarEventDialog>[0]['event']>;

function eventVisibleTo(functionIds: string[]): DialogEvent {
  return {
    id: 'e1', title: 'Evento', startAt: '2026-03-10T09:00:00.000Z', allDay: false, publishExternally: true,
    visibilities: functionIds.map(functionId => ({ functionId })),
  };
}

function renderDialog(event?: DialogEvent, readOnly = false) {
  return render(
    <TooltipProvider delayDuration={0}>
      <CalendarEventDialog open onClose={() => undefined} onSaved={() => undefined} brandId="b1" seasonId="s1" event={event} readOnly={readOnly} />
    </TooltipProvider>,
  );
}

/** The `data` of the `n`-th save sent, in the shape `updateMilestone` takes. */
function sentData(n = 0) {
  // The mock records its arguments untyped; this is the shape `updateMilestone` takes.
  return (h.updateMock.mock.calls[n]?.[0] as { data: { visibilityFunctionIds: string[] } }).data;
}

test('a new event can be made visible to a function no event uses yet, but not to an inactive one', async () => {
  const screen = await renderDialog();

  await expect.element(screen.getByRole('checkbox', { name: 'Sales' })).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /Vecchia/ }).query()).toBeNull();
});

test('an event can be shared with a function absent from it, and saved', async () => {
  const screen = await renderDialog(eventVisibleTo([PRODOTTO]));

  await screen.getByRole('checkbox', { name: 'Sales' }).click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => h.updateMock.mock.calls.length).toBe(1);
  expect(sentData().visibilityFunctionIds).toEqual([PRODOTTO, SALES]);
});

test('a save that would hide the event from the saver asks first; Annulla keeps the dialog open', async () => {
  h.refuseUnconfirmed = true;
  const screen = await renderDialog(eventVisibleTo([PRODOTTO]));

  await screen.getByRole('button', { name: 'Salva' }).click();
  await expect.element(screen.getByText(HIDDEN_MESSAGE)).toBeVisible();
  await screen.getByRole('button', { name: 'Annulla' }).click();

  await expect.element(screen.getByText(HIDDEN_MESSAGE)).not.toBeInTheDocument();
  await expect.element(screen.getByRole('button', { name: 'Salva' })).toBeVisible();
  expect(h.updateMock).toHaveBeenCalledTimes(1);
});

test('confirming sends the same save again, marked as confirmed', async () => {
  h.refuseUnconfirmed = true;
  const screen = await renderDialog(eventVisibleTo([PRODOTTO]));

  await screen.getByRole('button', { name: 'Salva' }).click();
  await screen.getByRole('button', { name: 'Salva comunque' }).click();

  await expect.poll(() => h.updateMock.mock.calls.length).toBe(2);
  // The mock records its arguments untyped; both are `updateMilestone` inputs, compared whole.
  const [first, second] = h.updateMock.mock.calls.map(call => call[0] as Record<string, unknown>);
  expect(second).toEqual({ ...first, confirmHidesFromCaller: true });
});

test('an inactive function on the event is shown by name and can be removed', async () => {
  const screen = await renderDialog(eventVisibleTo([VECCHIA, PRODOTTO]));

  const inactive = screen.getByRole('checkbox', { name: 'Vecchia (inattiva)' });
  await expect.element(inactive).toBeChecked();
  await inactive.click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.poll(() => h.updateMock.mock.calls.length).toBe(1);
  expect(sentData().visibilityFunctionIds).toEqual([PRODOTTO]);
});

test('an inactive function that is the only one needs another in its place', async () => {
  const screen = await renderDialog(eventVisibleTo([VECCHIA]));

  await screen.getByRole('checkbox', { name: 'Vecchia (inattiva)' }).click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await expect.element(screen.getByText('Seleziona almeno una funzione')).toBeVisible();
  expect(h.updateMock).not.toHaveBeenCalled();
});

test('the read-only view names an inactive function', async () => {
  const screen = await renderDialog(eventVisibleTo([VECCHIA]), true);

  await expect.element(screen.getByText('Vecchia (inattiva)')).toBeVisible();
});
