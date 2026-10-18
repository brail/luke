import { describe, expect, it } from 'vitest';

import {
  UNTOUCHED_SIDES,
  applyLinkedEdit,
  rangeFromEvent,
  rangeFromStart,
  resolveSide,
  toggleAllDay,
  type DateRangeState,
} from '../linkedDateRange';

const RANGE: DateRangeState = {
  startDate: '2026-03-10',
  startTime: '09:00',
  endDate: '2026-03-10',
  endTime: '10:00',
};

describe('applyLinkedEdit', () => {
  describe('linked shift — the other side has never been edited directly', () => {
    it('moves the end by the same delta when the start date moves, preserving the duration', () => {
      const { next } = applyLinkedEdit(RANGE, 'start', { startDate: '2026-03-12' }, false, UNTOUCHED_SIDES);
      expect(next).toEqual({
        startDate: '2026-03-12',
        startTime: '09:00',
        endDate: '2026-03-12',
        endTime: '10:00',
      });
    });

    it('moves the end by the same delta when the start time moves', () => {
      const { next } = applyLinkedEdit(RANGE, 'start', { startTime: '14:30' }, false, UNTOUCHED_SIDES);
      expect(next.endTime).toBe('15:30');
      expect(next.endDate).toBe('2026-03-10');
    });

    it('shifts the start when the end is the side being edited', () => {
      const { next } = applyLinkedEdit(RANGE, 'end', { endDate: '2026-03-15' }, false, UNTOUCHED_SIDES);
      expect(next.startDate).toBe('2026-03-15');
      expect(next.startTime).toBe('09:00');
    });

    it('carries the shift across a day boundary', () => {
      const { next } = applyLinkedEdit(
        { ...RANGE, startTime: '23:00', endTime: '23:30' },
        'start',
        { startTime: '23:45' },
        false,
        UNTOUCHED_SIDES
      );
      expect(next.endDate).toBe('2026-03-11');
      expect(next.endTime).toBe('00:15');
    });
  });

  describe('independent resize — both sides have been edited', () => {
    it('leaves the other side alone once it has been touched', () => {
      const touched = { start: false, end: true };
      const { next } = applyLinkedEdit(RANGE, 'start', { startTime: '08:00' }, false, touched);
      expect(next.endTime).toBe('10:00');
      expect(next.startTime).toBe('08:00');
    });

    it('snaps the end up to the start rather than allowing an inverted range', () => {
      const touched = { start: false, end: true };
      const { next } = applyLinkedEdit(RANGE, 'start', { startTime: '11:00' }, false, touched);
      expect(next.startTime).toBe('11:00');
      expect(next.endTime).toBe('11:00');
    });

    it('snaps the start down to the end when the end is dragged before it', () => {
      const touched = { start: true, end: false };
      const afterStart = applyLinkedEdit(RANGE, 'end', { endTime: '08:00' }, false, touched);
      expect(afterStart.next.endTime).toBe('08:00');
      expect(afterStart.next.startTime).toBe('08:00');
    });
  });

  describe('edges', () => {
    it('applies the raw edit when the edited side has no date yet', () => {
      const empty: DateRangeState = { startDate: '', startTime: '09:00', endDate: '', endTime: '10:00' };
      const { next } = applyLinkedEdit(empty, 'start', { startTime: '11:00' }, false, UNTOUCHED_SIDES);
      expect(next).toEqual({ ...empty, startTime: '11:00' });
    });

    it('applies the raw edit on an open-ended event, with nothing to shift against', () => {
      const openEnded: DateRangeState = { ...RANGE, endDate: '', endTime: '' };
      const { next } = applyLinkedEdit(openEnded, 'start', { startDate: '2026-04-01' }, false, UNTOUCHED_SIDES);
      expect(next.endDate).toBe('');
      expect(next.startDate).toBe('2026-04-01');
    });

    it('compares on the bare date for an all-day event, ignoring the times', () => {
      const allDay: DateRangeState = { startDate: '2026-03-10', startTime: '', endDate: '2026-03-12', endTime: '' };
      const { next } = applyLinkedEdit(allDay, 'start', { startDate: '2026-03-11' }, true, UNTOUCHED_SIDES);
      expect(next.endDate).toBe('2026-03-13');
    });

    it('marks the edited side as touched and leaves the other flag alone', () => {
      const { touched } = applyLinkedEdit(RANGE, 'end', { endTime: '11:00' }, false, UNTOUCHED_SIDES);
      expect(touched).toEqual({ start: false, end: true });
    });

    it('does not mutate its arguments', () => {
      const before = { ...RANGE };
      const touchedBefore = { ...UNTOUCHED_SIDES };
      applyLinkedEdit(RANGE, 'start', { startDate: '2026-03-20' }, false, UNTOUCHED_SIDES);
      expect(RANGE).toEqual(before);
      expect(UNTOUCHED_SIDES).toEqual(touchedBefore);
    });
  });
});

describe('rangeFromStart', () => {
  it('lasts an hour, ending on the next day from 23:00 on', () => {
    expect(rangeFromStart('2026-03-10', '09:30')).toEqual({ startDate: '2026-03-10', startTime: '09:30', endDate: '2026-03-10', endTime: '10:30' });
    expect(rangeFromStart('2026-03-31', '23:15')).toEqual({ startDate: '2026-03-31', startTime: '23:15', endDate: '2026-04-01', endTime: '00:15' });
  });

  it('leaves the dates empty until one is chosen', () => {
    expect(rangeFromStart('', '09:00')).toEqual({ startDate: '', startTime: '09:00', endDate: '', endTime: '10:00' });
  });
});

describe('rangeFromEvent', () => {
  it('reads a timed event in the zone given, zero-padded, with an hour-long end when it has none', () => {
    expect(rangeFromEvent('2026-01-05T06:04:00.000Z', null, false, 'Europe/Rome')).toEqual({
      startDate: '2026-01-05', startTime: '07:04', endDate: '2026-01-05', endTime: '08:04',
    });
  });

  it('reads an all-day event as its own dates in any zone, seeding 09:00–10:00', () => {
    expect(rangeFromEvent('2026-03-10T00:00:00.000Z', '2026-03-12T00:00:00.000Z', true, 'America/Los_Angeles')).toEqual({
      startDate: '2026-03-10', startTime: '09:00', endDate: '2026-03-12', endTime: '10:00',
    });
  });
});

describe('resolveSide (an unchanged field sends the stored instant back)', () => {
  // Rome falls back on 25 October 2026: 02:30 happens twice, at 00:30Z and at 01:30Z.
  const secondOccurrence = '2026-10-25T01:30:00.000Z';

  it('keeps the second occurrence of a repeated hour when the fields are unchanged', () => {
    const range = rangeFromEvent(secondOccurrence, null, false, 'Europe/Rome');
    expect([range.startDate, range.startTime]).toEqual(['2026-10-25', '02:30']);
    // Rebuilt from the fields, 02:30 is its first occurrence: the event would move an hour.
    expect(resolveSide(range.startDate, range.startTime, false, 'Europe/Rome')).toBe('2026-10-25T00:30:00.000Z');
    expect(resolveSide(range.startDate, range.startTime, false, 'Europe/Rome', { at: secondOccurrence, allDay: false })).toBe(secondOccurrence);
  });

  it('keeps seconds the fields cannot show', () => {
    const stored = '2026-03-10T08:30:42.123Z';
    expect(resolveSide('2026-03-10', '09:30', false, 'Europe/Rome', { at: stored, allDay: false })).toBe(stored);
  });

  it('rebuilds the instant from fields the user changed, or when the kind of event changed', () => {
    const stored = '2026-03-10T08:30:00.000Z';
    expect(resolveSide('2026-03-10', '10:00', false, 'Europe/Rome', { at: stored, allDay: false })).toBe('2026-03-10T09:00:00.000Z');
    expect(resolveSide('2026-03-10', '09:30', true, 'Europe/Rome', { at: stored, allDay: false })).toBe('2026-03-10T00:00:00.000Z');
    expect(resolveSide('2026-03-10', '09:30', false, 'Europe/Rome')).toBe(stored);
  });
});

describe('toggleAllDay (a timed end is exclusive, an all-day end inclusive)', () => {
  const evening = { startDate: '2026-03-10', startTime: '20:00', endDate: '2026-03-11', endTime: '00:00' };

  it('ends an event that stops at midnight on the day before when all-day is set, and back again', () => {
    const asAllDay = toggleAllDay(evening, true);
    expect(asAllDay.endDate).toBe('2026-03-10');
    expect(toggleAllDay(asAllDay, false)).toEqual(evening);
  });

  it('leaves any other end alone, and never ends before the start', () => {
    const morning = { ...evening, endTime: '09:00' };
    expect(toggleAllDay(morning, true)).toEqual(morning);
    const atMidnight = { startDate: '2026-03-10', startTime: '00:00', endDate: '2026-03-10', endTime: '00:00' };
    expect(toggleAllDay(atMidnight, true).endDate).toBe('2026-03-10');
  });
});

/**
 * The time inputs are not `required`, so clearing one is an ordinary action rather than an edge
 * case. Before this guard the pair reached `toISOString`, which throws `RangeError` on an
 * unparseable instant, and the linked-shift arithmetic wrote the literal 'NaN-NaN-NaN' into the
 * other date field — a value `startDate: z.string().min(1)` accepts.
 */
describe('date/time pairs that do not describe an instant', () => {
  it('resolveSide returns null instead of throwing, with an empty time', () => {
    expect(resolveSide('2026-03-10', '', false, 'Europe/Rome')).toBeNull();
  });

  it('resolveSide returns null for a year that Date renders in extended form', () => {
    // <input type="date"> goes up to 275760: toISOString emits '+275760-…', which the endpoint's
    // z.string().datetime() rejects. Better to stop it in the field than in a toast.
    expect(resolveSide('275760-09-12', '10:00', false, 'Europe/Rome')).toBeNull();
    expect(resolveSide('0002-03-10', '10:00', false, 'Europe/Rome')).toBeNull();
  });

  it('resolveSide resolves a valid pair normally', () => {
    expect(resolveSide('2026-03-10', '09:00', false, 'Europe/Rome')).toBe('2026-03-10T08:00:00.000Z');
  });

  it('applyLinkedEdit does not write NaN into the paired date when a time is cleared', () => {
    const { next } = applyLinkedEdit(RANGE, 'start', { startTime: '' }, false, UNTOUCHED_SIDES);
    expect(next.endDate).toBe(RANGE.endDate);
    expect(next.startTime).toBe('');
    expect(JSON.stringify(next)).not.toContain('NaN');
  });

  it('applyLinkedEdit does not write NaN in an independent resize either', () => {
    const { next } = applyLinkedEdit(RANGE, 'end', { endTime: '' }, false, { start: true, end: true });
    expect(JSON.stringify(next)).not.toContain('NaN');
  });
});
