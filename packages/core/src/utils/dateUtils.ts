// ─── Calendar dates ──────────────────────────────────────────────────────────

/**
 * A day on the calendar with no time and no zone — an all-day event, a holiday, an anchor date —
 * as `'YYYY-MM-DD'`, years 1900–9999. An instant stays a `Date`, and turning one into a day always
 * names a zone (`calendarDateIn`): the two can no longer be mixed without `tsc` failing, which is
 * the defect class that reading an all-day `Date` in the wrong zone kept producing. Google
 * Calendar's model (`start.date` vs `start.dateTime`); storage is unchanged (`@db.Date`, or a
 * timestamp at UTC midnight plus `allDay`). The brand is static only: values are made exclusively
 * by the functions below, which validate them.
 */
export type CalendarDate = string & { readonly __brand: 'CalendarDate' };

/** A holiday or closure period for a country, as calendar dates (both ends included). */
export interface CalendarHoliday {
  countryCode: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MIN_CALENDAR_DATE = '1900-01-01';

/** Milliseconds at the UTC midnight of `date`. */
function utcMs(date: CalendarDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** The UTC calendar date of `ms`. Throws a `RangeError` for an invalid time or a year outside 1900–9999. */
function utcDateOf(ms: number): CalendarDate {
  const iso = new Date(ms).toISOString(); // RangeError on an invalid time
  // A year past 9999 is written `+010000-…`, so the length check covers the upper bound.
  if (iso.length !== 24 || iso < MIN_CALENDAR_DATE) throw new RangeError(`Calendar date out of range: ${iso}`);
  // Type assertion: the brand is nominal, and `iso` has just been checked as a date in range.
  return iso.slice(0, 10) as CalendarDate;
}

/**
 * Parses `'YYYY-MM-DD'` into a `CalendarDate`, or `null` when it is malformed, does not exist
 * (`2026-02-30`, which `Date.parse` silently rolls over to March) or falls outside 1900–9999.
 */
export function parseCalendarDate(s: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < MIN_CALENDAR_DATE) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  // Compared before `utcDateOf`: a rolled-over date is refused, never thrown on, in any engine.
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(s) ? utcDateOf(ms) : null;
}

/**
 * The calendar date of a stored all-day or holiday value (UTC midnight), time of day ignored.
 * Throws a `RangeError` for an invalid `Date` or a year outside 1900–9999.
 */
export function calendarDateOf(stored: Date): CalendarDate {
  return utcDateOf(stored.getTime());
}

/** The UTC midnight of `date` — the stored form, for Prisma writes and queries. */
export function utcMidnightOf(date: CalendarDate): Date {
  return new Date(utcMs(date));
}

/** `date` plus `days` whole days (negative goes back). Throws a `RangeError` outside 1900–9999. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  return utcDateOf(utcMs(date) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`: positive when `to` is later, 0 (never -0) on the same date. */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  return (utcMs(to) - utcMs(from)) / MS_PER_DAY;
}

/**
 * `true` for Monday–Friday not covered by a holiday of one of `countryCodes`.
 *
 * @param countryCodes - If empty, holidays are applied regardless of country
 */
export function isWorkingDate(date: CalendarDate, countryCodes: string[], holidays: CalendarHoliday[]): boolean {
  const dow = new Date(utcMs(date)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.some(h =>
    (countryCodes.length === 0 || countryCodes.includes(h.countryCode)) && date >= h.startDate && date <= h.endDate,
  );
}

/**
 * `calendarDaysBetween` counting only working dates: from `from` (excluded) to `to` (included), in
 * either direction, so the same date gives 0 and a range with no non-working date equals
 * `calendarDaysBetween`. Negative when `to` is before `from`.
 */
export function workingDaysBetweenDates(
  from: CalendarDate,
  to: CalendarDate,
  countryCodes: string[],
  holidays: CalendarHoliday[],
): number {
  const days = calendarDaysBetween(from, to);
  const step = Math.sign(days);
  let count = 0;
  for (let i = 1; i <= Math.abs(days); i++) {
    if (isWorkingDate(addCalendarDays(from, step * i), countryCodes, holidays)) count++;
  }
  // `0 - count`, not `-count`: no working day backward must be 0, not -0.
  return days < 0 ? 0 - count : count;
}

/**
 * Formatters by zone. Building one costs far more than using it, and a criticality batch builds
 * several per row. Only zones `Intl` accepted are stored, so the map is bounded by the zone list.
 */
const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

/** A formatter reading the wall clock of `timeZone`. Throws a `RangeError` for an unknown zone. */
function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  let format = wallClockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    wallClockFormats.set(timeZone, format);
  }
  return format;
}

/** The wall clock at `ms` in the formatter's zone, to the second, written as if it were UTC. */
function wallClockMs(format: Intl.DateTimeFormat, ms: number): number {
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const { type, value } of format.formatToParts(ms)) part[type] = Number(value);
  const wall = new Date(0);
  // Not `Date.UTC`: it maps years 0–99 to 1900–1999.
  wall.setUTCFullYear(part.year ?? NaN, (part.month ?? NaN) - 1, part.day ?? NaN);
  wall.setUTCHours(part.hour ?? NaN, part.minute ?? NaN, part.second ?? NaN);
  return wall.getTime();
}

/** The zone's UTC offset at `ms`, in milliseconds (whole seconds: tzdb has no finer offsets). */
function offsetMs(format: Intl.DateTimeFormat, ms: number): number {
  const second = Math.floor(ms / 1000) * 1000;
  return wallClockMs(format, second) - second;
}

/**
 * The calendar date `instant` falls on in `timeZone` (IANA). Throws a `RangeError` for an unknown
 * zone, an invalid `Date` or a year outside 1900–9999.
 */
export function calendarDateIn(instant: Date, timeZone: string): CalendarDate {
  return utcDateOf(wallClockMs(wallClockFormat(timeZone), instant.getTime()));
}

/**
 * `date` written with `Intl` `options` in `locale`. Zone-free: its UTC midnight read in UTC, so a
 * reader west of UTC never sees the day before.
 */
export function formatCalendarDate(date: CalendarDate, options: Intl.DateTimeFormatOptions, locale = 'it-IT'): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(utcMidnightOf(date));
}

/**
 * The first and last calendar dates an event covers for a reader in `timeZone`: an all-day event its
 * stored dates, never converted to a zone; a timed one the dates of its instants there, the end
 * exclusive — an event ending at local midnight does not reach the next day. Throws a `RangeError`
 * for an invalid `Date` or a year outside 1900–9999, and, for a timed event, an unknown zone.
 */
export function eventCalendarDays(
  startAt: Date,
  endAt: Date | null,
  allDay: boolean,
  timeZone: string,
): [CalendarDate, CalendarDate] {
  if (allDay) return [calendarDateOf(startAt), calendarDateOf(endAt ?? startAt)];
  const last = endAt && endAt > startAt ? new Date(endAt.getTime() - 1) : startAt;
  return [calendarDateIn(startAt, timeZone), calendarDateIn(last, timeZone)];
}

/**
 * The earliest instant at which the local date in `timeZone` is `date` or later — the start of
 * `date`, even when its midnight is skipped (the day then starts at the transition) or repeated
 * (the first one). A date the zone skipped altogether (Pacific/Apia 2011-12-30) starts when the
 * next one does, so "the start of D + 1" is always an instant. Throws a `RangeError` for an
 * unknown zone.
 */
export function startOfDayIn(date: CalendarDate, timeZone: string): Date {
  return instantAt(date, '00:00', timeZone);
}

/**
 * The earliest instant at which the wall clock in `timeZone` reads `time` (`'HH:mm'`) on `date` or
 * later: a wall time the zone skips (spring forward) is the first instant after the jump, one it
 * repeats (fall back) is its first occurrence. Throws a `RangeError` for an unknown zone or a
 * malformed time.
 *
 * With W the wall time written as if it were UTC, the answer lies in [W − 15 h, W + 13 h) for any
 * offset in [−12 h, +14 h]. With one offset in the window it is W − offset. With two, the transition
 * T is found to the second, and within each constant-offset piece the wall clock reads W or later
 * exactly from W − offset on: the answer is the first such point.
 *
 * ponytail: assumes offsets within [−12 h, +14 h] and at most one offset change in those 28 hours
 * — true of the tzdb data since 1900, checked once rather than guaranteed by IANA (future rules
 * are predictions). A zone breaking it would need the transitions scanned across the window.
 */
export function instantAt(date: CalendarDate, time: string, timeZone: string): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new RangeError(`Not a wall time: ${time}`);
  const format = wallClockFormat(timeZone);
  const wall = utcMs(date) + (Number(match[1]) * 60 + Number(match[2])) * 60_000;
  let before = wall - 15 * MS_PER_HOUR;
  let after = wall + 13 * MS_PER_HOUR;
  const offsetBefore = offsetMs(format, before);
  const offsetAfter = offsetMs(format, after);
  if (offsetBefore === offsetAfter) return new Date(wall - offsetBefore);

  // Bisect to the first second on the new offset; both bounds stay whole seconds.
  while (after - before > 1000) {
    const mid = before + Math.floor((after - before) / 2000) * 1000;
    if (offsetMs(format, mid) === offsetBefore) before = mid;
    else after = mid;
  }
  const transition = after;
  const onOldOffset = wall - offsetBefore;
  return new Date(onOldOffset < transition ? onOldOffset : Math.max(transition, wall - offsetAfter));
}

/**
 * `true` when `timeZone` is a zone name `Intl` knows. A fixed offset such as `'+01:00'`, which
 * `Intl` also accepts, is refused: it is not an IANA name and has no daylight-saving rules. The
 * check reads the name `Intl` resolves to, so every spelling it normalises to an offset is caught
 * (`'−01:00'`, with U+2212, becomes `'-01:00'`).
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    return !/^[+-]/.test(new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}
