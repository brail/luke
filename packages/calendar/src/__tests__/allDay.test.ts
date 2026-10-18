import { describe, it, expect } from 'vitest';

import { dayAfter } from '../allDay.js';

describe('dayAfter', () => {
  it.each([
    ['2026-03-10T00:00:00.000Z', '2026-03-11T00:00:00.000Z'],
    ['2026-01-31T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
    ['2026-12-31T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    ['2028-02-28T00:00:00.000Z', '2028-02-29T00:00:00.000Z'],
    ['2028-02-29T00:00:00.000Z', '2028-03-01T00:00:00.000Z'],
    // A time of day is dropped: the result is the next day's UTC midnight.
    ['2026-03-10T23:30:00.000Z', '2026-03-11T00:00:00.000Z'],
  ])('%s → %s', (lastDay, expected) => {
    expect(dayAfter(new Date(lastDay)).toISOString()).toBe(expected);
  });
});
