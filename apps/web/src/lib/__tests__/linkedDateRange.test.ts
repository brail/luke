import { describe, expect, it } from 'vitest';

import {
  UNTOUCHED_SIDES,
  addOneHour,
  applyLinkedEdit,
  toDateInput,
  toTimeInput,
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

describe('addOneHour', () => {
  it('advances the hour', () => {
    expect(addOneHour('09:30')).toBe('10:30');
  });

  it('wraps past midnight', () => {
    expect(addOneHour('23:15')).toBe('00:15');
  });
});

describe('toDateInput / toTimeInput', () => {
  it('returns an empty date for a missing value, and the 09:00 default for a missing time', () => {
    expect(toDateInput(null)).toBe('');
    expect(toTimeInput(null)).toBe('09:00');
  });

  it('zero-pads month, day, hour and minute', () => {
    const d = new Date(2026, 0, 5, 7, 4);
    expect(toDateInput(d)).toBe('2026-01-05');
    expect(toTimeInput(d)).toBe('07:04');
  });
});
