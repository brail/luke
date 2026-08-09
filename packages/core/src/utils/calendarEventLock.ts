/**
 * Post-freeze immutability predicates for calendar events (project_calendar_event_maintainability).
 * Single source of truth for both apps/api (server-side enforcement) and apps/web (client-side UX
 * mirror) — each side adapts its own event shape (nested `planningGroup.frozenAt` on the server,
 * flattened `planningGroupFrozenAt` on the client) into `frozenAt` before calling these.
 */
export interface LockableCalendarEvent {
  phaseId?: string | null;
  frozenAt?: Date | string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
}

/**
 * The instant a phase deadline falls due: the event's `endAt` when it spans a real window, else its
 * `startAt`. A phase must be completed by the *end* of its milestone window, so a multi-day event
 * (e.g. an approval window) is measured against its close, not its opening. Shared by the alert
 * engine's live countdown and the post-freeze "already passed" lock test below.
 */
export function eventDeadline(event: { startAt: Date | string; endAt?: Date | string | null }): Date {
  return new Date(event.endAt ?? event.startAt);
}

/**
 * A phase-tagged event in a frozen planning group whose deadline has already passed is locked:
 * startAt/endAt, title and phaseId must not be freely edited — moving the date would launder a real
 * delay out of the alert engine, and renaming/reassigning the phase would rewrite what the frozen
 * baseline committed to. Future frozen events stay freely editable — nothing has gone wrong yet — and
 * non-phase events never lock.
 */
export function isEventDateLocked(event: LockableCalendarEvent, now: Date = new Date()): boolean {
  if (!event.phaseId || !event.frozenAt) return false;
  return eventDeadline(event) < now;
}

/**
 * A phase-tagged event in a frozen planning group must not be hard-deleted (it would destroy its
 * frozen baseline and scheduling-variance history) — it can only be cancelled. Unlike the date lock
 * this applies whether the event is past or future: the frozen commitment exists either way.
 */
export function isEventDeleteLocked(event: { phaseId?: string | null; frozenAt?: Date | string | null }): boolean {
  return !!event.phaseId && !!event.frozenAt;
}
