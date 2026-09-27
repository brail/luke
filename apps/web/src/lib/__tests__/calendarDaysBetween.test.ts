/**
 * The calendar's `daysBetween` is core's calendar-date difference. The web used to keep its own
 * copy that rounded raw milliseconds, so two times of day on consecutive dates could count as 0
 * days (Monday 22:00 to Tuesday 08:00), shifting the baseline delta the event dialog shows.
 */

import { describe, expect, it } from 'vitest';

import { daysBetween } from '../../app/(app)/calendar/utils';

describe('calendar daysBetween', () => {
  it('counts calendar dates, not 24-hour spans', () => {
    expect(daysBetween(new Date(2026, 9, 5, 22), new Date(2026, 9, 6, 8))).toBe(1);
    expect(daysBetween(new Date(2026, 9, 6, 8), new Date(2026, 9, 5, 22))).toBe(-1);
    expect(daysBetween(new Date(2026, 9, 5, 1), new Date(2026, 9, 5, 23))).toBe(0);
  });
});
