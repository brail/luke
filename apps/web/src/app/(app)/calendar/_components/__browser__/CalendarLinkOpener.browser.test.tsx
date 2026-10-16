import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { CalendarLinkTarget } from '@luke/core';

import { CalendarLinkOpener } from '../CalendarLinkOpener';

/**
 * What a notification link opens (`CalendarLinkOpener`): in its own context the event, on its day —
 * an all-day event's stored day, a timed one's in the profile zone (ADR-035), here a zone behind UTC so
 * a conversion would show; in another context a banner that switches only when asked; a target gone
 * or hidden says so. Mocks tRPC, the context mutation and the profile zone.
 */

const { located, setContext, toastError, profile } = vi.hoisted(() => ({
  located: { data: undefined as unknown, error: null as unknown, isFetching: false },
  setContext: vi.fn(),
  toastError: vi.fn(),
  profile: { zone: 'Pacific/Honolulu' as string | undefined },
}));

vi.mock('../../../../../lib/trpc', () => ({
  trpc: { seasonCalendar: { locate: { useQuery: () => located } } },
}));
vi.mock('../../../../../contexts/useContextMutation', () => ({ useContextMutation: () => ({ setContext, isPending: false }) }));
vi.mock('../../../../../hooks/useFormatDate', () => ({ useFormatDate: () => ({ zone: profile.zone }) }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  located.data = undefined;
  located.error = null;
  located.isFetching = false;
  setContext.mockReset();
  toastError.mockReset();
  profile.zone = 'Pacific/Honolulu';
});

const ALL_DAY = { id: 'e1', title: 'Consegna', startAt: '2026-10-16T00:00:00.000Z', endAt: null, allDay: true };
const found = (event: object | null = ALL_DAY, brandId = 'b1', seasonId = 's1') => ({ brandId, seasonId, label: 'Brand · Stagione', event });

function setup(overrides: Partial<Parameters<typeof CalendarLinkOpener>[0]> = {}) {
  const props = {
    target: { eventId: 'e1' } as CalendarLinkTarget | null,
    brandId: 'b1',
    seasonId: 's1',
    selectedBrandIds: ['b1'],
    events: [{ id: 'e1' }] as { id: string }[] | undefined,
    isFetching: false,
    refetch: vi.fn(),
    onSelectBrand: vi.fn(),
    onOpenEvent: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  return props;
}

describe('CalendarLinkOpener', () => {
  test('in its own context, opens an all-day event on its stored day, not converted to the zone', async () => {
    located.data = found();
    const props = setup();
    await render(<CalendarLinkOpener {...props} />);

    expect(props.onOpenEvent).toHaveBeenCalledWith('e1');
    expect(props.onDone).toHaveBeenCalledWith('2026-10-16');
  });

  test('opens a timed event on its start day in the profile zone', async () => {
    // 05:00 UTC on the 16th is 19:00 on the 15th in Honolulu.
    located.data = found({ ...ALL_DAY, startAt: '2026-10-16T05:00:00.000Z', allDay: false });
    const props = setup();
    await render(<CalendarLinkOpener {...props} />);

    expect(props.onDone).toHaveBeenCalledWith('2026-10-15');
  });

  test('waits for the profile zone before opening', async () => {
    located.data = found();
    profile.zone = undefined;
    const props = setup();
    const screen = await render(<CalendarLinkOpener {...props} />);
    expect(props.onOpenEvent).not.toHaveBeenCalled();

    profile.zone = 'Pacific/Honolulu';
    await screen.rerender(<CalendarLinkOpener {...props} />);
    expect(props.onOpenEvent).toHaveBeenCalledWith('e1');
  });

  test('selects the context brand first when it was deselected, then opens', async () => {
    located.data = found();
    const props = setup({ selectedBrandIds: [], events: undefined });
    const screen = await render(<CalendarLinkOpener {...props} />);
    expect(props.onSelectBrand).toHaveBeenCalledWith('b1');
    expect(props.onOpenEvent).not.toHaveBeenCalled();

    await screen.rerender(<CalendarLinkOpener {...props} selectedBrandIds={['b1']} events={[{ id: 'e1' }]} />);
    expect(props.onOpenEvent).toHaveBeenCalledWith('e1');
  });

  test.each([
    ['another brand', 'b2', 's1'],
    ['another season', 'b1', 's2'],
  ])('in %s, offers the switch and changes context only when asked, then opens', async (_, brandId, seasonId) => {
    located.data = found();
    const props = setup({ brandId, seasonId });
    const screen = await render(<CalendarLinkOpener {...props} />);

    await expect.element(screen.getByText('"Consegna" è nel calendario Brand · Stagione')).toBeVisible();
    expect(props.onOpenEvent).not.toHaveBeenCalled();
    expect(setContext).not.toHaveBeenCalled();

    await screen.getByRole('button', { name: 'Apri in Brand · Stagione' }).click();
    expect(setContext).toHaveBeenCalledWith({ brandId: 'b1', seasonId: 's1' });
    expect(props.onDone).not.toHaveBeenCalled();

    // The context moves (here, or from the header while the banner is open): the event opens.
    await screen.rerender(<CalendarLinkOpener {...props} brandId="b1" seasonId="s1" />);
    expect(props.onOpenEvent).toHaveBeenCalledWith('e1');
  });

  test('Ignora drops the target and opens nothing', async () => {
    located.data = found(ALL_DAY, 'b2');
    const props = setup();
    const screen = await render(<CalendarLinkOpener {...props} />);

    await screen.getByRole('button', { name: 'Ignora' }).click();
    expect(props.onDone).toHaveBeenCalledWith();
    expect(props.onOpenEvent).not.toHaveBeenCalled();
  });

  test('a calendar link is only dropped in its own context, and names the calendar in another', async () => {
    located.data = found(null);
    const props = setup({ target: { calendarId: 'c1' } });
    const screen = await render(<CalendarLinkOpener {...props} />);
    expect(props.onDone).toHaveBeenCalledWith();
    expect(props.onOpenEvent).not.toHaveBeenCalled();

    await screen.rerender(<CalendarLinkOpener {...props} brandId="b2" />);
    await expect.element(screen.getByText('Questa notifica riguarda il calendario Brand · Stagione')).toBeVisible();
  });

  test('a target gone or hidden says so and is dropped', async () => {
    located.error = { data: { code: 'NOT_FOUND' }, message: 'Non più disponibile' };
    const props = setup();
    await render(<CalendarLinkOpener {...props} />);

    expect(toastError).toHaveBeenCalledWith('Evento non più disponibile');
    expect(props.onDone).toHaveBeenCalledWith();
  });

  test('any other error is reported once and dropped too, so a malformed link does not stick', async () => {
    located.error = { data: { code: 'BAD_REQUEST' }, message: 'Invalid input' };
    const props = setup({ target: { eventId: 'abc' } });
    await render(<CalendarLinkOpener {...props} />);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(props.onDone).toHaveBeenCalledWith();
  });

  test('waits for a fresh answer before opening, not a cached one', async () => {
    located.data = found();
    located.isFetching = true;
    const props = setup();
    const screen = await render(<CalendarLinkOpener {...props} />);
    expect(props.onOpenEvent).not.toHaveBeenCalled();

    located.isFetching = false;
    await screen.rerender(<CalendarLinkOpener {...props} />);
    expect(props.onOpenEvent).toHaveBeenCalledWith('e1');
  });

  test('an event not in the list yet is fetched again once, then given up', async () => {
    located.data = found();
    const props = setup({ events: [] });
    const screen = await render(<CalendarLinkOpener {...props} />);
    expect(props.refetch).toHaveBeenCalledTimes(1);
    expect(props.onDone).not.toHaveBeenCalled();

    await screen.rerender(<CalendarLinkOpener {...props} events={[]} />);
    expect(props.refetch).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Evento non più disponibile');
    expect(props.onDone).toHaveBeenCalledWith();

    // Followed again later: the list gets its own second chance.
    await screen.rerender(<CalendarLinkOpener {...props} target={null} />);
    await screen.rerender(<CalendarLinkOpener {...props} events={[]} />);
    expect(props.refetch).toHaveBeenCalledTimes(2);
  });

  test('a second link, and the same one again, are handled anew', async () => {
    located.data = found();
    const props = setup();
    const screen = await render(<CalendarLinkOpener {...props} />);
    expect(props.onOpenEvent).toHaveBeenLastCalledWith('e1');

    // Dropped from the URL, then another link.
    await screen.rerender(<CalendarLinkOpener {...props} target={null} />);
    located.data = found({ ...ALL_DAY, id: 'e2' });
    await screen.rerender(<CalendarLinkOpener {...props} target={{ eventId: 'e2' }} events={[{ id: 'e2' }]} />);
    expect(props.onOpenEvent).toHaveBeenLastCalledWith('e2');

    await screen.rerender(<CalendarLinkOpener {...props} target={null} />);
    located.data = found();
    await screen.rerender(<CalendarLinkOpener {...props} target={{ eventId: 'e1' }} />);
    expect(props.onOpenEvent).toHaveBeenLastCalledWith('e1');
    expect(props.onOpenEvent).toHaveBeenCalledTimes(3);
  });
});
