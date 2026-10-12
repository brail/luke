import process from 'node:process';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import {
  DEFAULT_LOCALE,
  NUMERIC_DATE_TIME,
  NUMERIC_TIME,
  addCalendarDays,
  calendarDateIn,
  calendarDateOf,
  calendarDaysBetween,
  eventCalendarDays,
  formatCalendarDate,
  formatInstant,
  instantAt,
  isoWeekOf,
  canonicalTimeZone,
  isValidTimeZone,
  isInstantInRange,
  isWorkingDate,
  parseCalendarDate,
  sameTimeZone,
  shiftEventByDays,
  startOfDayIn,
  startOfIsoWeek,
  utcMidnightOf,
  wallClockDate,
  wallTimeIn,
  workingDaysBetweenDates,
  type CalendarDate,
  type CalendarHoliday,
} from '../dateUtils.js';

// ─── Calendar dates ──────────────────────────────────────────────────────────
//
// Every expectation below is a constant, the same in every zone: the whole point of these helpers
// is that the process's zone cannot change their answer. The matrix switches `process.env.TZ` at
// runtime, which Node honours in a forked worker (vitest's default pool), not in a worker thread.

const date = (s: string): CalendarDate => {
  const parsed = parseCalendarDate(s);
  if (!parsed) throw new Error(`test fixture is not a calendar date: ${s}`);
  return parsed;
};
const iso = (instant: Date) => instant.toISOString();

// Local hour of 2026-01-15T12:00Z in each zone: proves the switch took effect, not just the variable.
describe.each([
  ['UTC', 12],
  ['Europe/Rome', 13],
  ['America/Los_Angeles', 4],
  ['Asia/Shanghai', 20],
  ['Asia/Kolkata', 17],
] as const)('calendar dates, process TZ=%s', (zone, localNoonHour) => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('runs in the intended process zone', () => {
    expect(new Date(Date.UTC(2026, 0, 15, 12)).getHours()).toBe(localNoonHour);
  });

  describe('parseCalendarDate', () => {
    it.each(['2026-09-28', '2028-02-29', '1900-01-01', '9999-12-31'])('accepts %s', s => {
      expect(parseCalendarDate(s)).toBe(s);
    });

    it.each(['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '9999-12-32', '2026-9-28', '2026-09-28T00:00:00Z', '1899-12-31', ''])(
      'rejects %j',
      s => {
        expect(parseCalendarDate(s)).toBeNull();
      },
    );
  });

  describe('calendarDateOf / utcMidnightOf', () => {
    it('reads a stored all-day value as its UTC date, whatever its time of day', () => {
      expect(calendarDateOf(new Date('2026-09-28T00:00:00Z'))).toBe('2026-09-28');
      expect(calendarDateOf(new Date('2026-09-28T23:59:59.999Z'))).toBe('2026-09-28');
    });

    it('turns a calendar date back into its UTC midnight', () => {
      expect(iso(utcMidnightOf(date('2026-09-28')))).toBe('2026-09-28T00:00:00.000Z');
    });

    it('throws on an invalid Date or a date outside the supported years', () => {
      expect(() => calendarDateOf(new Date('nope'))).toThrow(RangeError);
      expect(() => calendarDateOf(new Date('1899-12-31T12:00:00Z'))).toThrow(RangeError);
    });
  });

  describe('calendarDateIn', () => {
    it.each([
      ['Europe/Rome', '2026-09-28'],
      ['America/Los_Angeles', '2026-09-27'],
      ['Asia/Shanghai', '2026-09-28'],
      ['Asia/Kolkata', '2026-09-28'],
      ['UTC', '2026-09-27'],
    ])('2026-09-27T22:30Z is %s → %s', (timeZone, expected) => {
      expect(calendarDateIn(new Date('2026-09-27T22:30:00Z'), timeZone)).toBe(expected);
    });

    it('changes day exactly at local midnight', () => {
      expect(calendarDateIn(new Date('2026-09-27T21:59:59.999Z'), 'Europe/Rome')).toBe('2026-09-27');
      expect(calendarDateIn(new Date('2026-09-27T22:00:00.000Z'), 'Europe/Rome')).toBe('2026-09-28');
    });

    it('throws on an invalid zone or Date', () => {
      expect(() => calendarDateIn(new Date(), 'Foo/Bar')).toThrow(RangeError);
      expect(() => calendarDateIn(new Date('nope'), 'Europe/Rome')).toThrow(RangeError);
    });
  });

  describe('addCalendarDays / calendarDaysBetween', () => {
    it.each([
      ['2026-03-28', 1, '2026-03-29'],
      ['2026-10-25', 1, '2026-10-26'],
      ['2026-12-31', 1, '2027-01-01'],
      ['2028-02-28', 1, '2028-02-29'],
      ['2026-03-01', -1, '2026-02-28'],
    ] as const)('%s %+i → %s', (from, days, expected) => {
      expect(addCalendarDays(date(from), days)).toBe(expected);
    });

    it('throws when the result leaves the supported years', () => {
      expect(() => addCalendarDays(date('1900-01-01'), -1)).toThrow(RangeError);
    });

    it('counts whole days, signed, never -0', () => {
      expect(calendarDaysBetween(date('2026-09-28'), date('2026-10-05'))).toBe(7);
      expect(calendarDaysBetween(date('2026-10-05'), date('2026-09-28'))).toBe(-7);
      expect(calendarDaysBetween(date('2026-03-28'), date('2026-03-30'))).toBe(2);
      expect(calendarDaysBetween(date('2026-09-28'), date('2026-09-28'))).toBe(0);
    });
  });

  describe('isWorkingDate / workingDaysBetweenDates', () => {
    const tuesdayHoliday = { startDate: date('2026-09-29'), endDate: date('2026-09-29') };
    const working = (from: string, to: string, holidays: CalendarHoliday[] = []) =>
      workingDaysBetweenDates(date(from), date(to), ['IT'], holidays);

    it('excludes weekends and holidays of the listed countries only', () => {
      expect(isWorkingDate(date('2026-09-28'), [], [])).toBe(true);
      expect(isWorkingDate(date('2026-10-03'), [], [])).toBe(false);
      expect(isWorkingDate(date('2026-10-04'), [], [])).toBe(false);
      expect(isWorkingDate(date('2026-09-29'), ['IT'], [{ countryCode: 'IT', ...tuesdayHoliday }])).toBe(false);
      expect(isWorkingDate(date('2026-09-29'), ['IT'], [{ countryCode: 'CN', ...tuesdayHoliday }])).toBe(true);
    });

    it('follows workingDaysBetween: from excluded, to included, signed, never -0', () => {
      expect(working('2026-09-28', '2026-09-28')).toBe(0);
      expect(working('2026-09-28', '2026-09-29')).toBe(1);
      expect(working('2026-09-28', '2026-10-05')).toBe(5);
      expect(working('2026-10-03', '2026-10-02')).toBe(-1);
      expect(working('2026-10-02', '2026-10-04')).toBe(0);
      expect(working('2026-10-05', '2026-10-04')).toBe(0);
      expect(working('2026-09-28', '2026-10-05', [{ countryCode: 'IT', ...tuesdayHoliday }])).toBe(4);
      expect(working('2026-09-28', '2026-10-05', [{ countryCode: 'CN', ...tuesdayHoliday }])).toBe(5);
    });
  });

  describe('formatCalendarDate', () => {
    it('writes the date itself, whatever the process zone', () => {
      expect(formatCalendarDate(date('2026-11-05'), { day: 'numeric', month: 'short', year: 'numeric' })).toBe('5 nov 2026');
      expect(formatCalendarDate(date('2026-01-01'), { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('01/01/2026');
    });
  });

  describe('eventCalendarDays', () => {
    const at = (iso: string) => new Date(iso);

    it('takes an all-day event as its stored dates, never converted to a zone', () => {
      expect(eventCalendarDays(at('2026-11-05T00:00:00Z'), at('2026-11-07T00:00:00Z'), true, 'America/Los_Angeles'))
        .toEqual(['2026-11-05', '2026-11-07']);
      expect(eventCalendarDays(at('2026-11-05T00:00:00Z'), null, true, 'Asia/Tokyo')).toEqual(['2026-11-05', '2026-11-05']);
    });

    it('takes a timed event as the dates of its instants in the zone', () => {
      // 20:00Z on March 1 is 05:00 on March 2 in Tokyo, 21:00 on March 1 in Rome.
      expect(eventCalendarDays(at('2032-03-01T20:00:00Z'), null, false, 'Asia/Tokyo')).toEqual(['2032-03-02', '2032-03-02']);
      expect(eventCalendarDays(at('2032-03-01T20:00:00Z'), null, false, 'Europe/Rome')).toEqual(['2032-03-01', '2032-03-01']);
    });

    it('treats the end of a timed event as exclusive: ending at local midnight does not reach the next day', () => {
      expect(eventCalendarDays(at('2032-03-10T09:00:00Z'), at('2032-03-10T23:00:00Z'), false, 'Europe/Rome'))
        .toEqual(['2032-03-10', '2032-03-10']);
      expect(eventCalendarDays(at('2032-03-10T09:00:00Z'), at('2032-03-10T23:00:01Z'), false, 'Europe/Rome'))
        .toEqual(['2032-03-10', '2032-03-11']);
    });

    it('keeps a timed event whose end is not after its start on its start date', () => {
      expect(eventCalendarDays(at('2032-03-10T09:00:00Z'), at('2032-03-10T09:00:00Z'), false, 'Europe/Rome'))
        .toEqual(['2032-03-10', '2032-03-10']);
    });
  });

  describe('startOfDayIn', () => {
    it.each([
      ['2026-09-28', 'Europe/Rome', '2026-09-27T22:00:00.000Z'],
      ['2026-03-29', 'Europe/Rome', '2026-03-28T23:00:00.000Z'], // spring forward later that night
      ['2026-03-30', 'Europe/Rome', '2026-03-29T22:00:00.000Z'],
      ['2026-10-25', 'Europe/Rome', '2026-10-24T22:00:00.000Z'], // fall back later that night
      ['2026-10-26', 'Europe/Rome', '2026-10-25T23:00:00.000Z'],
      ['2026-09-28', 'America/Los_Angeles', '2026-09-28T07:00:00.000Z'],
      ['2026-09-28', 'Asia/Shanghai', '2026-09-27T16:00:00.000Z'],
      ['2026-09-28', 'Asia/Kolkata', '2026-09-27T18:30:00.000Z'],
      // Midnight skipped: the day starts at 01:00 local (-03).
      ['2024-09-08', 'America/Santiago', '2024-09-08T04:00:00.000Z'],
      // Clocks go back at midnight: the day starts at 00:00 local (-04).
      ['2024-04-07', 'America/Santiago', '2024-04-07T04:00:00.000Z'],
      // Midnight repeated: the first one.
      ['2025-11-02', 'America/Havana', '2025-11-02T04:00:00.000Z'],
      // Before 1970 (negative epoch): midnight skipped, the day starts at 01:00 local (+02).
      ['1966-05-22', 'Europe/Rome', '1966-05-21T23:00:00.000Z'],
      // A transition earlier than twelve hours before UTC midnight (+13 → +14).
      ['1981-04-01', 'Asia/Anadyr', '1981-03-31T11:00:00.000Z'],
      // The date is entered at 02:00Z, left at 02:01Z, entered again at 04:00Z: the first entry.
      ['1988-10-30', 'America/Goose_Bay', '1988-10-30T02:00:00.000Z'],
      // A day the zone skipped starts when the next one does.
      ['2011-12-30', 'Pacific/Apia', '2011-12-30T10:00:00.000Z'],
      ['2011-12-31', 'Pacific/Apia', '2011-12-30T10:00:00.000Z'],
      // The year range bounds calendar dates, not instants.
      ['1900-01-01', 'Europe/Rome', '1899-12-31T23:00:00.000Z'],
    ])('%s in %s starts at %s', (day, timeZone, expected) => {
      expect(iso(startOfDayIn(date(day), timeZone))).toBe(expected);
    });

    it('throws on an invalid zone', () => {
      expect(() => startOfDayIn(date('2026-09-28'), 'Foo/Bar')).toThrow(RangeError);
    });
  });

  describe('instantAt', () => {
    it.each([
      ['2026-10-02', '09:30', 'Europe/Rome', '2026-10-02T07:30:00.000Z'],
      ['2026-10-02', '23:00', 'America/Los_Angeles', '2026-10-03T06:00:00.000Z'],
      ['2026-10-02', '05:00', 'Asia/Kolkata', '2026-10-01T23:30:00.000Z'],
      // A wall time the spring-forward jump skips: the first instant after the jump (03:00 CEST).
      ['2026-03-29', '02:30', 'Europe/Rome', '2026-03-29T01:00:00.000Z'],
      // A wall time the fall-back repeats: its first occurrence (02:30 CEST).
      ['2026-10-25', '02:30', 'Europe/Rome', '2026-10-25T00:30:00.000Z'],
      ['2026-09-28', '00:00', 'Europe/Rome', '2026-09-27T22:00:00.000Z'],
    ])('%s %s in %s is %s', (day, time, timeZone, expected) => {
      expect(iso(instantAt(date(day), time, timeZone))).toBe(expected);
    });

    it.each(['24:00', '9:30', '09:60', ''])('throws on the wall time %j', time => {
      expect(() => instantAt(date('2026-10-02'), time, 'Europe/Rome')).toThrow(RangeError);
    });
  });

  describe('isValidTimeZone', () => {
    it.each(['Europe/Rome', 'UTC', 'Etc/GMT+5', 'Asia/Kolkata'])('accepts %s', tz => {
      expect(isValidTimeZone(tz)).toBe(true);
    });

    // `Intl` itself accepts a fixed offset; it is not an IANA name.
    it.each(['Foo/Bar', '', '+01:00', '-05:00', '−01:00', '−0100'])('rejects %j', tz => {
      expect(isValidTimeZone(tz)).toBe(false);
    });
  });

  describe('canonicalTimeZone', () => {
    // Stored as typed, a zone spelled in another case splits every grouping by zone and matches no
    // option of a zone list; an alias is left alone, browsers disagree on which name is primary.
    it.each([['europe/rome', 'Europe/Rome'], ['EUROPE/ROME', 'Europe/Rome'], ['utc', 'UTC'], ['Europe/Rome', 'Europe/Rome'], ['Asia/Kolkata', 'Asia/Kolkata'], ['Asia/Calcutta', 'Asia/Calcutta']])(
      '%s → %s', (tz, expected) => {
        expect(canonicalTimeZone(tz)).toBe(expected);
      });
  });

  describe('sameTimeZone', () => {
    // A zone saved under an alias or in another case is still the same zone (ADR-035 §Two zone roles).
    it.each([['Asia/Kolkata', 'Asia/Calcutta'], ['asia/kolkata', 'Asia/Calcutta'], ['Europe/Rome', 'europe/rome'], ['UTC', 'Etc/UTC']])(
      '%s = %s', (a, b) => {
        expect(sameTimeZone(a, b)).toBe(true);
      });

    it.each([['Europe/Rome', 'Europe/Paris'], ['Roma', 'Roma'], ['+01:00', '+01:00'], ['America/New_Yor\u212A', 'America/New_York']])('%s ≠ %s', (a, b) => {
      expect(sameTimeZone(a, b)).toBe(false);
    });
  });

  describe('isoWeekOf and startOfIsoWeek', () => {
    // Expected values from Python's `date.isocalendar()`.
    it.each([
      ['2020-12-31', 53, 2020, '2020-12-28'],
      ['2021-01-03', 53, 2020, '2020-12-28'],
      ['2021-01-04', 1, 2021, '2021-01-04'],
      ['2024-12-30', 1, 2025, '2024-12-30'],
      ['2026-10-11', 41, 2026, '2026-10-05'],
      ['1900-01-01', 1, 1900, '1900-01-01'],
    ])('%s is week %i of %i, starting %s', (day, week, year, monday) => {
      expect(isoWeekOf(date(day))).toEqual({ year, week });
      expect(startOfIsoWeek(date(day))).toBe(monday);
    });
  });

  describe('wallTimeIn', () => {
    it.each([['Europe/Rome', '12:00'], ['Asia/Kolkata', '15:30'], ['America/Los_Angeles', '03:00'], ['UTC', '10:00']])(
      'reads 2026-07-01T10:00Z in %s as %s', (timeZone, expected) => {
        expect(wallTimeIn(new Date('2026-07-01T10:00:00Z'), timeZone)).toBe(expected);
      });

    it.each(['Europe/Nowhere', '+01:00'])('throws for the zone %j', timeZone => {
      expect(() => wallTimeIn(new Date('2026-07-01T10:00:00Z'), timeZone)).toThrow(RangeError);
    });

    it('reads the last representable instants without garbling the time', () => {
      expect(wallTimeIn(new Date('9999-12-31T20:00:00Z'), 'Pacific/Kiritimati')).toBe('10:00');
    });
  });

  describe('formatInstant', () => {
    const instant = new Date('2026-07-01T10:00:00Z');

    it('writes what `utils/date.ts` writes for the same zone', () => {
      expect(formatInstant(instant, 'Europe/Rome', NUMERIC_DATE_TIME, DEFAULT_LOCALE)).toBe('01/07/2026, 12:00');
      expect(formatInstant(instant, 'Europe/Rome', NUMERIC_TIME, DEFAULT_LOCALE)).toBe('12:00');
      expect(formatInstant(instant, 'europe/rome', NUMERIC_TIME, DEFAULT_LOCALE)).toBe('12:00');
    });

    // `utils/date.ts` fell back to the process's zone and printed 'Invalid date' (ADR-035 §Formatting).
    it.each(['Roma', '+01:00', ''])('refuses the zone %j instead of falling back', timeZone => {
      expect(() => formatInstant(instant, timeZone, NUMERIC_TIME, DEFAULT_LOCALE)).toThrow(RangeError);
    });

    it('refuses an invalid date', () => {
      expect(() => formatInstant(new Date(Number.NaN), 'Europe/Rome', NUMERIC_TIME, DEFAULT_LOCALE)).toThrow(RangeError);
    });
  });

  describe('shiftEventByDays', () => {
    const at = (s: string) => new Date(s);
    const timed = (startAt: string, endAt: string | null) => ({ startAt: at(startAt), endAt: endAt ? at(endAt) : null, allDay: false });
    const shifted = (event: ReturnType<typeof timed>, days: number, timeZone = 'Europe/Rome') => {
      const result = shiftEventByDays(event, days, timeZone);
      return [iso(result.startAt), result.endAt && iso(result.endAt)];
    };

    it('keeps the wall time and the millisecond of both ends across a daylight-saving change', () => {
      // 09:00:00.123 CEST on 20 Oct → 09:00:00.123 CET on 30 Oct; two hours long before and after.
      expect(shifted(timed('2026-10-20T07:00:00.123Z', '2026-10-20T09:00:00.123Z'), 10)).toEqual(
        ['2026-10-30T08:00:00.123Z', '2026-10-30T10:00:00.123Z'],
      );
    });

    it('returns copies of the same instants for 0 days', () => {
      const event = timed('2026-10-25T01:30:00Z', '2026-10-25T02:30:00Z');
      const result = shiftEventByDays(event, 0, 'Europe/Rome');
      expect(result.startAt).not.toBe(event.startAt);
      expect([iso(result.startAt), result.endAt && iso(result.endAt)]).toEqual(['2026-10-25T01:30:00.000Z', '2026-10-25T02:30:00.000Z']);
    });

    it('reads a skipped wall time with the offset before the gap (RFC 5545)', () => {
      // 02:30 on 29 Mar 2026 does not exist in Rome: 02:30 CET is 03:30 CEST.
      expect(shifted(timed('2026-03-28T01:30:00Z', null), 1)).toEqual(['2026-03-29T01:30:00.000Z', null]);
    });

    it('lands on the first occurrence of a repeated wall time from an ordinary one', () => {
      // 02:30 on 25 Oct 2026 happens at 00:30Z (CEST) and 01:30Z (CET).
      expect(shifted(timed('2026-10-24T00:30:00Z', null), 1)).toEqual(['2026-10-25T00:30:00.000Z', null]);
    });

    it('keeps the occurrence a repeated wall time was in where the target repeats it too', () => {
      expect(shifted(timed('2026-10-25T00:30:00Z', null), 371)).toEqual(['2027-10-31T00:30:00.000Z', null]);
      expect(shifted(timed('2026-10-25T01:30:00Z', null), 371)).toEqual(['2027-10-31T01:30:00.000Z', null]);
    });

    it('moves across a day the zone skipped (Pacific/Apia, 30 Dec 2011)', () => {
      // 10:00 on 29 Dec (UTC−10) + 1 day: the 30th does not exist; read with the old offset, 10:00 on the 31st (UTC+14).
      expect(shifted(timed('2011-12-29T20:00:00Z', null), 1, 'Pacific/Apia')).toEqual(['2011-12-30T20:00:00.000Z', null]);
    });

    it('moves both dates of an all-day event by calendar days, in any zone', () => {
      const result = shiftEventByDays(
        { startAt: at('2026-03-28T00:00:00Z'), endAt: at('2026-03-29T00:00:00Z'), allDay: true }, 2, 'Pacific/Kiritimati',
      );
      expect([iso(result.startAt), result.endAt && iso(result.endAt)]).toEqual(['2026-03-30T00:00:00.000Z', '2026-03-31T00:00:00.000Z']);
    });

    // Checked first: a clone with a misconfigured zone fails before moving anything.
    it.each([
      ['an unknown zone on an all-day event', { startAt: at('2026-03-28T00:00:00Z'), endAt: null, allDay: true }, 1, 'Europe/Nowhere'],
      ['an unknown zone at 0 days', timed('2026-10-20T07:00:00Z', null), 0, 'Europe/Nowhere'],
      ['a fixed offset', timed('2026-10-20T07:00:00Z', null), 1, '+01:00'],
      ['a fractional number of days', timed('2026-10-20T07:00:00Z', null), 1.5, 'Europe/Rome'],
      ['an invalid end', { startAt: at('2026-10-20T07:00:00Z'), endAt: new Date(Number.NaN), allDay: false }, 1, 'Europe/Rome'],
    ] as const)('throws for %s', (_, event, days, timeZone) => {
      expect(() => shiftEventByDays(event, days, timeZone)).toThrow(RangeError);
    });

    describe('a day-aligned item moves by days; any other timed event keeps the wall time of each end', () => {
      const sod = (d: string, timeZone = 'Europe/Rome') => startOfDayIn(date(d), timeZone);
      /** The moved event's instants and the days it covers there — the last one is its deadline day. */
      const moved = (startAt: Date, endAt: Date, days: number, timeZone = 'Europe/Rome') => {
        const result = shiftEventByDays({ startAt, endAt, allDay: false }, days, timeZone);
        return {
          at: [iso(result.startAt), result.endAt && iso(result.endAt)],
          days: result.endAt && result.endAt > result.startAt ? eventCalendarDays(result.startAt, result.endAt, false, timeZone) : null,
        };
      };

      it.each([
        // A template item spans its days from start of day to start of the day after its last (ADR-036).
        ['a day spanning the change to winter time, +7', '2099-10-25', '2099-10-26', 7, '2099-11-01', '2099-11-02', 'Europe/Rome'],
        ['an ordinary day onto the change to summer time, +7', '2099-03-22', '2099-03-23', 7, '2099-03-29', '2099-03-30', 'Europe/Rome'],
        ['fourteen days across the change to winter time, +182', '2099-10-20', '2099-11-03', 182, '2100-04-20', '2100-05-04', 'Europe/Rome'],
        ['and back, -182', '2100-04-20', '2100-05-04', -182, '2099-10-20', '2099-11-03', 'Europe/Rome'],
        // Midnight skipped (the day starts at 01:00): Rome on 1966-05-22, Santiago on 2026-09-06.
        ['the day before a skipped midnight, +1', '1966-05-21', '1966-05-22', 1, '1966-05-22', '1966-05-23', 'Europe/Rome'],
        ['the day of a skipped midnight, -1', '1966-05-22', '1966-05-23', -1, '1966-05-21', '1966-05-22', 'Europe/Rome'],
        ['the day before a skipped midnight, +1', '2026-09-05', '2026-09-06', 1, '2026-09-06', '2026-09-07', 'America/Santiago'],
        ['the day of a skipped midnight, -1', '2026-09-06', '2026-09-07', -1, '2026-09-05', '2026-09-06', 'America/Santiago'],
        // Midnight repeated: the day starts at the first one.
        ['the day of a repeated midnight, -7', '2025-11-02', '2025-11-03', -7, '2025-10-26', '2025-10-27', 'America/Havana'],
      ] as const)('keeps a day-aligned item on its days: %s (%s)', (_, from, to, days, newFrom, newTo, timeZone) => {
        expect(moved(sod(from, timeZone), sod(to, timeZone), days, timeZone)).toEqual({
          at: [iso(sod(newFrom, timeZone)), iso(sod(newTo, timeZone))],
          // The end is exclusive: the last day covered — the deadline day — is the one before it.
          days: [newFrom, addCalendarDays(date(newTo), -1)],
        });
      });

      it('keeps the wall time of an end at the start of a day when the start is not', () => {
        // 18:00 on 24 Oct 2099 to midnight ending the 25th (the change to winter time), +7: midnight again.
        expect(moved(at('2099-10-24T16:00:00Z'), sod('2099-10-26'), 7)).toEqual({
          at: ['2099-10-31T17:00:00.000Z', iso(sod('2099-11-02'))],
          days: ['2099-10-31', '2099-11-01'],
        });
      });

      it('keeps the wall time and occurrence of an end in a repeated hour', () => {
        // 01:00 CEST to 02:30 CET (its second occurrence) on 25 Oct 2026, +1: 01:00 to 02:30 CET, not 03:30.
        expect(moved(at('2026-10-24T23:00:00Z'), at('2026-10-25T01:30:00Z'), 1).at).toEqual(
          ['2026-10-26T00:00:00.000Z', '2026-10-26T01:30:00.000Z'],
        );
        // +371 lands on 31 Oct 2027, which repeats 02:30 too: the second occurrence again.
        expect(moved(at('2026-10-24T23:00:00Z'), at('2026-10-25T01:30:00Z'), 371).at).toEqual(
          ['2027-10-30T23:00:00.000Z', '2027-10-31T01:30:00.000Z'],
        );
      });

      it('keeps the wall times of an event that starts at the end of a skipped midnight but is not day-aligned', () => {
        // 01:00 to 01:30 on 6 Sep 2026 in Santiago (the day starts at 01:00), -7: 01:00 to 01:30, not 00:00.
        expect(moved(at('2026-09-06T04:00:00Z'), at('2026-09-06T04:30:00Z'), -7, 'America/Santiago').at).toEqual(
          ['2026-08-30T05:00:00.000Z', '2026-08-30T05:30:00.000Z'],
        );
      });

      it('reads an end the target day skips with the offset before the gap, to the millisecond', () => {
        // 01:00 to 02:30:00.123 CET on 28 Mar 2026, +1: 02:30 does not exist on the 29th.
        expect(moved(at('2026-03-28T00:00:00Z'), at('2026-03-28T01:30:00.123Z'), 1).at).toEqual(
          ['2026-03-29T00:00:00.000Z', '2026-03-29T01:30:00.123Z'],
        );
      });

      it.each([
        // 02:30 CEST to 02:30 CET on 25 Oct 2026: one hour, both ends 02:30 on the 26th.
        ['would collapse', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-26T01:30:00.000Z', '2026-10-26T02:30:00.000Z'],
        // 02:45 CEST to 02:15 CET on 25 Oct 2026: thirty minutes, 02:45 to 02:15 on the 26th.
        ['would invert', '2026-10-25T00:45:00Z', '2026-10-25T01:15:00Z', '2026-10-26T01:45:00.000Z', '2026-10-26T02:15:00.000Z'],
      ])('keeps the original duration where the moved end %s', (_, startAt, endAt, newStart, newEnd) => {
        expect(moved(at(startAt), at(endAt), 1).at).toEqual([newStart, newEnd]);
      });

      it('never repairs an end before its start, which the end alone would', () => {
        // 03:00 to 02:30 CET on 28 Mar 2026, +1: 02:30 is skipped on the 29th and would read 03:30 CEST.
        expect(moved(at('2026-03-28T02:00:00Z'), at('2026-03-28T01:30:00Z'), 1).at).toEqual(
          ['2026-03-29T01:00:00.000Z', '2026-03-29T00:30:00.000Z'],
        );
      });

      it('starts a day-aligned item moved onto a date the zone skipped when the next date starts', () => {
        // Pacific/Apia had no 30 Dec 2011; the item of the 28th, +2, covers the 31st.
        expect(moved(sod('2011-12-28', 'Pacific/Apia'), sod('2011-12-29', 'Pacific/Apia'), 2, 'Pacific/Apia')).toEqual({
          at: ['2011-12-30T10:00:00.000Z', '2011-12-31T10:00:00.000Z'],
          days: ['2011-12-31', '2011-12-31'],
        });
      });

      it('leaves a day-aligned item moved past 9999 to the caller to refuse', () => {
        const result = shiftEventByDays({ startAt: sod('9999-12-01'), endAt: sod('9999-12-02'), allDay: false }, 60, 'Europe/Rome');
        expect(isInstantInRange(result.startAt, { allDay: false })).toBe(false);
      });
    });
  });
});

describe('wallClockDate', () => {
  it.each([
    // 10:00:00.123Z on 1 July: 12:00 in Rome (CEST), 03:00 in Los Angeles (PDT), 15:30 in Kolkata.
    ['Europe/Rome', '2026-07-01T12:00:00.123Z'],
    ['America/Los_Angeles', '2026-07-01T03:00:00.123Z'],
    ['Asia/Kolkata', '2026-07-01T15:30:00.123Z'],
  ])('writes the wall clock of %s in the UTC fields, to the millisecond', (timeZone, expected) => {
    expect(iso(wallClockDate(new Date('2026-07-01T10:00:00.123Z'), timeZone))).toBe(expected);
  });

  it('writes the day the zone is on, across midnight', () => {
    // 23:30Z on 30 June is already 1 July in Rome.
    expect(iso(wallClockDate(new Date('2026-06-30T23:30:00Z'), 'Europe/Rome'))).toBe('2026-07-01T01:30:00.000Z');
  });

  it.each([
    ['an unknown zone', new Date('2026-07-01T10:00:00Z'), 'Europe/Nowhere'],
    ['an invalid date', new Date(Number.NaN), 'Europe/Rome'],
  ])('throws for %s', (_, instant, timeZone) => {
    expect(() => wallClockDate(instant, timeZone)).toThrow(RangeError);
  });
});

// A comparison of milliseconds: no process zone to vary.
describe('isInstantInRange', () => {
  it.each([
    ['1900-01-01T00:00:00.000Z', true, true],
    ['1899-12-31T23:59:59.999Z', true, false],
    ['9999-12-30T00:00:00.000Z', true, true],
    ['9999-12-31T00:00:00.000Z', true, false],
    ['1900-01-01T05:00:00.000Z', false, false],
    ['1900-01-02T00:00:00.000Z', false, true],
    ['9999-12-29T23:59:59.999Z', false, true],
    ['9999-12-30T00:00:00.000Z', false, false],
    ['not a date', true, false],
    ['not a date', false, false],
  ])('%s, allDay %s → %s', (value, allDay, expected) => {
    expect(isInstantInRange(new Date(value), { allDay })).toBe(expected);
  });
});
