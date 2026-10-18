/**
 * The date grids of the season calendar PDF — week, month, Gantt months — are calendar-date
 * arithmetic, so the process zone cannot move them. The matrix switches `process.env.TZ`, which
 * Node honours in vitest's default forked worker; a guard proves the switch took effect.
 */

import process from 'node:process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCalendarDate, type CalendarDate } from '@luke/core';

import { ganttMonths, monthGrid, weekDays } from '../src/routes/seasonCalendarExport.routes';

function date(value: string): CalendarDate {
  const parsed = parseCalendarDate(value);
  if (!parsed) throw new Error(`not a calendar date: ${value}`);
  return parsed;
}

describe.each([
  ['UTC', 0],
  ['America/Los_Angeles', 480],
  ['Pacific/Kiritimati', -840],
])('export grids under TZ=%s', (timeZone, januaryOffsetMinutes) => {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.TZ;
    process.env.TZ = timeZone;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  it('runs in the intended process zone', () => {
    expect(new Date(Date.UTC(2032, 0, 15)).getTimezoneOffset()).toBe(januaryOffsetMinutes);
  });

  it('builds the Monday-to-Sunday week, also on the Sunday clocks go back', () => {
    expect(weekDays(date('2026-10-25'))).toEqual(
      ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'],
    );
    expect(weekDays(date('2026-03-30'))[0]).toBe('2026-03-30');
  });

  it('builds a 42-day month grid from the Monday on or before the 1st, for a date on the 31st', () => {
    const { month, cells } = monthGrid(date('2032-01-31'));
    expect(month).toBe('2032-01');
    expect(cells).toHaveLength(42);
    expect([cells[0], cells[41]]).toEqual(['2031-12-29', '2032-02-08']);
  });

  it('lists every Gantt month from the first start to the last end, across a new year', () => {
    expect(ganttMonths([
      { firstDay: date('2031-11-20'), lastDay: date('2032-02-03') },
      { firstDay: date('2031-12-01'), lastDay: date('2031-12-01') },
    ])).toEqual(['2031-11', '2031-12', '2032-01', '2032-02']);
  });
});
