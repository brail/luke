/**
 * `workingDaysBetween` follows `daysBetween`'s convention: a difference of dates, time of day
 * ignored, the start date excluded and the end date included. It used to step between instants
 * counting both endpoints, so an all-day milestone due today scored −1 and its row went late on
 * the due date.
 */

import { describe, it, expect } from 'vitest';

import { daysBetween, workingDaysBetween, type WorkingDayHoliday } from '../dateUtils.js';

// Local dates: 2026-09-28 is a Monday.
const at = (month: number, day: number, hour = 0) => new Date(2026, month - 1, day, hour);
const MON_10 = at(9, 28, 10);
const working = (from: Date, to: Date, holidays: WorkingDayHoliday[] = []) =>
  workingDaysBetween(from, to, ['IT'], holidays);

describe('workingDaysBetween', () => {
  it.each([
    ['Monday, all-day', 0, at(9, 28)],
    ['Monday 18:00', 0, at(9, 28, 18)],
    ['Tuesday, all-day', 1, at(9, 29)],
    ['Tuesday 18:00', 1, at(9, 29, 18)],
    ['next Monday, all-day', 5, at(10, 5)],
  ] as const)('from Monday 10:00 to %s → %i', (_label, expected, deadline) => {
    expect(working(MON_10, deadline)).toBe(expected);
  });

  it('matches daysBetween when every day in range is a working day', () => {
    expect(working(MON_10, at(10, 2))).toBe(daysBetween(MON_10, at(10, 2)));
    expect(working(at(9, 29, 10), at(9, 28))).toBe(-1);
  });

  it('a Friday deadline seen on Saturday is one working day late', () => {
    expect(working(at(10, 3, 10), at(10, 2))).toBe(-1);
  });

  it('a Sunday deadline leaves no working day on Friday and none past it on Monday', () => {
    expect(working(at(10, 2, 10), at(10, 4))).toBe(0);
    // `toBe` is `Object.is`: this also rules out -0.
    expect(working(at(10, 5, 10), at(10, 4))).toBe(0);
  });

  it('skips a holiday of a listed country, not of another one', () => {
    const tuesday = { startDate: at(9, 29), endDate: at(9, 29) };
    expect(working(MON_10, at(10, 5), [{ countryCode: 'IT', ...tuesday }])).toBe(4);
    expect(working(MON_10, at(10, 5), [{ countryCode: 'CN', ...tuesday }])).toBe(5);
  });
});
