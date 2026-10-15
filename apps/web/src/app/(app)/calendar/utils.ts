import {
  addCalendarDays,
  calendarDateIn,
  calendarDateOf,
  calendarDaysBetween,
  type CalendarDate,
  eventCalendarDays,
  eventDeleteBlock as eventDeleteBlockCore,
  type EventDeleteBlock,
  initials,
  parseCalendarDate,
  shiftEventByDays,
  startOfDayIn,
  utcMidnightOf,
  wallTimeIn,
} from '@luke/core';

import { type CalendarEventItem } from './_components/types';

/** The first day of the month `months` after the month of `date`. Throws a `RangeError` outside 1900–9999. */
export function monthStart(date: CalendarDate, months = 0): CalendarDate {
  const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months;
  const first = parseCalendarDate(`${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`);
  if (!first) throw new RangeError(`Month out of range: ${date} ${months >= 0 ? '+' : ''}${months}`);
  return first;
}

/** Minutes since midnight on the wall clock of `zone` at `instant` (e.g. 570 for 09:30). */
export function wallMinutes(instant: Date, zone: string): number {
  const time = wallTimeIn(instant, zone);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/** Every calendar date of a stored range (UTC midnights, both ends included), one per day. */
export function expandDateRangeToIsoDates(start: Date, end: Date): CalendarDate[] {
  const dates: CalendarDate[] = [];
  const last = calendarDateOf(end);
  for (let d = calendarDateOf(start); d <= last; d = addCalendarDays(d, 1)) dates.push(d);
  return dates;
}

type EventDates = Pick<CalendarEventItem, 'startAt' | 'endAt' | 'allDay'>;

/**
 * The first and last calendar date `m` occupies in `zone`: an all-day event its own stored dates in
 * every zone, a timed one its instants projected there, the end exclusive.
 */
export function eventDays(m: EventDates, zone: string): [CalendarDate, CalendarDate] {
  return eventCalendarDays(new Date(m.startAt), m.endAt ? new Date(m.endAt) : null, m.allDay, zone);
}

/**
 * `events` in the order the views list them: by first occupied date in `zone`, then by start
 * instant — so an all-day event never sorts among the previous evening's timed events west of UTC.
 * Each event's date is read once, not once per comparison.
 */
export function sortByFirstDay<T extends EventDates>(events: T[], zone: string): T[] {
  return events
    .map(m => ({ m, day: eventDays(m, zone)[0], at: new Date(m.startAt).getTime() }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at)
    .map(({ m }) => m);
}

/**
 * Whether a refused write means the calendar list is out of date, so it must be reloaded: a lock
 * the list did not show yet (the deadline was reached while the page was open) or a move someone
 * else made meanwhile. The one rule every caller that moves an event applies.
 */
export function isStaleListError(err: { data?: { code?: string } | null }): boolean {
  return err.data?.code === 'PRECONDITION_FAILED' || err.data?.code === 'CONFLICT';
}

/**
 * The dates a write is based on, sent with it as its precondition: the server refuses the write
 * (CONFLICT) if the event no longer holds them — a move made meanwhile by someone else.
 */
export function expectedDates(m: EventDates): { startAt: string; endAt: string | null; allDay: boolean } {
  return { startAt: new Date(m.startAt).toISOString(), endAt: m.endAt ? new Date(m.endAt).toISOString() : null, allDay: m.allDay };
}

/**
 * `m` moved by `days` calendar days of `zone` by the one shift contract (`shiftEventByDays`,
 * ADR-036), or `null` when there is nothing to send (no move, or a source whose end is before its
 * start). All-day: both dates by calendar arithmetic. Timed: a template item stays on day starts,
 * any other event keeps the wall time of its ends; the interval never inverts.
 */
export function moveEvent(m: EventDates, days: number, zone: string): { startAt: string; endAt: string | null } | null {
  const start = new Date(m.startAt);
  const end = m.endAt ? new Date(m.endAt) : null;
  if (days === 0 || (end && end < start)) return null;
  const moved = shiftEventByDays({ startAt: start, endAt: end, allDay: m.allDay }, days, zone);
  return { startAt: moved.startAt.toISOString(), endAt: moved.endAt ? moved.endAt.toISOString() : null };
}

/** `m` moved so that its first occupied date in `zone` is `date` (a drop on a cell, a wizard draft). */
export function moveEventTo(m: EventDates, date: CalendarDate, zone: string): { startAt: string; endAt: string | null } | null {
  return moveEvent(m, calendarDaysBetween(eventDays(m, zone)[0], date), zone);
}

/** `m` dropped on a month/week cell, whose droppable id is that cell's date: its first date in `zone` lands there. */
export function moveToCell(m: EventDates, droppableId: string, zone: string): { startAt: string; endAt: string | null } | null {
  const date = parseCalendarDate(droppableId);
  return date && moveEventTo(m, date, zone);
}

/**
 * The new end of `m` after a Gantt resize by `days`, or `null` when nothing changes or the result
 * is not valid; the start is never part of it. All-day: the last date moves, never before the
 * first. Timed: the end (the start when there is none) moves by `days` days of `zone` — a day start
 * to the start of the day `days` later, as `moveEvent` moves a template item, any other end keeping
 * its wall time — and is refused unless it stays after the start.
 */
export function resizeEvent(m: EventDates, days: number, zone: string): { endAt: string } | null {
  if (days === 0) return null;
  if (m.allDay) {
    const [first, last] = eventDays(m, zone);
    const moved = addCalendarDays(last, days);
    const newLast = moved < first ? first : moved;
    return newLast === last ? null : { endAt: utcMidnightOf(newLast).toISOString() };
  }
  const start = new Date(m.startAt);
  const end = m.endAt ? new Date(m.endAt) : start;
  // A day start stays one, as `shiftEventByDays` keeps a template item's: not always 00:00 (a zone
  // that skips midnight starts that day at 01:00), so keeping the wall time could add or drop a day.
  const endDay = calendarDateIn(end, zone);
  const newEnd = startOfDayIn(endDay, zone).getTime() === end.getTime()
    ? startOfDayIn(addCalendarDays(endDay, days), zone)
    : shiftEventByDays({ startAt: end, endAt: null, allDay: false }, days, zone).startAt;
  return newEnd > start ? { endAt: newEnd.toISOString() } : null;
}

/**
 * The wall-clock hours of a timed event within `day` in `zone`, clipped to it: `[0, 24]` when it
 * runs through the whole day (24 is the next day's start). An event with no end lasts an hour.
 */
export function hoursWithinDay(m: Pick<CalendarEventItem, 'startAt' | 'endAt'>, day: CalendarDate, zone: string): [number, number] {
  // Each bound is its own day's start: where a zone skips midnight that start is 01:00.
  const dayStart = startOfDayIn(day, zone);
  const nextDay = startOfDayIn(addCalendarDays(day, 1), zone);
  const start = new Date(m.startAt);
  const end = m.endAt ? new Date(m.endAt) : new Date(start.getTime() + 3_600_000);
  return [start < dayStart ? 0 : wallMinutes(start, zone) / 60, end >= nextDay ? 24 : wallMinutes(end, zone) / 60];
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
 * every cell whose date it occupies in `zone` (`eventDays`).
 */
export function groupEventsByDay<T extends EventDates>(events: T[], days: CalendarDate[], zone: string): T[][] {
  const spans = events.map(m => eventDays(m, zone));
  return days.map(day => events.filter((_, i) => spans[i]![0] <= day && day <= spans[i]![1]));
}

/**
 * Why `m` cannot be deleted, or `null` when it can: the shared `@luke/core` rule, with the client's
 * flattened `planningGroupFrozenAt` reshaped into `frozenAt`, so this UX mirror can't drift from the
 * server's enforcement. The *date* lock has no client mirror: it depends on the business time zone,
 * so the server evaluates it and sends `dateLocked` with each event.
 */
export function eventDeleteBlock(m: Pick<CalendarEventItem, 'cancelledAt' | 'phaseId' | 'planningGroupFrozenAt'>): EventDeleteBlock | null {
  return eventDeleteBlockCore({ cancelledAt: m.cancelledAt, phaseId: m.phaseId, frozenAt: m.planningGroupFrozenAt });
}

/** Why an event cannot be deleted, as the calendar UI says it (`eventDeleteBlock`). */
export const DELETE_BLOCK_REASON: Record<EventDeleteBlock, string> = {
  cancelled: 'Evento annullato: non si elimina finché resta annullato',
  frozen: 'Evento di fase congelato: non può essere eliminato, solo annullato («Annulla evento»)',
};

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
