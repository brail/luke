/**
 * The time-of-day greeting: one rule for the daily greeting and the dashboard header, read in the
 * reader's zone.
 */

import { describe, expect, it } from 'vitest';

import { greetingAt } from '../greeting.js';

describe('greetingAt', () => {
  it.each([
    ['2026-01-15T03:59:00Z', 'Buonasera'], // 04:59 in Rome
    ['2026-01-15T04:00:00Z', 'Buongiorno'], // 05:00
    ['2026-01-15T10:59:00Z', 'Buongiorno'], // 11:59
    ['2026-01-15T11:00:00Z', 'Buon pomeriggio'], // 12:00
    ['2026-01-15T16:59:00Z', 'Buon pomeriggio'], // 17:59
    ['2026-01-15T17:00:00Z', 'Buonasera'], // 18:00
  ])('at %s in Europe/Rome says %s', (instant, greeting) => {
    expect(greetingAt(new Date(instant), 'Europe/Rome')).toBe(greeting);
  });

  it("reads the hour in the reader's zone", () => {
    // 20:00 UTC: 21:00 in Rome, 04:00 the next morning in Shanghai, 12:00 in Los Angeles.
    const instant = new Date('2026-01-15T20:00:00Z');
    expect(greetingAt(instant, 'Asia/Shanghai')).toBe('Buonasera');
    expect(greetingAt(instant, 'America/Los_Angeles')).toBe('Buon pomeriggio');
  });
});
