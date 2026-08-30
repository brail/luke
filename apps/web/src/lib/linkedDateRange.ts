/**
 * Pure date/time helpers and the linked start/end range rule for calendar event forms.
 *
 * Lives here rather than beside the dialog so it can be exercised by the unit tier: the linking
 * rule decides milestone dates, and it is precisely the kind of logic that breaks silently.
 */

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

/**
 * `toISOString` throws `RangeError` on an unparseable instant, and both an empty time field (the
 * time inputs are not `required`, so clearing one is an ordinary action) and a year past 275760
 * produce one. Returning null instead makes the caller decide, and makes it a type error to forget.
 *
 * A year the `<input type="date">` accepts but `Date` renders in expanded form (`+275760-09-11…`)
 * is also rejected here: it round-trips through `toISOString` fine and then fails the endpoint's
 * `z.string().datetime()`, which is the divergence this whole task exists to remove.
 */
function toIsoOrNull(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return iso.startsWith('+') || iso.startsWith('-') ? null : iso;
}

function buildIso(date: string, time: string): string | null {
  return toIsoOrNull(new Date(`${date}T${time}:00`));
}

/** Bare date parses as UTC midnight per spec — unlike `buildIso`, needed for all-day events so the
 * calendar day survives round-tripping through non-UTC-midnight-aware consumers (e.g. Google Calendar). */
function buildAllDayIso(date: string): string | null {
  return toIsoOrNull(new Date(date));
}

/**
 * Resolves a date/time pair to an ISO instant, using UTC-midnight semantics for all-day events.
 *
 * @returns The instant, or null when the pair does not describe one.
 */
export function resolveIso(date: string, time: string, allDay: boolean): string | null {
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

export type RangeSide = 'start' | 'end';

/** Which sides the user has edited directly, as opposed to having them shifted for them. */
export interface TouchedSides {
  start: boolean;
  end: boolean;
}

export const UNTOUCHED_SIDES: TouchedSides = { start: false, end: false };

const dateKey = (side: RangeSide): 'startDate' | 'endDate' => (side === 'start' ? 'startDate' : 'endDate');

function sideInstant(state: DateRangeState, side: RangeSide, allDay: boolean): number {
  return side === 'start'
    ? toInstant(state.startDate, state.startTime, allDay)
    : toInstant(state.endDate, state.endTime, allDay);
}

function withSide(state: DateRangeState, side: RangeSide, ms: number): DateRangeState {
  const { date, time } = fromInstant(ms);
  return side === 'start'
    ? { ...state, startDate: date, startTime: time }
    : { ...state, endDate: date, endTime: time };
}

/**
 * Applies one edit to the linked start/end fields of a calendar event, Google-Calendar-style.
 *
 * The first manual edit to either side shifts the other side by the same delta, preserving the
 * current duration (like dragging the whole event). Once the user directly edits the side that
 * had only ever been auto-shifted, both sides become independent from then on: further edits
 * resize freely, clamped so end can never precede start (snaps the other side instead of allowing
 * an inverted range).
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

  // An unparseable side (a cleared time field, a year `Date` cannot represent) has no instant to
  // shift or clamp against. Without this the arithmetic below yields NaN and writes the literal
  // 'NaN-NaN-NaN' into the other date field, which `min(1)` then happily accepts.
  if ([sideInstant(merged, side, allDay), sideInstant(prev, side, allDay), sideInstant(prev, other, allDay)].some(Number.isNaN)) {
    return { next: merged, touched: nextTouched };
  }

  if (!nextTouched[other]) {
    // Linked shift: the other side has never been directly edited, so move it by the same
    // delta to preserve the current duration — like dragging the whole event.
    const delta = sideInstant(merged, side, allDay) - sideInstant(prev, side, allDay);
    return { next: withSide(merged, other, sideInstant(prev, other, allDay) + delta), touched: nextTouched };
  }

  // Independent resize: both sides are touched from here on, recompute freely and just
  // clamp against an inverted range.
  const startMs = sideInstant(merged, 'start', allDay);
  const endMs = sideInstant(merged, 'end', allDay);
  if (endMs < startMs) {
    return {
      next: side === 'start' ? withSide(merged, 'end', startMs) : withSide(merged, 'start', endMs),
      touched: nextTouched,
    };
  }
  return { next: merged, touched: nextTouched };
}
