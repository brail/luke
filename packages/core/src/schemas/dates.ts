/**
 * The date primitives the API accepts (ADR-035): calendar days and instants, which stay within the
 * years the helpers in `utils/dateUtils.ts` represent, wall times and time zones.
 */

import { z } from 'zod';

import { WALL_TIME_PATTERN, canonicalTimeZone, isInstantInRange, isValidTimeZone, parseCalendarDate, utcMidnightOf } from '../utils/dateUtils.js';

/**
 * A `YYYY-MM-DD` calendar date that exists (`2026-02-30` is refused), from 1900-01-01 to 9999-12-30.
 * A range of days ends where the day after its last one starts, and the day after 9999-12-31 cannot
 * be represented.
 */
export const CalendarDateSchema = z.string().transform((value, ctx) => {
  const date = parseCalendarDate(value);
  if (date === null || !isInstantInRange(utcMidnightOf(date), { allDay: true })) {
    ctx.addIssue({ code: 'custom', message: 'Data non valida' });
    return z.NEVER;
  }
  return date;
});

/**
 * An instant as the API accepts it: ISO 8601 (UTC, four-digit year) whose UTC date is a calendar
 * date, so it also carries an all-day value stored at UTC midnight. A year typed as "26" would
 * otherwise be stored as year 26 and make every deadline evaluation on it throw. A timed event's
 * narrower range is checked by `assertEventDates`, on its effective `allDay` (ADR-035).
 */
export const CalendarInstantSchema = z
  .string()
  // `abort`: a malformed value gets one issue, not also the range one (Zod 4 runs the refine anyway).
  .datetime({ abort: true })
  .refine(value => isInstantInRange(new Date(value), { allDay: true }), "Data fuori dall'intervallo supportato");

/** A time of day with no date and no zone of its own (`WALL_TIME_PATTERN`). */
export const WallTimeSchema = z.string().regex(WALL_TIME_PATTERN, 'Formato orario non valido (HH:mm)');

/**
 * An IANA zone (`isValidTimeZone`) in `canonicalTimeZone`'s spelling (ADR-035). `User.timezone`
 * stores the parsed value; an AppConfig value is stored as written and read through this schema.
 */
export const TimeZoneSchema = z.string().refine(isValidTimeZone, 'Fuso orario non valido').transform(canonicalTimeZone);
