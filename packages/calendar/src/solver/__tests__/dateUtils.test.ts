import { describe, it, expect } from 'vitest';

import { addDays, daysBetween, isWorkingDay, workingDaysBetween } from '@luke/core';

describe('daysBetween', () => {
  it('returns 0 for same day', () => {
    expect(daysBetween(new Date('2025-01-01'), new Date('2025-01-01'))).toBe(0);
  });

  it('returns positive when b > a', () => {
    expect(daysBetween(new Date('2025-01-01'), new Date('2025-01-08'))).toBe(7);
  });

  it('returns negative when b < a', () => {
    expect(daysBetween(new Date('2025-01-08'), new Date('2025-01-01'))).toBe(-7);
  });

  it('handles month boundaries', () => {
    expect(daysBetween(new Date('2025-01-31'), new Date('2025-02-01'))).toBe(1);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    const result = addDays(new Date('2025-01-01'), 7);
    expect(daysBetween(new Date('2025-01-01'), result)).toBe(7);
  });

  it('subtracts with negative days', () => {
    const result = addDays(new Date('2025-01-10'), -3);
    expect(daysBetween(result, new Date('2025-01-10'))).toBe(3);
  });

  it('does not mutate input', () => {
    const d = new Date('2025-01-01');
    addDays(d, 5);
    expect(d.getDate()).toBe(1);
  });
});

describe('isWorkingDay', () => {
  const holidays = [
    { countryCode: 'IT', startDate: new Date('2025-04-25'), endDate: new Date('2025-04-25') },
  ];

  it('Saturday is not a working day', () => {
    // 2025-01-04 is Saturday
    expect(isWorkingDay(new Date('2025-01-04'), [], [])).toBe(false);
  });

  it('Sunday is not a working day', () => {
    // 2025-01-05 is Sunday
    expect(isWorkingDay(new Date('2025-01-05'), [], [])).toBe(false);
  });

  it('Monday is a working day (no holidays)', () => {
    // 2025-01-06 is Monday
    expect(isWorkingDay(new Date('2025-01-06'), [], [])).toBe(true);
  });

  it('holiday for relevant country is not working day', () => {
    expect(isWorkingDay(new Date('2025-04-25'), ['IT'], holidays)).toBe(false);
  });

  it('holiday not relevant for other country', () => {
    expect(isWorkingDay(new Date('2025-04-25'), ['DE'], holidays)).toBe(true);
  });

  it('no countries = all holidays apply', () => {
    // when countryCodes=[], the guard does not skip any holiday → holiday still blocks
    expect(isWorkingDay(new Date('2025-04-25'), [], holidays)).toBe(false);
  });
});

describe('workingDaysBetween', () => {
  const holidays = [
    { countryCode: 'IT', startDate: new Date('2025-01-06'), endDate: new Date('2025-01-06') }, // Epifania
  ];

  it('counts working days in a week (Mon-Fri)', () => {
    // Jan 6 (Mon, holiday IT) to Jan 10 (Fri): 5 calendar days
    // Without holiday: 5 working days. With IT holiday on Jan 6: 4 working days
    const result = workingDaysBetween(new Date('2025-01-06'), new Date('2025-01-10'), ['IT'], holidays);
    expect(result).toBe(4);
  });

  it('returns 1 for same day working day (inclusive)', () => {
    // workingDaysBetween is inclusive on both ends
    expect(workingDaysBetween(new Date('2025-01-06'), new Date('2025-01-06'), [], [])).toBe(1);
  });

  it('supports negative direction', () => {
    const fwd = workingDaysBetween(new Date('2025-01-06'), new Date('2025-01-10'), [], []);
    const bwd = workingDaysBetween(new Date('2025-01-10'), new Date('2025-01-06'), [], []);
    expect(bwd).toBe(-fwd);
  });
});
