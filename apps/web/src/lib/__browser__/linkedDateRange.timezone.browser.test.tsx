import { describe, expect, test } from 'vitest';

import { applyLinkedEdit, rangeFromEvent, resolveIso, toDateInput, toTimeInput, UNTOUCHED_SIDES } from '../linkedDateRange';

/**
 * The event form's date fields under each zone of `vitest.browser.timezone.config.mts`. An all-day
 * value is a calendar date stored at UTC midnight: reading it with local getters showed the day
 * before west of UTC, and because the form always resubmits its dates, saving any other field moved
 * the event back a day. A timed value is an instant shown in the browser zone.
 */

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe(`event form date fields (${ZONE})`, () => {
  test('an all-day value reads as its own date, with no time of its own', () => {
    expect(toDateInput('2026-03-10T00:00:00.000Z', true)).toBe('2026-03-10');
    expect(toTimeInput('2026-03-10T00:00:00.000Z', true)).toBe('09:00');
  });

  test('an all-day event loads and resubmits unchanged', () => {
    const startAt = '2026-03-10T00:00:00.000Z';
    const endAt = '2026-03-12T00:00:00.000Z';
    const range = rangeFromEvent(startAt, endAt, true);
    expect([range.startDate, range.endDate]).toEqual(['2026-03-10', '2026-03-12']);
    expect(resolveIso(range.startDate, range.startTime, true)).toBe(startAt);
    expect(resolveIso(range.endDate, range.endTime, true)).toBe(endAt);
  });

  test('a timed event loads and resubmits unchanged', () => {
    const startAt = new Date(2026, 2, 10, 9, 30).toISOString();
    const endAt = new Date(2026, 2, 10, 11, 0).toISOString();
    const range = rangeFromEvent(startAt, endAt, false);
    expect([range.startTime, range.endTime]).toEqual(['09:30', '11:00']);
    expect(resolveIso(range.startDate, range.startTime, false)).toBe(startAt);
    expect(resolveIso(range.endDate, range.endTime, false)).toBe(endAt);
  });

  test('an all-day event with no end loads with the same end date and a later end time', () => {
    const range = rangeFromEvent('2026-03-10T00:00:00.000Z', null, true);
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
