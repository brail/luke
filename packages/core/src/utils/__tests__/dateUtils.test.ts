import process from 'node:process';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import {
  addCalendarDays,
  calendarDateIn,
  calendarDateOf,
  calendarDaysBetween,
  instantAt,
  isValidTimeZone,
  isWorkingDate,
  parseCalendarDate,
  startOfDayIn,
  utcMidnightOf,
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
});
