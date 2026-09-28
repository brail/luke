import {
  addCalendarDays,
  calendarDateIn,
  calendarDateOf,
  startOfDayIn,
  type CalendarDate,
} from './dateUtils.js';

/**
 * Deadline and post-freeze immutability rules for calendar events — the single source for the
 * lock, the auto-revision trigger, the milestone notifications and the alert bands. Every function
 * that decides a day takes the business time zone (`app.defaultTimezone`): the process's zone never
 * does.
 */
export interface DeadlineEvent {
  startAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
}

export interface LockableCalendarEvent extends DeadlineEvent {
  phaseId?: string | null;
  frozenAt?: Date | string | null;
}

/**
 * The stored deadline: `endAt` when the event spans a window, else `startAt`. A phase must be
 * completed by the *end* of its milestone window, so a multi-day event is measured against its close.
 */
function storedDeadline(event: DeadlineEvent): Date {
  return new Date(event.endAt ?? event.startAt);
}

/**
 * The day a deadline falls on — what countdowns count to. An all-day value is its own calendar date
 * (zone-free); a timed one is the date of its instant in the business zone.
 */
export function deadlineDay(event: DeadlineEvent, timeZone: string): CalendarDate {
  const deadline = storedDeadline(event);
  return event.allDay ? calendarDateOf(deadline) : calendarDateIn(deadline, timeZone);
}

/**
 * The instant a deadline is reached. An all-day deadline D is reached when D ends in the business
 * zone — the start of D + 1 there — so a milestone due Friday is due all Friday; a timed one at its
 * own instant.
 */
export function deadlineReachedAt(event: DeadlineEvent, timeZone: string): Date {
  const deadline = storedDeadline(event);
  return event.allDay ? startOfDayIn(addCalendarDays(calendarDateOf(deadline), 1), timeZone) : deadline;
}

/**
 * How long after its stored value a deadline can be reached: an all-day one ends up to 36 h after
 * its UTC midnight (the end of its day at UTC−12), rounded up. A query on stored `endAt ?? startAt`
 * widens its lower bound by this much, then filters on `deadlineReachedAt` for the exact window.
 */
export const DEADLINE_REACH_MARGIN_MS = 48 * 60 * 60 * 1000;

/**
 * A phase-tagged event in a frozen planning group whose deadline has been reached is locked:
 * startAt/endAt, allDay, title and phaseId must not be freely edited — moving the date would
 * launder a real delay out of the alert engine, and renaming/reassigning the phase would rewrite
 * what the frozen baseline committed to. Future frozen events stay freely editable — nothing has
 * gone wrong yet — and non-phase events never lock. "Reached" alone is `deadlineReachedAt`: this
 * adds phase ∧ frozen, so it is never a synonym for it.
 */
export function isEventDateLocked(event: LockableCalendarEvent, timeZone: string, now: Date = new Date()): boolean {
  if (!event.phaseId || !event.frozenAt) return false;
  return now >= deadlineReachedAt(event, timeZone);
}

/**
 * A phase-tagged event in a frozen planning group must not be hard-deleted (it would destroy its
 * frozen baseline and scheduling-variance history) — it can only be cancelled. Unlike the date lock
 * this applies whether the event is past or future: the frozen commitment exists either way.
 */
export function isEventDeleteLocked(event: { phaseId?: string | null; frozenAt?: Date | string | null }): boolean {
  return !!event.phaseId && !!event.frozenAt;
}
