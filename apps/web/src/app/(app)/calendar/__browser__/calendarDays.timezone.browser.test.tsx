import { describe, expect, test } from 'vitest';

import { addCalendarDays, instantAt, parseCalendarDate, sameTimeZone, startOfDayIn, type CalendarDate } from '@luke/core';

import {
  eventDays,
  expandDateRangeToIsoDates,
  expectedDates,
  getIsoWeek,
  groupEventsByDay,
  hoursWithinDay,
  isStaleListError,
  moveEvent,
  moveEventTo,
  moveToCell,
  resizeEvent,
  sortByFirstDay,
} from '../utils';

/**
 * The calendar views' day logic, run in a real Chromium under each zone of
 * `vitest.browser.timezone.config.mts`. Two kinds of value: an all-day event is a zone-free date
 * stored at UTC midnight and must sit on that date in every zone; a timed event is an instant,
 * projected into the browser zone with an exclusive end.
 * The assertions are written as invariants that hold in every zone, so each instance proves them
 * for its own offset; the DST cases find the zone's own transition days instead of assuming Rome's.
 */

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const HOUR = 3_600_000;

type Ev = { startAt: string; endAt: string | null; allDay: boolean };

function allDay(first: string, last?: string): Ev {
  return { startAt: `${first}T00:00:00.000Z`, endAt: last ? `${last}T00:00:00.000Z` : null, allDay: true };
}

function timed(start: Date, end: Date | null): Ev {
  return { startAt: start.toISOString(), endAt: end ? end.toISOString() : null, allDay: false };
}

function date(s: string): CalendarDate {
  const parsed = parseCalendarDate(s);
  if (!parsed) throw new Error(`bad fixture date ${s}`);
  return parsed;
}

/** The day of `month` 2026 (1-based) whose local length is not 24 h in this zone, or `null`. */
function dstDay(month: number): number | null {
  for (let d = 1; d <= 31; d++) {
    if (new Date(2026, month - 1, d + 1).getTime() - new Date(2026, month - 1, d).getTime() !== 24 * HOUR) return d;
  }
  return null;
}

describe(`calendar day helpers (${ZONE})`, () => {
  test('this instance runs off UTC', () => {
    // Guards the proof: at offset 0 an all-day value read locally would look right by accident.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).not.toBe(0);
  });

  test('an all-day event occupies its own dates in every zone', () => {
    expect(eventDays(allDay('2026-03-10', '2026-03-11'))).toEqual(['2026-03-10', '2026-03-11']);
    expect(eventDays(allDay('2026-03-10'))).toEqual(['2026-03-10', '2026-03-10']);
  });

  test('groupEventsByDay puts an all-day event on its own cells, never the day before', () => {
    const cells = [9, 10, 11, 12].map(d => new Date(2026, 2, d));
    expect(groupEventsByDay([allDay('2026-03-10', '2026-03-11')], cells).map(g => g.length)).toEqual([0, 1, 1, 0]);
  });

  test('a timed event ending at local midnight does not reach the next cell', () => {
    const ev = timed(new Date(2026, 3, 13, 22, 0), new Date(2026, 3, 14, 0, 0));
    const cells = [new Date(2026, 3, 13), new Date(2026, 3, 14)];
    expect(groupEventsByDay([ev], cells).map(g => g.length)).toEqual([1, 0]);
  });

  test('a timed event just after a short DST day is not also counted on it', () => {
    // A fixed 24 h window from the midnight of a 23-hour day overlaps the next day's first hour.
    const day = dstDay(3) ?? 10;
    const ev = timed(new Date(2026, 2, day + 1, 0, 30), new Date(2026, 2, day + 1, 0, 45));
    const cells = [new Date(2026, 2, day), new Date(2026, 2, day + 1)];
    expect(groupEventsByDay([ev], cells).map(g => g.length)).toEqual([0, 1]);
  });

  test('moveEvent keeps an all-day event at UTC midnight across both DST changes', () => {
    for (const [first, moved] of [['2026-03-06', '2026-03-09'], ['2026-03-27', '2026-03-30'], ['2026-10-23', '2026-10-26'], ['2026-10-30', '2026-11-02']]) {
      expect(moveEvent(allDay(first!), 3)).toEqual({ startAt: `${moved}T00:00:00.000Z`, endAt: null });
    }
  });

  test('moveEvent moves a multi-day all-day event as a whole', () => {
    expect(moveEvent(allDay('2026-03-27', '2026-03-30'), -2)).toEqual({
      startAt: '2026-03-25T00:00:00.000Z',
      endAt: '2026-03-28T00:00:00.000Z',
    });
  });

  test('moveEvent keeps both wall times of a timed event', () => {
    const r = moveEvent(timed(new Date(2026, 2, 26, 9, 0), new Date(2026, 2, 27, 17, 0)), 5)!;
    const start = new Date(r.startAt);
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([31, 9, 0]);
    expect(new Date(r.endAt!).getTime() - start.getTime()).toBe(32 * HOUR);
  });

  test('moveEvent never inverts an interval moved into the spring-forward gap or the autumn fold', () => {
    // Rome, 28 Mar 02:30–03:00 + 1 day by wall clock gives 03:30–03:00: the end then follows at the
    // original duration, else keeps 03:00 (ADR-036). Autumn: October in Rome, November in Los Angeles.
    for (const [month, day] of [[3, dstDay(3)], [10, dstDay(10)], [11, dstDay(11)]] as const) {
      if (day === null) continue;
      const start = new Date(2026, month - 1, day - 1, 2, 30);
      const r = moveEvent(timed(start, new Date(start.getTime() + HOUR / 2)), 1)!;
      const movedStart = new Date(r.startAt);
      const wallEnd = new Date(2026, month - 1, day, 3, 0);
      expect(movedStart.getDate()).toBe(day);
      expect(new Date(r.endAt!)).toEqual(wallEnd > movedStart ? wallEnd : new Date(movedStart.getTime() + HOUR / 2));
    }
  });

  test('moveEvent sends nothing for a zero delta or an inverted source, and keeps a null end null', () => {
    expect(moveEvent(allDay('2026-03-10'), 0)).toBeNull();
    expect(moveEvent(timed(new Date(2026, 3, 13, 10, 0), new Date(2026, 3, 13, 9, 0)), 1)).toBeNull();
    expect(moveEvent(timed(new Date(2026, 3, 13, 10, 0), null), 1)!.endAt).toBeNull();
  });

  test('moveEventTo lands the first date on the target and carries the end along', () => {
    expect(moveEventTo(allDay('2026-03-27', '2026-03-30'), date('2026-04-02'))).toEqual({
      startAt: '2026-04-02T00:00:00.000Z',
      endAt: '2026-04-05T00:00:00.000Z',
    });
    expect(moveEventTo(allDay('2026-03-27'), date('2026-03-27'))).toBeNull();
    // A timed event late in the UTC day: its first date is the local one, and so is the target.
    const start = new Date(2026, 2, 5, 23, 30);
    const moved = moveEventTo(timed(start, null), date('2026-03-09'))!;
    expect([new Date(moved.startAt).getDate(), new Date(moved.startAt).getHours(), moved.endAt]).toEqual([9, 23, null]);
  });

  test('moveToCell reads a cell id (its local midnight) as that local date, in every zone', () => {
    // Month and week cells are droppables keyed by `day.toISOString()` of a local-midnight cell.
    for (const day of [22, 24, 28]) {
      const id = new Date(2026, 11, day).toISOString();
      expect(moveToCell(allDay('2026-12-22'), id)).toEqual(day === 22 ? null : { startAt: `2026-12-${day}T00:00:00.000Z`, endAt: null });
    }
    // Across the spring change the cell's local midnight is still its own date.
    expect(moveToCell(allDay('2026-03-06'), new Date(2026, 2, 30).toISOString())!.startAt).toBe('2026-03-30T00:00:00.000Z');
  });

  test('resizeEvent sends only the end, and shrinks an all-day event down to its first day', () => {
    const ev = allDay('2026-03-09', '2026-03-10');
    expect(resizeEvent(ev, -1)).toEqual({ endAt: '2026-03-09T00:00:00.000Z' });
    expect(resizeEvent(ev, -5)).toEqual({ endAt: '2026-03-09T00:00:00.000Z' });
    expect(resizeEvent(ev, 2)).toEqual({ endAt: '2026-03-12T00:00:00.000Z' });
    expect(resizeEvent(allDay('2026-03-09'), -1)).toBeNull();
    expect(resizeEvent(ev, 0)).toBeNull();
  });

  test('resizeEvent moves a timed end by local days and refuses one not after the start', () => {
    const start = new Date(2026, 3, 13, 10, 0);
    expect(resizeEvent(timed(start, new Date(2026, 3, 14, 9, 0)), -1)).toBeNull();
    const grown = new Date(resizeEvent(timed(start, new Date(2026, 3, 14, 9, 0)), 1)!.endAt);
    expect([grown.getDate(), grown.getHours()]).toEqual([15, 9]);
    // A null end anchors on the start instant.
    const fromStart = new Date(resizeEvent(timed(start, null), 1)!.endAt);
    expect([fromStart.getDate(), fromStart.getHours()]).toEqual([14, 10]);
  });

  test('hoursWithinDay clips an overnight timed event to the viewed day', () => {
    const overnight = timed(new Date(2026, 3, 13, 20, 0), new Date(2026, 3, 14, 9, 0));
    expect(hoursWithinDay(overnight, new Date(2026, 3, 13))).toEqual([20, 24]);
    expect(hoursWithinDay(overnight, new Date(2026, 3, 14))).toEqual([0, 9]);
    const threeDays = timed(new Date(2026, 3, 13, 20, 0), new Date(2026, 3, 15, 9, 0));
    expect(hoursWithinDay(threeDays, new Date(2026, 3, 14))).toEqual([0, 24]);
    expect(hoursWithinDay(timed(new Date(2026, 3, 13, 10, 30), null), new Date(2026, 3, 13))).toEqual([10.5, 11.5]);
  });

  test('expandDateRangeToIsoDates lists every stored date once across either DST change', () => {
    for (const [first, last] of [['2026-03-06', '2026-03-10'], ['2026-03-27', '2026-03-31'], ['2026-10-23', '2026-10-27']]) {
      const dates = expandDateRangeToIsoDates(new Date(`${first}T00:00:00.000Z`), new Date(`${last}T00:00:00.000Z`));
      expect(dates).toHaveLength(5);
      expect([dates[0], dates[4]]).toEqual([first, last]);
      expect(new Set(dates).size).toBe(5);
    }
  });

  test('expectedDates sends the dates the client holds, as stored instants', () => {
    expect(expectedDates(allDay('2026-03-10', '2026-03-12'))).toEqual({
      startAt: '2026-03-10T00:00:00.000Z', endAt: '2026-03-12T00:00:00.000Z', allDay: true,
    });
    const start = new Date(2026, 3, 13, 10, 0);
    expect(expectedDates({ startAt: start, endAt: null, allDay: false })).toEqual({ startAt: start.toISOString(), endAt: null, allDay: false });
  });

  test('isStaleListError: a write refused because the list was out of date, and nothing else', () => {
    expect(isStaleListError({ data: { code: 'PRECONDITION_FAILED' } })).toBe(true);
    expect(isStaleListError({ data: { code: 'CONFLICT' } })).toBe(true);
    expect(isStaleListError({ data: { code: 'BAD_REQUEST' } })).toBe(false);
    expect(isStaleListError({ data: null })).toBe(false);
  });

  test('getIsoWeek reads a calendar date', () => {
    expect(getIsoWeek(date('2026-03-30'))).toBe(14);
    expect(getIsoWeek(date('2026-12-31'))).toBe(53);
    expect(getIsoWeek(date('2027-01-04'))).toBe(1);
  });
});

/**
 * The reader's profile zone, never the browser's (ADR-035): Rome, or Los Angeles where the browser
 * itself is in Rome. Each instance thus reads in a zone whose offset differs from its own.
 */
const PROFILE = sameTimeZone(ZONE, 'Europe/Rome') ? 'America/Los_Angeles' : 'Europe/Rome';

/** The instant the wall clock of `zone` reads `time` on `day`. */
function at(day: string, time: string, zone = PROFILE): Date {
  return instantAt(date(day), time, zone);
}

describe(`calendar day helpers in a named zone (browser ${ZONE}, profile ${PROFILE})`, () => {
  test('a timed event sits on its dates in the zone passed, not in the browser zone', () => {
    // Half past midnight falls on the day before west of the profile zone, half past eleven on the
    // day after east of it: one of the two leaves the profile date in every instance.
    for (const time of ['00:30', '23:30']) {
      expect(eventDays(timed(at('2026-03-10', time), null), PROFILE)).toEqual(['2026-03-10', '2026-03-10']);
    }
  });

  test('sortByFirstDay orders by the first date in the zone passed', () => {
    // 02:00 in Rome is the evening before in Los Angeles, 20:00 in Los Angeles the next morning in
    // Rome: the timed event sorts against the all-day one by its profile date.
    const isRome = PROFILE === 'Europe/Rome';
    const allDayEvent = allDay('2026-03-10');
    const timedEvent = timed(isRome ? at('2026-03-10', '02:00') : at('2026-03-09', '20:00'), null);
    const expected = isRome ? [allDayEvent, timedEvent] : [timedEvent, allDayEvent];
    expect(sortByFirstDay([timedEvent, allDayEvent], PROFILE)).toEqual(expected);
    expect(sortByFirstDay([allDayEvent, timedEvent], PROFILE)).toEqual(expected);
  });

  test('moveEvent keeps the wall clock of the zone passed, across its own DST change', () => {
    // Los Angeles changes on 8 March, Rome on 29 March: each move crosses one zone's change only.
    for (const [days, target] of [[10, '2026-03-15'], [26, '2026-03-31']] as const) {
      expect(moveEvent(timed(at('2026-03-05', '09:00'), at('2026-03-05', '11:00')), days, PROFILE)).toEqual({
        startAt: at(target, '09:00').toISOString(),
        endAt: at(target, '11:00').toISOString(),
      });
    }
  });

  test('moveEventTo lands the first date on the target in the zone passed', () => {
    for (const time of ['00:30', '23:30']) {
      expect(moveEventTo(timed(at('2026-03-05', time), null), date('2026-03-09'), PROFILE)).toEqual({
        startAt: at('2026-03-09', time).toISOString(),
        endAt: null,
      });
    }
  });

  test('resizeEvent moves a timed end by days of the zone passed', () => {
    expect(resizeEvent(timed(at('2026-03-05', '09:00'), at('2026-03-05', '11:00')), 10, PROFILE)).toEqual({
      endAt: at('2026-03-15', '11:00').toISOString(),
    });
  });

  test('resizeEvent keeps an end on a day start where the zone skips midnight, as moveEvent does', () => {
    // Santiago skips 00:00–01:00 on 6 September 2026: that day starts at 01:00, the next at 00:00.
    // Keeping the wall time, an end at 01:00 resized onto the 7th covered one more day.
    const zone = 'America/Santiago';
    const dayStart = (day: string) => startOfDayIn(date(day), zone).toISOString();
    const item = timed(new Date(dayStart('2026-09-05')), new Date(dayStart('2026-09-06')));
    expect(resizeEvent(item, 1, zone)).toEqual({ endAt: dayStart('2026-09-07') });
    expect(resizeEvent({ ...item, endAt: dayStart('2026-09-07') }, -1, zone)).toEqual({ endAt: dayStart('2026-09-06') });
  });

  test('moveEvent keeps a day-aligned timed event (a template item) on day starts across DST (ADR-036)', () => {
    // A timed template item runs from the start of its day to the start of the next. Moved onto a
    // 23- or 25-hour day at the original duration, its end landed at 01:00 or 23:00 instead.
    const cases = [
      ['Europe/Rome', '2026-03-28'], ['Europe/Rome', '2026-10-24'],
      ['America/Los_Angeles', '2026-03-07'], ['America/Los_Angeles', '2026-10-31'],
    ] as const;
    for (const [zone, day] of cases) {
      const first = date(day);
      const item = timed(startOfDayIn(first, zone), startOfDayIn(addCalendarDays(first, 1), zone));
      const moved = moveEvent(item, 1, zone);
      expect(moved).toEqual({
        startAt: startOfDayIn(addCalendarDays(first, 1), zone).toISOString(),
        endAt: startOfDayIn(addCalendarDays(first, 2), zone).toISOString(),
      });
      expect(eventDays({ ...item, ...moved! }, zone)).toEqual([addCalendarDays(first, 1), addCalendarDays(first, 1)]);
    }
  });
});
