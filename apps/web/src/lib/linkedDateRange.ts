/**
 * Pure date/time helpers and the linked start/end range rule for calendar event forms.
 *
 * The fields hold a calendar date and a wall time. The zone that turns them into an instant is the
 * one the form captured when it opened (ADR-035): `rangeFromEvent` reads a stored event into the
 * fields, `resolveSide` turns them back into an instant. The linking rule works on the fields
 * alone, as wall clocks, so a linked shift keeps the other side's wall time.
 *
 * Lives here rather than beside the dialog so it can be exercised by the unit tier: the linking
 * rule decides milestone dates, and it is precisely the kind of logic that breaks silently.
 */

import { addCalendarDays, instantAt, parseCalendarDate, utcMidnightOf, WALL_TIME_PATTERN, wallClockDate } from '@luke/core';

type Stored = Date | string;

/**
 * The fields for a wall clock written as if it were UTC (`ms`). Not core's calendar-date helpers,
 * which throw outside 1900–9999: a date input passes through years like 0002 while one is typed,
 * and the linking rule reads every such value back.
 */
function fieldsOfWall(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return {
    date: `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** The fields of a stored value: an all-day value is a calendar date at UTC midnight, the same date in every zone; a timed one reads in `zone`. */
function storedFields(value: Stored, allDay: boolean, zone: string): { date: string; time: string } {
  const at = new Date(value);
  return fieldsOfWall(allDay ? at.getTime() : wallClockDate(at, zone).getTime());
}

/**
 * The instant a date and a wall time name in `zone`, or for an all-day value its calendar date at
 * UTC midnight; `null` when the fields name none — a cleared time field, a date outside 1900–9999.
 */
function resolveIso(date: string, time: string, allDay: boolean, zone: string): string | null {
  const day = parseCalendarDate(date);
  if (!day) return null;
  if (allDay) return utcMidnightOf(day).toISOString();
  return WALL_TIME_PATTERN.test(time) ? instantAt(day, time, zone).toISOString() : null;
}

/**
 * `resolveIso`, except that fields still reading as the stored value of the same kind send that
 * value back as it was: a form rebuilds an instant only from fields the user changed, so an event
 * in the second occurrence of a repeated hour, or stored with seconds, does not move (ADR-035).
 */
export function resolveSide(
  date: string,
  time: string,
  allDay: boolean,
  zone: string,
  stored?: { at: Stored | null | undefined; allDay: boolean },
): string | null {
  if (stored?.at && stored.allDay === allDay) {
    const fields = storedFields(stored.at, allDay, zone);
    if (fields.date === date && (allDay || fields.time === time)) return new Date(stored.at).toISOString();
  }
  return resolveIso(date, time, allDay, zone);
}

export interface DateRangeState {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/**
 * The form fields for a stored event, read in `zone` so that submitting them unchanged gives back
 * the same instants. With no end, a timed event gets the instant an hour after its start — never
 * the same date with the hour wrapped past midnight, which would end it before it starts — and an
 * all-day one its own start date. An all-day event has no time of its own: it seeds 09:00–10:00.
 */
export function rangeFromEvent(startAt: Stored, endAt: Stored | null | undefined, allDay: boolean, zone: string): DateRangeState {
  const start = storedFields(startAt, allDay, zone);
  if (allDay) return { startDate: start.date, startTime: '09:00', endDate: endAt ? storedFields(endAt, true, zone).date : start.date, endTime: '10:00' };
  const end = storedFields(endAt ?? new Date(new Date(startAt).getTime() + 3_600_000), false, zone);
  return { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time };
}

/**
 * The fields for a new event starting on `date` (empty: not chosen yet) at `time`: it lasts an hour
 * on the wall clock, ending on the next day from 23:00 on — never earlier on the same date.
 */
export function rangeFromStart(date: string, time: string): DateRangeState {
  // Without a date the end takes the time alone; any date carries the hour's arithmetic.
  const end = fieldsOfWall(Date.parse(`${date || '2000-01-01'}T${time}:00Z`) + 3_600_000);
  return { startDate: date, startTime: time, endDate: date && end.date, endTime: end.time };
}

/**
 * The fields once the all-day flag is set to `allDay`. A timed end is exclusive and an all-day end
 * inclusive: a timed event ending at 00:00 ends with the day before, so that end date moves back a
 * day when all-day is set (never before the start) and forward again when it is cleared.
 */
export function toggleAllDay(state: DateRangeState, allDay: boolean): DateRangeState {
  const end = parseCalendarDate(state.endDate);
  if (!end || state.endTime !== '00:00') return state;
  const moved = addCalendarDays(end, allDay ? -1 : 1);
  return { ...state, endDate: allDay && moved < state.startDate ? state.startDate : moved };
}

export type RangeSide = 'start' | 'end';

/** Which sides the user has edited directly, as opposed to having them shifted for them. */
export interface TouchedSides {
  start: boolean;
  end: boolean;
}

export const UNTOUCHED_SIDES: TouchedSides = { start: false, end: false };

const dateKey = (side: RangeSide): 'startDate' | 'endDate' => (side === 'start' ? 'startDate' : 'endDate');

/** A side's wall clock written as if it were UTC, or NaN when its fields name none; an all-day side counts its date only. */
function sideWall(state: DateRangeState, side: RangeSide, allDay: boolean): number {
  const [date, time] = side === 'start' ? [state.startDate, state.startTime] : [state.endDate, state.endTime];
  return Date.parse(allDay ? `${date}T00:00:00Z` : `${date}T${time}:00Z`);
}

/** `state` with one side set to the wall clock `ms`; an all-day side takes the date and keeps its time field. */
function withSide(state: DateRangeState, side: RangeSide, ms: number, allDay: boolean): DateRangeState {
  const { date, time } = fieldsOfWall(ms);
  return side === 'start'
    ? { ...state, startDate: date, startTime: allDay ? state.startTime : time }
    : { ...state, endDate: date, endTime: allDay ? state.endTime : time };
}

/**
 * Applies one edit to the linked start/end fields of a calendar event, Google-Calendar-style.
 *
 * The first manual edit to either side shifts the other side by the same delta, preserving the
 * current duration on the wall clock (like dragging the whole event). Once the user directly edits
 * the side that had only ever been auto-shifted, both sides become independent from then on:
 * further edits resize freely, clamped so end can never precede start (snaps the other side instead
 * of allowing an inverted range).
 *
 * @param prev - The range before this edit.
 * @param side - Which side the user edited.
 * @param patch - The edited field(s).
 * @param allDay - All-day events compare on the bare date, ignoring the time fields.
 * @param touched - Which sides had already been edited directly.
 * @returns The new range and the updated touched flags; neither argument is mutated.
 */
export function applyLinkedEdit(
  prev: DateRangeState,
  side: RangeSide,
  patch: Partial<DateRangeState>,
  allDay: boolean,
  touched: TouchedSides
): { next: DateRangeState; touched: TouchedSides } {
  const merged = { ...prev, ...patch };
  const other: RangeSide = side === 'start' ? 'end' : 'start';
  const nextTouched: TouchedSides = { ...touched, [side]: true };

  // No-end-date (open-ended) event, or the other side was never given a value: nothing to
  // shift/clamp against, apply the raw edit.
  if (merged[dateKey(side)] === '' || prev[dateKey(other)] === '') {
    return { next: merged, touched: nextTouched };
  }

  // An unparseable side (a cleared time field, a year `Date` cannot represent) has no wall clock
  // to shift or clamp against. Without this the arithmetic below yields NaN and writes the literal
  // 'NaN-NaN-NaN' into the other date field, which `min(1)` then happily accepts.
  if ([sideWall(merged, side, allDay), sideWall(prev, side, allDay), sideWall(prev, other, allDay)].some(Number.isNaN)) {
    return { next: merged, touched: nextTouched };
  }

  if (!nextTouched[other]) {
    // Linked shift: the other side has never been directly edited, so move it by the same
    // delta to preserve the current duration — like dragging the whole event.
    const delta = sideWall(merged, side, allDay) - sideWall(prev, side, allDay);
    return { next: withSide(merged, other, sideWall(prev, other, allDay) + delta, allDay), touched: nextTouched };
  }

  // Independent resize: both sides are touched from here on, recompute freely and just
  // clamp against an inverted range.
  const startMs = sideWall(merged, 'start', allDay);
  const endMs = sideWall(merged, 'end', allDay);
  if (endMs < startMs) {
    return {
      next: side === 'start' ? withSide(merged, 'end', startMs, allDay) : withSide(merged, 'start', endMs, allDay),
      touched: nextTouched,
    };
  }
  return { next: merged, touched: nextTouched };
}
