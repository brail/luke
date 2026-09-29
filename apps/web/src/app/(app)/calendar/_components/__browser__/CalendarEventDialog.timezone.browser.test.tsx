import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CalendarEventDialog } from '../CalendarEventDialog';

/**
 * The event dialog mounted under each zone of `vitest.browser.timezone.config.mts`: what the form
 * loads from an event and what it writes back on save. The form always resubmits its dates, so a
 * wrong read is a silent write — an all-day event read with local getters moved back a day west of
 * UTC on any save.
 */

// Every query result is one object reused across renders, the way react-query keeps a settled
// result stable: a fresh `[]` per render feeds the dialog's effects a new value every time.
const { updateMock, idleMutation, emptyList, noData } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  idleMutation: () => ({ mutate: () => undefined, isPending: false }),
  emptyList: { data: [], isLoading: false, isError: false },
  noData: { data: undefined, isLoading: false, isError: false },
}));

// Only what the dialog and its children call while rendering.
vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    phase: { list: { useQuery: () => emptyList } },
    planningGroup: { list: { useQuery: () => emptyList } },
    auditLog: { getLastChange: { useQuery: () => noData } },
    me: { get: { useQuery: () => noData } },
    company: { profile: { get: { useQuery: () => noData } } },
    seasonCalendar: {
      createMilestone: { useMutation: idleMutation },
      updateMilestone: { useMutation: () => ({ mutate: updateMock, isPending: false }) },
      deleteMilestone: { useMutation: idleMutation },
      cancelMilestone: { useMutation: idleMutation },
      uncancelMilestone: { useMutation: idleMutation },
      rescheduleMilestone: { useMutation: idleMutation },
      listGrantCandidates: { useQuery: () => emptyList },
      grantUserVisibility: { useMutation: idleMutation },
      revokeUserVisibility: { useMutation: idleMutation },
    },
    useUtils: () => ({}),
  },
}));

vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
// `LastModifiedBy` formats through `useFormatDate`, which reads the session.
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

afterEach(() => updateMock.mockReset());

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
// The form validates visibility ids as uuids.
const FUNCTION_ID = '00000000-0000-4000-8000-000000000001';

type DialogEvent = NonNullable<Parameters<typeof CalendarEventDialog>[0]['event']>;

function dialogEvent(fields: Partial<DialogEvent>): DialogEvent {
  return { id: 'e1', title: 'Evento', startAt: '', allDay: false, publishExternally: true, visibilities: [{ functionId: FUNCTION_ID }], ...fields };
}

function renderDialog(event: DialogEvent, readOnly = false) {
  return render(
    <TooltipProvider delayDuration={0}>
      <CalendarEventDialog open onClose={() => undefined} onSaved={() => undefined} brandId="b1" seasonId="s1"
        availableFunctions={[{ id: FUNCTION_ID, name: 'Funzione' }]} event={event} readOnly={readOnly} />
    </TooltipProvider>,
  );
}

function inputs(type: 'date' | 'time'): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)].map(i => i.value);
}

describe(`event dialog (${ZONE})`, () => {
  test('an all-day event opens on its own dates and saves them unchanged', async () => {
    const screen = await renderDialog(dialogEvent({ startAt: '2026-03-10T00:00:00.000Z', endAt: '2026-03-12T00:00:00.000Z', allDay: true }));
    expect(inputs('date')).toEqual(['2026-03-10', '2026-03-12']);

    await screen.getByRole('button', { name: 'Salva' }).click();
    await expect.poll(() => updateMock.mock.calls.length).toBe(1);
    const sent = updateMock.mock.calls[0]?.[0] as { data: { startAt: string; endAt: string; allDay: boolean } };
    expect(sent.data).toMatchObject({ startAt: '2026-03-10T00:00:00.000Z', endAt: '2026-03-12T00:00:00.000Z', allDay: true });
  });

  test('a timed event with no end, late in the evening, gets an end an hour later — not before it', async () => {
    const start = new Date(2026, 2, 10, 23, 30);
    const screen = await renderDialog(dialogEvent({ startAt: start.toISOString(), endAt: null }));
    expect([inputs('date'), inputs('time')]).toEqual([['2026-03-10', '2026-03-11'], ['23:30', '00:30']]);

    await screen.getByRole('button', { name: 'Salva' }).click();
    await expect.poll(() => updateMock.mock.calls.length).toBe(1);
    const sent = updateMock.mock.calls[0]?.[0] as { data: { startAt: string; endAt: string } };
    expect(new Date(sent.data.endAt).getTime() - new Date(sent.data.startAt).getTime()).toBe(3_600_000);
  });

  test('the read-only card counts the drift from the baseline in calendar dates', async () => {
    const allDay = await renderDialog(dialogEvent({ startAt: '2026-03-12T00:00:00.000Z', baselineStartAt: '2026-03-10T00:00:00.000Z', allDay: true }), true);
    await expect.element(allDay.getByText('Spostato di 2g rispetto al piano originale')).toBeInTheDocument();
    allDay.unmount();

    // Monday 22:00 to Tuesday 08:00 is one calendar date later, though under 24 hours.
    const timed = await renderDialog(dialogEvent({ startAt: new Date(2026, 9, 6, 8).toISOString(), baselineStartAt: new Date(2026, 9, 5, 22).toISOString() }), true);
    await expect.element(timed.getByText('Spostato di 1g rispetto al piano originale')).toBeInTheDocument();
  });
});
