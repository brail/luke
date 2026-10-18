import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { type CalendarDate } from '@luke/core';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { at, date, PROFILE, ZONE } from '../../../../../lib/__browser__/zoneFixtures';
import { CalendarEventDialog } from '../CalendarEventDialog';

/**
 * The event dialog mounted under each zone of `vitest.browser.timezone.config.mts`, for a reader
 * whose profile zone is not the browser's: what the form loads from an event and what it writes
 * back on save. The form always resubmits its dates, so a wrong read is a silent write — an all-day
 * event read with local getters moved back a day west of UTC on any save.
 */

// Every query result is one object reused across renders, the way react-query keeps a settled
// result stable: a fresh `[]` per render feeds the dialog's effects a new value every time.
const { updateMock, idleMutation, emptyList, noData } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  idleMutation: () => ({ mutate: () => undefined, isPending: false }),
  emptyList: { data: [], isLoading: false, isError: false },
  noData: { data: undefined, isLoading: false, isError: false },
}));

// Only what the dialog and its children call while rendering. `me.get` answers with the profile
// zone, imported here because a hoisted block runs before the imports.
vi.mock('../../../../../lib/trpc', async () => {
  const { PROFILE: timezone } = await import('../../../../../lib/__browser__/zoneFixtures');
  const me = { data: { timezone }, error: null };
  return { trpc: {
    phase: { list: { useQuery: () => emptyList } },
    planningGroup: { list: { useQuery: () => emptyList } },
    auditLog: { getLastChange: { useQuery: () => noData } },
    me: { get: { useQuery: () => me } },
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
  } };
});

vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
// A signed-in reader: `useFormatDate` takes the profile zone from `me.get`.
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'token' }, status: 'authenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

afterEach(() => updateMock.mockReset());

// The form validates visibility ids as uuids.
const FUNCTION_ID = '00000000-0000-4000-8000-000000000001';

type DialogEvent = NonNullable<Parameters<typeof CalendarEventDialog>[0]['event']>;

function dialogEvent(fields: Partial<DialogEvent>): DialogEvent {
  return { id: 'e1', title: 'Evento', startAt: '', allDay: false, publishExternally: true, visibilities: [{ functionId: FUNCTION_ID }], ...fields };
}

function renderDialog(event: DialogEvent | undefined, readOnly = false, defaults: { date?: CalendarDate; time?: string } = {}) {
  return render(
    <TooltipProvider delayDuration={0}>
      <CalendarEventDialog open onClose={() => undefined} onSaved={() => undefined} brandId="b1" seasonId="s1"
        availableFunctions={[{ id: FUNCTION_ID, name: 'Funzione' }]} event={event} readOnly={readOnly}
        defaultDate={defaults.date} defaultTime={defaults.time} />
    </TooltipProvider>,
  );
}

/** The instant the profile wall clock reads `time` on `day`, as stored. */
function stored(day: string, time: string): string {
  return at(day, time).toISOString();
}

function inputs(type: 'date' | 'time'): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)].map(i => i.value);
}

describe(`event dialog (browser ${ZONE}, profile ${PROFILE})`, () => {
  test('an all-day event opens on its own dates and saves them unchanged', async () => {
    const screen = await renderDialog(dialogEvent({ startAt: '2026-03-10T00:00:00.000Z', endAt: '2026-03-12T00:00:00.000Z', allDay: true }));
    expect(inputs('date')).toEqual(['2026-03-10', '2026-03-12']);

    await screen.getByRole('button', { name: 'Salva' }).click();
    await expect.poll(() => updateMock.mock.calls.length).toBe(1);
    const sent = updateMock.mock.calls[0]?.[0] as { data: { startAt: string; endAt: string; allDay: boolean }; expected: unknown };
    expect(sent.data).toMatchObject({ startAt: '2026-03-10T00:00:00.000Z', endAt: '2026-03-12T00:00:00.000Z', allDay: true });
    // The dates the form was opened on travel with the save, so a move made meanwhile is not undone.
    expect(sent.expected).toEqual({ startAt: '2026-03-10T00:00:00.000Z', endAt: '2026-03-12T00:00:00.000Z', allDay: true });
  });

  test('a timed event opens on its profile date and hours, and names the zone', async () => {
    // Half past midnight is the day before west of the profile zone.
    const screen = await renderDialog(dialogEvent({ startAt: stored('2026-03-10', '00:30'), endAt: stored('2026-03-10', '02:00') }));
    expect([inputs('date'), inputs('time')]).toEqual([['2026-03-10', '2026-03-10'], ['00:30', '02:00']]);
    await expect.element(screen.getByText(`Orari in ${PROFILE}`)).toBeInTheDocument();
  });

  test('a timed event with no end, late in the evening, gets an end an hour later — not before it', async () => {
    const screen = await renderDialog(dialogEvent({ startAt: stored('2026-03-10', '23:30'), endAt: null }));
    expect([inputs('date'), inputs('time')]).toEqual([['2026-03-10', '2026-03-11'], ['23:30', '00:30']]);

    await screen.getByRole('button', { name: 'Salva' }).click();
    await expect.poll(() => updateMock.mock.calls.length).toBe(1);
    const sent = updateMock.mock.calls[0]?.[0] as { data: { startAt: string; endAt: string } };
    expect(new Date(sent.data.endAt).getTime() - new Date(sent.data.startAt).getTime()).toBe(3_600_000);
  });

  test('the read-only card counts the drift from the baseline in calendar dates', async () => {
    const allDay = await renderDialog(dialogEvent({ startAt: '2026-03-12T00:00:00.000Z', baselineStartAt: '2026-03-10T00:00:00.000Z', allDay: true }), true);
    await expect.element(allDay.getByText('Spostato di 2g rispetto al piano originale')).toBeInTheDocument();
    await allDay.unmount();

    // Monday 22:00 to Tuesday 08:00 in the profile zone is one calendar date later, though under 24 hours.
    const timed = await renderDialog(dialogEvent({ startAt: stored('2026-10-06', '08:00'), baselineStartAt: stored('2026-10-05', '22:00') }), true);
    await expect.element(timed.getByText('Spostato di 1g rispetto al piano originale')).toBeInTheDocument();
  });

  test('saving unchanged keeps an event in the second occurrence of a repeated hour where it is', async () => {
    // 02:30 in Rome on 25 October, 01:30 in Los Angeles on 1 November: each happens twice.
    const second = PROFILE === 'Europe/Rome' ? '2026-10-25T01:30:00.000Z' : '2026-11-01T09:30:00.000Z';
    const screen = await renderDialog(dialogEvent({ startAt: second, endAt: null }));
    await screen.getByRole('button', { name: 'Salva' }).click();
    await expect.poll(() => updateMock.mock.calls.length).toBe(1);
    expect((updateMock.mock.calls[0]?.[0] as { data: { startAt: string } }).data.startAt).toBe(second);
  });

  test('setting all-day on an event that ends at midnight keeps the days it covers', async () => {
    const screen = await renderDialog(dialogEvent({ startAt: stored('2026-03-10', '20:00'), endAt: stored('2026-03-11', '00:00') }));
    await screen.getByRole('checkbox', { name: 'Tutto il giorno' }).click();
    expect(inputs('date')).toEqual(['2026-03-10', '2026-03-10']);
    await screen.getByRole('checkbox', { name: 'Tutto il giorno' }).click();
    expect([inputs('date'), inputs('time')]).toEqual([['2026-03-10', '2026-03-11'], ['20:00', '00:00']]);
  });

  test('a new event from the day view starts on the clicked day and hour', async () => {
    await renderDialog(undefined, false, { date: date('2026-03-10'), time: '14:00' });
    expect([inputs('date'), inputs('time')]).toEqual([['2026-03-10', '2026-03-10'], ['14:00', '15:00']]);
  });
});
