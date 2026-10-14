import { describe, expect, test } from 'vitest';

import { applyLinkedEdit, rangeFromEvent, resolveSide, UNTOUCHED_SIDES } from '../linkedDateRange';

import { at, PROFILE, ZONE } from './zoneFixtures';

/**
 * The event form's date fields under each zone of `vitest.browser.timezone.config.mts`. An all-day
 * value is a calendar date stored at UTC midnight: reading it with local getters showed the day
 * before west of UTC, and because the form always resubmits its dates, saving any other field moved
 * the event back a day. A timed value is an instant read in the zone the form captured — the
 * profile zone, never the browser's (ADR-035).
 */

describe(`event form date fields (${ZONE})`, () => {
  test('an all-day value reads as its own date, with no time of its own', () => {
    expect(rangeFromEvent('2026-03-10T00:00:00.000Z', null, true, PROFILE)).toMatchObject({ startDate: '2026-03-10', startTime: '09:00' });
  });

  test('an all-day event loads and resubmits unchanged', () => {
    const startAt = '2026-03-10T00:00:00.000Z';
    const endAt = '2026-03-12T00:00:00.000Z';
    const range = rangeFromEvent(startAt, endAt, true, PROFILE);
    expect([range.startDate, range.endDate]).toEqual(['2026-03-10', '2026-03-12']);
    expect(resolveSide(range.startDate, range.startTime, true, PROFILE)).toBe(startAt);
    expect(resolveSide(range.endDate, range.endTime, true, PROFILE)).toBe(endAt);
  });

  test('a timed event loads in the profile zone and resubmits unchanged', () => {
    // 23:30 in the profile zone is the next day east of it, 00:30 the day before west of it.
    for (const [startTime, endTime] of [['09:30', '11:00'], ['00:30', '01:00'], ['23:00', '23:30']]) {
      const startAt = at('2026-03-10', startTime!).toISOString();
      const endAt = at('2026-03-10', endTime!).toISOString();
      const range = rangeFromEvent(startAt, endAt, false, PROFILE);
      expect(range).toEqual({ startDate: '2026-03-10', startTime, endDate: '2026-03-10', endTime });
      expect(resolveSide(range.startDate, range.startTime, false, PROFILE)).toBe(startAt);
      expect(resolveSide(range.endDate, range.endTime, false, PROFILE)).toBe(endAt);
    }
  });

  test('an all-day event with no end loads with the same end date and a later end time', () => {
    const range = rangeFromEvent('2026-03-10T00:00:00.000Z', null, true, PROFILE);
    expect(range).toEqual({ startDate: '2026-03-10', startTime: '09:00', endDate: '2026-03-10', endTime: '10:00' });
  });

  test('a linked all-day shift moves the other date by whole days and leaves the times alone', () => {
    const range = { startDate: '2026-03-10', startTime: '09:00', endDate: '2026-03-12', endTime: '10:00' };
    const { next } = applyLinkedEdit(range, 'start', { startDate: '2026-03-27' }, true, UNTOUCHED_SIDES);
    // Across the Rome and Los Angeles spring changes, still whole days.
    expect(next).toEqual({ startDate: '2026-03-27', startTime: '09:00', endDate: '2026-03-29', endTime: '10:00' });
  });

  test('typing a year digit by digit moves the linked end by the final difference only', () => {
    // A date input emits every intermediate year (0002, 0020, 0202) while one is typed.
    const range = { startDate: '2026-03-27', startTime: '09:00', endDate: '2026-03-29', endTime: '10:00' };
    for (const allDay of [true, false]) {
      let state = range;
      for (const startDate of ['0002-03-27', '0020-03-27', '0202-03-27', '2027-03-27']) {
        state = applyLinkedEdit(state, 'start', { startDate }, allDay, UNTOUCHED_SIDES).next;
      }
      expect(state.endDate).toBe('2027-03-29');
    }
  });

  test('an all-day end moved before the start pulls the start onto the same date', () => {
    const range = { startDate: '2026-03-10', startTime: '09:00', endDate: '2026-03-12', endTime: '10:00' };
    const { next } = applyLinkedEdit(range, 'end', { endDate: '2026-03-08' }, true, { start: true, end: true });
    expect(next).toEqual({ startDate: '2026-03-08', startTime: '09:00', endDate: '2026-03-08', endTime: '10:00' });
  });
});
