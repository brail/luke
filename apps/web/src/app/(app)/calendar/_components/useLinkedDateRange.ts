import { useRef, useState } from 'react';

export function toDateInput(val: Date | string | null | undefined): string {
  if (!val) return '';
  const d = new Date(val);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

export function toTimeInput(val: Date | string | null | undefined): string {
  if (!val) return '09:00';
  const d = new Date(val);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function buildIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/** Bare date parses as UTC midnight per spec — unlike `buildIso`, needed for all-day events so the
 * calendar day survives round-tripping through non-UTC-midnight-aware consumers (e.g. Google Calendar). */
function buildAllDayIso(date: string): string {
  return new Date(date).toISOString();
}

/** Resolves a date/time pair to an ISO instant, using UTC-midnight semantics for all-day events. */
export function resolveIso(date: string, time: string, allDay: boolean): string {
  return allDay ? buildAllDayIso(date) : buildIso(date, time);
}

export function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${((h + 1) % 24).toString().padStart(2, '0')}:${(m ?? 0).toString().padStart(2, '0')}`;
}

function toInstant(date: string, time: string, allDay: boolean): number {
  return allDay ? new Date(date).getTime() : new Date(`${date}T${time}:00`).getTime();
}

function fromInstant(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  return { date: toDateInput(d), time: toTimeInput(d) };
}

export interface DateRangeState {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

type Side = 'start' | 'end';

const dateKey = (side: Side): 'startDate' | 'endDate' => (side === 'start' ? 'startDate' : 'endDate');

function sideInstant(state: DateRangeState, side: Side, allDay: boolean): number {
  return side === 'start'
    ? toInstant(state.startDate, state.startTime, allDay)
    : toInstant(state.endDate, state.endTime, allDay);
}

function withSide(state: DateRangeState, side: Side, ms: number): DateRangeState {
  const { date, time } = fromInstant(ms);
  return side === 'start'
    ? { ...state, startDate: date, startTime: time }
    : { ...state, endDate: date, endTime: time };
}

/**
 * Manages the linked start/end date+time fields of a calendar event form, Google-Calendar-style.
 *
 * The first manual edit to either side shifts the other side by the same delta, preserving the
 * current duration (like dragging the whole event). Once the user directly edits the side that
 * had only ever been auto-shifted, both sides become independent from then on: further edits
 * resize freely, clamped so end can never precede start (snaps the other side instead of allowing
 * an inverted range).
 */
export function useLinkedDateRange() {
  const [state, setState] = useState<DateRangeState>({ startDate: '', startTime: '', endDate: '', endTime: '' });
  const touchedRef = useRef({ start: false, end: false });

  const reset = (next: DateRangeState) => {
    touchedRef.current = { start: false, end: false };
    setState(next);
  };

  const applyEdit = (side: Side, patch: Partial<DateRangeState>, allDay: boolean) => {
    setState(prev => {
      const merged = { ...prev, ...patch };
      const other: Side = side === 'start' ? 'end' : 'start';
      touchedRef.current[side] = true;

      // No-end-date (open-ended) event, or the other side was never given a value: nothing to
      // shift/clamp against, apply the raw edit.
      if (merged[dateKey(side)] === '' || prev[dateKey(other)] === '') {
        return merged;
      }

      if (!touchedRef.current[other]) {
        // Linked shift: the other side has never been directly edited, so move it by the same
        // delta to preserve the current duration — like dragging the whole event.
        const delta = sideInstant(merged, side, allDay) - sideInstant(prev, side, allDay);
        return withSide(merged, other, sideInstant(prev, other, allDay) + delta);
      }

      // Independent resize: both sides are touched from here on, recompute freely and just
      // clamp against an inverted range.
      const startMs = sideInstant(merged, 'start', allDay);
      const endMs = sideInstant(merged, 'end', allDay);
      if (endMs < startMs) {
        return side === 'start' ? withSide(merged, 'end', startMs) : withSide(merged, 'start', endMs);
      }
      return merged;
    });
  };

  return {
    ...state,
    reset,
    onStartDateChange: (value: string, allDay: boolean) => applyEdit('start', { startDate: value }, allDay),
    onStartTimeChange: (value: string, allDay: boolean) => applyEdit('start', { startTime: value }, allDay),
    onEndDateChange: (value: string, allDay: boolean) => applyEdit('end', { endDate: value }, allDay),
    onEndTimeChange: (value: string, allDay: boolean) => applyEdit('end', { endTime: value }, allDay),
  };
}
