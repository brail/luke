/**
 * The date primitives the API accepts. Luke plans by calendar days and records instants; both stay
 * within 1900–9999, the years the calendar-date helpers in `utils/dateUtils.ts` represent.
 */

import { z } from 'zod';

import { parseCalendarDate } from '../utils/dateUtils.js';

/**
 * A `YYYY-MM-DD` calendar date that exists (`2026-02-30` is refused), from 1900-01-01 to 9999-12-30.
 * A range of days ends where the day after its last one starts, and the day after 9999-12-31 cannot
 * be represented.
 */
export const CalendarDateSchema = z.string().transform((value, ctx) => {
  const date = parseCalendarDate(value);
  if (date === null || date >= '9999-12-31') {
    ctx.addIssue({ code: 'custom', message: 'Data non valida' });
    return z.NEVER;
  }
  return date;
});

/**
 * An instant as the API accepts it: ISO 8601 (UTC, four-digit year) within 1900–9999. A year typed
 * as "26" would otherwise be stored as year 26 and make every deadline evaluation on it throw.
 */
export const CalendarInstantSchema = z
  .string()
  .datetime()
  .refine(value => value >= '1900', 'Anno fuori intervallo (1900–9999)');
