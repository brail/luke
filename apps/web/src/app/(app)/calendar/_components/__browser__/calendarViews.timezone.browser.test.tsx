import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { CalendarEventDayView } from '../CalendarEventDayView';
import { CalendarEventGantt } from '../CalendarEventGantt';
import { CalendarEventMonthView } from '../CalendarEventMonthView';
import { CalendarEventTimeline } from '../CalendarEventTimeline';
import { CalendarEventWeekView } from '../CalendarEventWeekView';

import type { CalendarEventItem } from '../types';
import type { HolidayMap } from '../useHolidays';

/**
 * The calendar views rendered under each zone of `vitest.browser.timezone.config.mts`: an all-day
 * event sits on its own date, holidays shade their own cell, the Gantt grid survives the October
 * change and a timed event is clipped to the day it is drawn on.
 */

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const noop = () => {};

function event(id: string, startAt: string, endAt: string | null, allDay: boolean): CalendarEventItem {
  return { id, title: id, startAt, endAt, allDay, publishExternally: false, visibilities: [], planningGroupId: 'g1' };
}

const HOLIDAY: HolidayMap = new Map([['2026-12-25', [{ countryCode: 'FX', name: 'Fixture', nameEn: 'Fixture' }]]]);

describe(`calendar views (${ZONE})`, () => {
  test('week view shades the holiday on its own day row', async () => {
    const screen = await render(
      <CalendarEventWeekView milestones={[]} viewDate={new Date(2026, 11, 23)} onViewDateChange={noop}
        onEventClick={noop} onEventUpdate={noop} brandColorMap={{}} holidayDates={HOLIDAY} />,
    );
    // The day number and the holiday badges share the row header.
    expect(screen.getByText('25', { exact: true }).element().parentElement?.textContent).toContain('FX');
    expect(screen.getByText('26', { exact: true }).element().parentElement?.textContent ?? '').not.toContain('FX');
  });

  test('month view starts an all-day event on its own date', async () => {
    const screen = await render(
      <CalendarEventMonthView milestones={[event('Evento A', '2026-12-10T00:00:00.000Z', null, true)]}
        viewDate={new Date(2026, 11, 1)} onViewDateChange={noop} onEventClick={noop} onEventUpdate={noop} brandColorMap={{}} />,
    );
    const chips = screen.getByText('Evento A', { exact: true }).elements();
    expect(chips).toHaveLength(1);
    const cell = chips[0]!.closest('[class*="min-h-"]');
    expect(cell?.querySelector('span')?.textContent).toBe('10');
  });

  test('week view offers the drag on the first day of a multi-day all-day event only', async () => {
    const screen = await render(
      <CalendarEventWeekView milestones={[event('Evento A', '2026-12-22T00:00:00.000Z', '2026-12-23T00:00:00.000Z', true)]}
        viewDate={new Date(2026, 11, 23)} onViewDateChange={noop} onEventClick={noop} onEventUpdate={noop}
        brandColorMap={{}} canUpdate />,
    );
    const draggable = screen.container.querySelectorAll('[aria-roledescription="draggable"]');
    expect(draggable).toHaveLength(1);
    // Each day is one row: the day number heads the row the draggable chip sits in.
    const row = draggable[0]!.closest('.flex.border-b');
    expect(row?.querySelector('.rounded-full')?.textContent).toBe('22');
  });

  test('timeline lists an all-day event on the 1st in its own month, after the previous evening', async () => {
    const screen = await render(
      <CalendarEventTimeline
        milestones={[
          event('Primo aprile', '2026-04-01T00:00:00.000Z', null, true),
          event('Sera di marzo', new Date(2026, 2, 31, 20, 0).toISOString(), null, false),
        ]}
        onEventClick={noop} functionsById={{}} brandColorMap={{}} />,
    );
    const text = screen.container.textContent ?? '';
    expect(text.indexOf('Marzo 2026')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Marzo 2026')).toBeLessThan(text.indexOf('Aprile 2026'));
    expect(text.indexOf('Aprile 2026')).toBeLessThan(text.indexOf('Primo aprile'));
  });

  test('gantt draws a two-day all-day event over two cells and keeps its days right after October', async () => {
    const screen = await render(
      <CalendarEventGantt
        milestones={[
          event('Evento A', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', true),
          event('Evento B', '2026-11-20T00:00:00.000Z', null, true),
        ]}
        onEventClick={noop} onEventUpdate={noop} functionsById={{}} brandColorMap={{}}
        holidayDates={new Map([['2026-11-02', [{ countryCode: 'FX', name: 'Fixture', nameEn: null }]]])} />,
    );
    const container = screen.container;
    const bar = container.querySelector<HTMLElement>('[title^="Evento A"]');
    expect(bar?.style.width).toBe('48px');
    expect(bar?.style.left).toBe(`${7 * 24}px`);

    // rangeStart = 2026-09-24; 2026-11-02 is its 39th day.
    const dayNumbers = [...container.querySelectorAll('span.tabular-nums.select-none')].map(s => s.textContent);
    expect(dayNumbers[0]).toBe('24');
    expect(dayNumbers[39]).toBe('2');
    const holiday = container.querySelector<HTMLElement>('[class*="bg-rose-200"]');
    expect(holiday?.style.left).toBe(`${39 * 24}px`);
  });

  test('day view clips an overnight timed event to the day it is drawn on', async () => {
    const overnight = event('Notte', new Date(2026, 3, 13, 20, 0).toISOString(), new Date(2026, 3, 14, 9, 0).toISOString(), false);
    const block = async (viewDate: Date) => {
      const screen = await render(
        <CalendarEventDayView milestones={[overnight]} viewDate={viewDate} onViewDateChange={noop}
          onEventClick={noop} onEventUpdate={noop} brandColorMap={{}} />,
      );
      const el = screen.getByText('Notte', { exact: true }).element().closest<HTMLElement>('[class*="absolute rounded-r"]');
      const style = { top: el?.style.top, height: el?.style.height };
      screen.unmount();
      return style;
    };
    // The grid shows 07:00–22:00 at 56 px an hour: Monday 20–24 is drawn 20–22, Tuesday 0–9 is 07–09.
    expect(await block(new Date(2026, 3, 13))).toEqual({ top: `${13 * 56}px`, height: `${2 * 56}px` });
    expect(await block(new Date(2026, 3, 14))).toEqual({ top: '0px', height: `${2 * 56}px` });
  });
});
