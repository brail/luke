import {
  addCalendarDays,
  calendarDateIn,
  calendarDateOf,
  calendarDaysBetween,
  type CalendarDate,
  eventCalendarDays,
  initials,
  isEventDeleteLocked as isEventDeleteLockedCore,
  utcMidnightOf,
} from '@luke/core';

import { type CalendarEventItem } from './_components/types';

/** Returns the Monday of the ISO week containing `d`, at midnight local time. */
export function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

/** Returns a new Date representing midnight (00:00:00) on the same local day as `d`. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Returns a new Date equal to `d` plus `n` calendar days. */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Returns the first day of the month `n` months after `d`. */
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Returns true when `a` and `b` fall on the same local calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Returns 'YYYY-MM-DD' for the LOCAL calendar day `d` falls on — never `d.toISOString()`, which
 * converts to UTC first and silently shifts the date by one for any positive UTC offset (e.g.
 * Europe/Rome): a local midnight becomes the previous day's evening in UTC. Use this for anything
 * meant to round-trip as "the day the user is looking at" — the
 * calendar's `?date=` URL param, the day/week-number navigation target.
 */
export function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Parses a 'YYYY-MM-DD' string as LOCAL midnight on that calendar day — never `new Date(string)`,
 * which the spec anchors to UTC midnight for a date-only ISO string: in any negative-UTC-offset
 * zone (e.g. US timezones), that instant falls on the PREVIOUS local calendar day. Returns `null`
 * for a malformed or non-existent date (e.g. '2026-02-30') rather than silently rolling it over,
 * the way `new Date(y, m, d)` would.
 */
export function parseLocalIsoDate(s: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const date = Number(match[3]);
  const parsed = new Date(year, month, date);
  const isValid = parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === date;
  return isValid ? parsed : null;
}

/** Every calendar date of a stored range (UTC midnights, both ends included), one per day. */
export function expandDateRangeToIsoDates(start: Date, end: Date): CalendarDate[] {
  const dates: CalendarDate[] = [];
  const last = calendarDateOf(end);
  for (let d = calendarDateOf(start); d <= last; d = addCalendarDays(d, 1)) dates.push(d);
  return dates;
}

/** Returns the ISO 8601 week number (1–53) of `d`. */
export function getIsoWeek(d: CalendarDate): number {
  const date = utcMidnightOf(d);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** The zone the browser renders in: view cells and timed events are read in it. */
function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The calendar date of a view cell — any instant of that local day, usually its midnight. */
export function cellDate(d: Date): CalendarDate {
  return calendarDateIn(d, browserTimeZone());
}

type EventDates = Pick<CalendarEventItem, 'startAt' | 'endAt' | 'allDay'>;

/**
 * The first and last calendar date `m` occupies in the browser zone: an all-day event its own
 * stored dates in every zone, a timed one its instants projected here, the end exclusive.
 */
export function eventDays(m: EventDates): [CalendarDate, CalendarDate] {
  return eventCalendarDays(new Date(m.startAt), m.endAt ? new Date(m.endAt) : null, m.allDay, browserTimeZone());
}

/**
 * `events` in the order the views list them: by first occupied date, then by start instant — so an
 * all-day event never sorts among the previous evening's timed events west of UTC. Each event's
 * date is read once, not once per comparison.
 */
export function sortByFirstDay<T extends EventDates>(events: T[]): T[] {
  return events
    .map(m => ({ m, day: eventDays(m)[0], at: new Date(m.startAt).getTime() }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at)
    .map(({ m }) => m);
}

/**
 * The dates a write is based on, sent with it as its precondition: the server refuses the write
 * (CONFLICT) if the event no longer holds them — a move made meanwhile by someone else.
 */
export function expectedDates(m: EventDates): { startAt: string; endAt: string | null; allDay: boolean } {
  return { startAt: new Date(m.startAt).toISOString(), endAt: m.endAt ? new Date(m.endAt).toISOString() : null, allDay: m.allDay };
}

/**
 * `m` moved by `days` calendar days, or `null` when there is nothing to send (no move, or a source
 * whose end is before its start). All-day: both dates by calendar arithmetic, so they stay at UTC
 * midnight. Timed: the start keeps its wall clock — a time the zone skips resolves forward, a
 * repeated one to its first occurrence — and the end follows at the original elapsed duration, so
 * the interval can never invert across a DST change (its end's wall clock may move by that hour).
 */
export function moveEvent(m: EventDates, days: number): { startAt: string; endAt: string | null } | null {
  const start = new Date(m.startAt);
  const end = m.endAt ? new Date(m.endAt) : null;
  if (days === 0 || (end && end < start)) return null;
  if (m.allDay) {
    const shift = (d: Date) => utcMidnightOf(addCalendarDays(calendarDateOf(d), days)).toISOString();
    return { startAt: shift(start), endAt: end ? shift(end) : null };
  }
  const newStart = addDays(start, days);
  return {
    startAt: newStart.toISOString(),
    endAt: end ? new Date(newStart.getTime() + end.getTime() - start.getTime()).toISOString() : null,
  };
}

/** `m` moved so that its first occupied date is `date` (a drop on a cell, a wizard draft). */
export function moveEventTo(m: EventDates, date: CalendarDate): { startAt: string; endAt: string | null } | null {
  return moveEvent(m, calendarDaysBetween(eventDays(m)[0], date));
}

/**
 * `m` dropped on a month/week cell, whose droppable id is the ISO string of that cell's local
 * midnight (`day.toISOString()`): the drop lands its first date on the cell's local date.
 */
export function moveToCell(m: EventDates, droppableId: string): { startAt: string; endAt: string | null } | null {
  return moveEventTo(m, cellDate(new Date(droppableId)));
}

/**
 * The new end of `m` after a Gantt resize by `days`, or `null` when nothing changes or the result
 * is not valid; the start is never part of it. All-day: the last date moves, never before the
 * first. Timed: the end (the start when there is none) moves by `days` local days, the same wall
 * clock semantics as `moveEvent`, and is refused unless it stays after the start.
 */
export function resizeEvent(m: EventDates, days: number): { endAt: string } | null {
  if (days === 0) return null;
  if (m.allDay) {
    const [first, last] = eventDays(m);
    const moved = addCalendarDays(last, days);
    const newLast = moved < first ? first : moved;
    return newLast === last ? null : { endAt: utcMidnightOf(newLast).toISOString() };
  }
  const start = new Date(m.startAt);
  const newEnd = addDays(m.endAt ? new Date(m.endAt) : start, days);
  return newEnd > start ? { endAt: newEnd.toISOString() } : null;
}

/**
 * The wall-clock hours of a timed event within the local day `day`, clipped to it: `[0, 24]` when
 * it runs through the whole day (24 is the next midnight). An event with no end lasts an hour.
 */
export function hoursWithinDay(m: Pick<CalendarEventItem, 'startAt' | 'endAt'>, day: Date): [number, number] {
  // Each bound is its own day's start: where a zone skips midnight that start is 01:00.
  const dayStart = startOfDay(day);
  const nextDay = startOfDay(addDays(day, 1));
  const start = new Date(m.startAt);
  const end = m.endAt ? new Date(m.endAt) : new Date(start.getTime() + 3_600_000);
  const hours = (d: Date) => d.getHours() + d.getMinutes() / 60;
  return [start < dayStart ? 0 : hours(start), end >= nextDay ? 24 : hours(end)];
}

const PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0891b2', // cyan
  '#ea580c', // orange
  '#9333ea', // purple
  '#0d9488', // teal
  '#65a30d', // lime
  '#be123c', // rose
];

/**
 * Groups calendar events by day, returning one array per view cell in `days`: an event appears in
 * every cell whose date it occupies (`eventDays`).
 */
export function groupEventsByDay<T extends EventDates>(events: T[], days: Date[]): T[][] {
  const spans = events.map(eventDays);
  return days.map(cellDate).map(day => events.filter((_, i) => spans[i]![0] <= day && day <= spans[i]![1]));
}

/**
 * Thin adapter over the shared `@luke/core` predicate — only reshapes the client's flattened
 * `planningGroupFrozenAt` field into `frozenAt`, so this client-side UX mirror can't drift from the
 * server's enforcement. The *date* lock has no client mirror: it depends on the business time zone,
 * so the server evaluates it and sends `dateLocked` with each event.
 */
export function isEventDeleteLocked(m: Pick<CalendarEventItem, 'phaseId' | 'planningGroupFrozenAt'>): boolean {
  return isEventDeleteLockedCore({ phaseId: m.phaseId, frozenAt: m.planningGroupFrozenAt });
}

/**
 * Returns true when the current user may drag or edit a milestone.
 *
 * A milestone is editable when the user has `canUpdate`, the milestone either has no brandId or
 * belongs to the currently active brand, it is not cancelled (cancelled events are read-only until
 * an admin restores them), and it is not a date-locked frozen-past phase event (those move only via
 * the motivated reschedule flow, never via drag).
 *
 * @param canUpdate - `can('season_calendar:update')` result from `usePermission`.
 * @param activeBrandId - Currently selected brand from AppContext.
 */
export function canEditMilestone(
  m: { brandId?: string | null; cancelledAt?: Date | string | null; dateLocked?: boolean },
  canUpdate: boolean | undefined,
  activeBrandId: string | undefined,
): boolean {
  if (!canUpdate || (m.brandId && m.brandId !== activeBrandId) || m.cancelledAt) return false;
  return !m.dateLocked;
}

/** Joins a milestone's visible functions into a comma-separated display string. */
export function formatVisibleFunctions(
  visibilities: { functionId: string }[],
  functionsById: Record<string, string>,
): string {
  return visibilities.map(v => functionsById[v.functionId] ?? v.functionId).join(', ');
}

/**
 * Derives a deterministic colour from a brand ID by hashing into the palette.
 * Use `assignBrandColors` when rendering a fixed set of brands for stable colours.
 */
export function brandColor(brandId: string): string {
  let hash = 0;
  for (let i = 0; i < brandId.length; i++) {
    hash = (hash * 31 + brandId.charCodeAt(i)) & 0xffffffff;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

/**
 * Assigns a stable colour from the palette to each brand by list index.
 * Preferred over `brandColor` when the full brand list is known upfront.
 */
export function assignBrandColors(brands: { id: string }[]): Record<string, string> {
  return Object.fromEntries(brands.map((b, i) => [b.id, PALETTE[i % PALETTE.length]!]));
}

/**
 * Resolves a brand's colour from `map`, falling back to `brandColor()` for
 * unknown IDs or to the CSS primary variable when `brandId` is nullish.
 */
export function resolveBrandColor(brandId: string | null | undefined, map: Record<string, string>): string {
  if (!brandId) return 'hsl(var(--primary))';
  return map[brandId] ?? brandColor(brandId);
}

/**
 * Fixed-width group-initials badge text for an event chip, or `undefined` when badges are
 * hidden (`show` false) or the milestone has no known group name. Keeps the badge out of the
 * title's `truncate` budget regardless of how long the group name is — the full name belongs in
 * the chip's tooltip instead (see `groupTooltip`).
 */
export function groupBadge(show: boolean | undefined, name: string | undefined): string | undefined {
  return show && name ? initials(name) : undefined;
}

/** Tooltip text prefixing the group name onto an event title, when the group name is known. */
export function groupTooltip(name: string | undefined, title: string, suffix = ''): string {
  return `${name ? `Gruppo: ${name} — ` : ''}${title}${suffix}`;
}
