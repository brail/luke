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
/** The last date Luke accepts: the day after it, 9999-12-31, is the last the helpers represent. */
const MAX_CALENDAR_DATE = '9999-12-30';

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

/** `[start, end)` in ms, the UTC midnights of every accepted date; a timed instant one day inside it. */
const ALL_DAY_RANGE = [Date.parse(`${MIN_CALENDAR_DATE}T00:00:00Z`), Date.parse(`${MAX_CALENDAR_DATE}T00:00:00Z`) + MS_PER_DAY] as const;
const TIMED_RANGE = [ALL_DAY_RANGE[0] + MS_PER_DAY, ALL_DAY_RANGE[1] - MS_PER_DAY] as const;

/**
 * `true` when `instant` lies in the range Luke stores (ADR-035 §Bounds): an all-day value's UTC date
 * is an accepted date; a timed instant's date in every zone from UTC−12 to UTC+14, and the day after
 * it, are too. Outside it `calendarDateIn` or `addCalendarDays` can throw. An invalid `Date` is out
 * of range.
 */
export function isInstantInRange(instant: Date, { allDay }: { allDay: boolean }): boolean {
  const [start, end] = allDay ? ALL_DAY_RANGE : TIMED_RANGE;
  const ms = instant.getTime();
  return ms >= start && ms < end;
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

/** Days since the Monday of `date`'s week: 0 on Monday, 6 on Sunday. */
function isoWeekdayIndex(date: CalendarDate): number {
  return (new Date(utcMs(date)).getUTCDay() + 6) % 7;
}

/** The Monday of the ISO 8601 week `date` falls in. */
export function startOfIsoWeek(date: CalendarDate): CalendarDate {
  return addCalendarDays(date, -isoWeekdayIndex(date));
}

/**
 * The ISO 8601 week of `date`: weeks start on Monday and week 1 holds the year's first Thursday, so
 * 2021-01-03 is week 53 of 2020 and 2024-12-30 week 1 of 2025.
 */
export function isoWeekOf(date: CalendarDate): { year: number; week: number } {
  const thursday = utcMs(date) + (3 - isoWeekdayIndex(date)) * MS_PER_DAY;
  const year = new Date(thursday).getUTCFullYear();
  // `Date.UTC` maps years 0–99 to 1900–1999; Luke's years start at 1900, so it cannot apply here.
  return { year, week: 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * MS_PER_DAY)) };
}

/**
 * Formatters by resolved zone name. Building one costs far more than using it, and a criticality
 * batch builds several per row. Keyed by the name `Intl` resolves, so the map is bounded by the zone
 * list whatever the spelling.
 */
const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A formatter reading the wall clock of `timeZone`. Throws a `RangeError` for an unknown zone or a
 * fixed offset such as `'+01:00'`, which has no daylight-saving rules (ADR-035 §Formatting).
 */
function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  const zone = requireZone(timeZone);
  let format = wallClockFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    wallClockFormats.set(zone, format);
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
 * The wall time (`'HH:mm'`, 24-hour clock) `instant` shows in `timeZone` (IANA). Throws a
 * `RangeError` for an unknown zone or an invalid `Date`.
 */
export function wallTimeIn(instant: Date, timeZone: string): string {
  const wall = new Date(wallClockMs(wallClockFormat(timeZone), instant.getTime()));
  return `${String(wall.getUTCHours()).padStart(2, '0')}:${String(wall.getUTCMinutes()).padStart(2, '0')}`;
}

/** The one locale dates are written in until the i18n cycle (ADR-035 §Formatting). */
export const DEFAULT_LOCALE = 'it-IT';

// The presets are frozen: every caller shares them, and one that wrote into them would change every
// later date in the process.

/** `dd/mm/yyyy` in it-IT: the day-only numeric form the tables, tooltips and exports use. */
export const NUMERIC_DATE: Readonly<Intl.DateTimeFormatOptions> = Object.freeze({ day: '2-digit', month: '2-digit', year: 'numeric' });

/** `dd/mm/yyyy, hh:mm` in it-IT: an instant's date and wall time. */
export const NUMERIC_DATE_TIME: Readonly<Intl.DateTimeFormatOptions> = Object.freeze({ ...NUMERIC_DATE, hour: '2-digit', minute: '2-digit' });

/** `hh:mm` in it-IT: an instant's wall time. */
export const NUMERIC_TIME: Readonly<Intl.DateTimeFormatOptions> = Object.freeze({ hour: '2-digit', minute: '2-digit' });

const intlFormats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per locale, zone and options, reused: views and exports format once per row. */
function intlFormat(locale: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = intlFormats.get(key);
  if (!format) intlFormats.set(key, (format = new Intl.DateTimeFormat(locale, { ...options, timeZone })));
  return format;
}

/**
 * `date` written with `Intl` `options` in `locale`. Zone-free: its UTC midnight read in UTC, so a
 * reader west of UTC never sees the day before.
 */
export function formatCalendarDate(date: CalendarDate, options: Intl.DateTimeFormatOptions, locale = DEFAULT_LOCALE): string {
  return intlFormat(locale, 'UTC', options).format(utcMidnightOf(date));
}

/**
 * `instant` written with `Intl` `options` in `locale`, read in `timeZone` (IANA). Both are required
 * (CLAUDE.md §Dates & Time Zones): an unknown zone or a fixed offset throws a `RangeError` rather
 * than falling back to the process's zone, and so does an invalid `Date`.
 */
export function formatInstant(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions, locale: string): string {
  return intlFormat(locale, requireZone(timeZone), options).format(instant);
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

/** `HH:mm` on the 24-hour clock; groups: hours, minutes. */
export const WALL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
  const match = WALL_TIME_PATTERN.exec(time);
  if (!match) throw new RangeError(`Not a wall time: ${time}`);
  const wall = utcMs(date) + (Number(match[1]) * 60 + Number(match[2])) * 60_000;
  return new Date(resolveWall(wallClockFormat(timeZone), wall, { second: false, skipped: 'gapEnd' }));
}

/**
 * The instant at which the wall clock of `format`'s zone reads `wall` (ms, written as if it were
 * UTC) — see `instantAt` for the search. A repeated wall time gives its first occurrence, or the
 * second when `second` is set; a skipped one gives the first instant after the gap (`'gapEnd'`) or
 * the wall time read with the offset before the gap (`'offsetBefore'`, RFC 5545 and `Temporal`'s
 * `compatible`: as far past the gap as it was past the hour).
 */
function resolveWall(
  format: Intl.DateTimeFormat,
  wall: number,
  { second, skipped }: { second: boolean; skipped: 'gapEnd' | 'offsetBefore' },
): number {
  // Whole-second bounds: offsets change on whole seconds, and the bisection keeps them whole.
  let before = Math.floor(wall / 1000) * 1000 - 15 * MS_PER_HOUR;
  let after = before + 28 * MS_PER_HOUR;
  const offsetBefore = offsetMs(format, before);
  const offsetAfter = offsetMs(format, after);
  if (offsetBefore === offsetAfter) return wall - offsetBefore;

  // Bisect to the first second on the new offset.
  while (after - before > 1000) {
    const mid = before + Math.floor((after - before) / 2000) * 1000;
    if (offsetMs(format, mid) === offsetBefore) before = mid;
    else after = mid;
  }
  const transition = after;
  const onOld = wall - offsetBefore;
  const onNew = wall - offsetAfter;
  const oldReadsWall = onOld < transition;
  const newReadsWall = onNew >= transition;
  if (oldReadsWall && newReadsWall) return second ? onNew : onOld;
  if (oldReadsWall) return onOld;
  if (newReadsWall) return onNew;
  return skipped === 'gapEnd' ? transition : onOld;
}

/**
 * An event moved by `days` whole calendar days, ADR-036: all-day dates by calendar arithmetic. A
 * timed event with both ends at the start of their day in `timeZone` and the end after the start —
 * a template item — moves each to the start of the day `days` later (a day whose midnight is
 * skipped starts at the end of the gap, a skipped date when the next one does); any other timed
 * event keeps the wall time of each end to the millisecond (skipped: offset before the gap, as
 * RFC 5545; repeated: its occurrence where it exists, else the first). The moved end is kept only
 * where it still comes after the moved start, as the original did; otherwise it follows at the
 * original duration, so a positive interval never collapses or inverts and an inverted one is never
 * repaired. `days === 0` returns copies. Throws a `RangeError` for a bad zone (checked first),
 * fractional `days`, an invalid `Date` or an all-day result outside 1900–9999; a timed result
 * outside the stored range is the caller's to refuse (`isInstantInRange`).
 */
export function shiftEventByDays(
  event: { startAt: Date; endAt: Date | null; allDay: boolean },
  days: number,
  timeZone: string,
): { startAt: Date; endAt: Date | null } {
  const { startAt, endAt, allDay } = event;
  const format = wallClockFormat(timeZone);
  if (!Number.isInteger(days)) throw new RangeError(`Not a whole number of days: ${days}`);
  if (Number.isNaN(startAt.getTime()) || (endAt && Number.isNaN(endAt.getTime()))) throw new RangeError('Invalid event date');
  if (days === 0) return { startAt: new Date(startAt), endAt: endAt && new Date(endAt) };
  if (allDay) {
    const shift = (d: Date) => utcMidnightOf(addCalendarDays(calendarDateOf(d), days));
    return { startAt: shift(startAt), endAt: endAt ? shift(endAt) : null };
  }
  /** The wall clock at `instant`, to the millisecond, written as if it were UTC. */
  const wallOf = (instant: Date): number => {
    const ms = instant.getTime();
    const subSecond = ms - Math.floor(ms / 1000) * 1000;
    return wallClockMs(format, ms - subSecond) + subSecond;
  };
  /** The start of the day `n` days after the local day of `wall`, as `startOfDayIn` resolves it. */
  const dayStart = (wall: number, n: number) =>
    resolveWall(format, (Math.floor(wall / MS_PER_DAY) + n) * MS_PER_DAY, { second: false, skipped: 'gapEnd' });
  const dayAligned = endAt !== null && endAt > startAt && [startAt, endAt].every(d => dayStart(wallOf(d), 0) === d.getTime());
  const move = (instant: Date): number => {
    const wall = wallOf(instant);
    if (dayAligned) return dayStart(wall, days);
    // Was it the later occurrence of a repeated wall time?
    const second = resolveWall(format, wall, { second: false, skipped: 'gapEnd' }) !== instant.getTime();
    return resolveWall(format, wall + days * MS_PER_DAY, { second, skipped: 'offsetBefore' });
  };
  const start = move(startAt);
  if (!endAt) return { startAt: new Date(start), endAt: null };
  const duration = endAt.getTime() - startAt.getTime();
  // A zero-length or inverted source keeps its duration — an inverted one for the caller to refuse.
  const end = duration > 0 ? move(endAt) : start + duration;
  return { startAt: new Date(start), endAt: new Date(end > start ? end : start + duration) };
}

/**
 * The names `Intl` resolves zone spellings to, keyed by the spelling with ASCII letters lower-cased
 * (`Intl` ignores ASCII case only), so the map is bounded by the zone list. Refused spellings are not
 * stored: arbitrary input cannot grow it.
 */
const resolvedZones = new Map<string, string>();

/** `s` with ASCII letters lower-cased, nothing else: how `Intl` compares zone names. */
function asciiLowerCase(s: string): string {
  return s.replace(/[A-Z]/g, c => c.toLowerCase());
}

/** The name `Intl` resolves `timeZone` to, or `null` for an unknown name or a fixed offset. */
function resolvedZone(timeZone: string): string | null {
  const key = asciiLowerCase(timeZone);
  const cached = resolvedZones.get(key);
  if (cached) return cached;
  let name: string;
  try {
    name = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  // A fixed offset such as `'+01:00'` resolves to itself (`'−01:00'`, with U+2212, to `'-01:00'`).
  if (/^[+-]/.test(name)) return null;
  resolvedZones.set(key, name);
  return name;
}

/** The name `Intl` resolves `timeZone` to; a `RangeError` for an unknown name or a fixed offset. */
function requireZone(timeZone: string): string {
  const zone = resolvedZone(timeZone);
  if (!zone) throw new RangeError(`Not an IANA time zone: ${timeZone}`);
  return zone;
}

/**
 * `timeZone` in the letter case `Intl` gives it (`europe/rome` → `Europe/Rome`, `utc` → `UTC`), so
 * one zone is never stored under two spellings — that would split every grouping by zone and match
 * no option of a zone list. Only the case: an alias `Intl` resolves to another name
 * (`Asia/Kolkata` → `Asia/Calcutta`) is left as written, since browsers disagree on which name is
 * primary — and an alias in another case too (`asia/kolkata`): `Intl` lists canonical names only, so
 * nothing says how an alias is spelt. Compare zones with `sameTimeZone`, which reads through both.
 * A name `Intl` does not know is returned unchanged.
 */
export function canonicalTimeZone(timeZone: string): string {
  const resolved = resolvedZone(timeZone);
  return resolved && asciiLowerCase(resolved) === asciiLowerCase(timeZone) ? resolved : timeZone;
}

/**
 * `true` when `timeZone` is a zone name `Intl` knows. A fixed offset such as `'+01:00'`, which
 * `Intl` also accepts, is refused: it is not an IANA name and has no daylight-saving rules.
 */
export function isValidTimeZone(timeZone: string): boolean {
  return resolvedZone(timeZone) !== null;
}

/**
 * `true` when `a` and `b` name the same zone for `Intl` in this runtime, aliases and letter case
 * included (`Asia/Kolkata` and `asia/calcutta`); `false` when either is not a zone. Aliases match
 * because `resolvedOptions()` returns the ICU canonical name; an engine that returns the input's
 * spelling (TC39's canonicalisation proposal) keeps them apart — to revisit in DT-5f.
 */
export function sameTimeZone(a: string, b: string): boolean {
  const zone = resolvedZone(a);
  return zone !== null && zone === resolvedZone(b);
}
