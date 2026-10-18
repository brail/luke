/**
 * A relative time reads as Italian, past or ahead: singular and plural agree with the number, and
 * beyond a day it counts calendar days in the reader zone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatRelativeTime } from '../relativeTime';

const NOW = new Date('2026-10-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ROME = 'Europe/Rome';

describe('formatRelativeTime', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it('agrees singular and plural with the number', () => {
    expect(formatRelativeTime(ago(30_000), ROME)).toBe('ora');
    expect(formatRelativeTime(ago(MINUTE), ROME)).toBe('1 minuto fa');
    expect(formatRelativeTime(ago(5 * MINUTE), ROME)).toBe('5 minuti fa');
    expect(formatRelativeTime(ago(HOUR), ROME)).toBe('1 ora fa');
    expect(formatRelativeTime(ago(3 * HOUR), ROME)).toBe('3 ore fa');
    expect(formatRelativeTime(ago(DAY), ROME)).toBe('ieri');
    expect(formatRelativeTime(ago(5 * DAY), ROME)).toBe('5 giorni fa');
  });

  it('words a time ahead the same way when asked to', () => {
    expect(formatRelativeTime(ahead(30_000), ROME, { ahead: true })).toBe('ora');
    expect(formatRelativeTime(ahead(5 * MINUTE), ROME, { ahead: true })).toBe('tra 5 minuti');
    expect(formatRelativeTime(ahead(HOUR), ROME, { ahead: true })).toBe('tra 1 ora');
    expect(formatRelativeTime(ahead(DAY), ROME, { ahead: true })).toBe('domani');
  });

  it('counts days beyond the first 24 hours as calendar days in the reader zone', () => {
    // 00:30 on 10 October in Rome.
    vi.setSystemTime(new Date('2026-10-09T22:30:00Z'));
    // 47 hours earlier is 01:30 on 8 October: two days ago, not "ieri".
    expect(formatRelativeTime(new Date('2026-10-07T23:30:00Z'), ROME)).toBe('l’altro ieri');
    // 32.5 hours ahead is 09:00 on 11 October.
    expect(formatRelativeTime(new Date('2026-10-11T07:00:00Z'), ROME, { ahead: true })).toBe('domani');
    // Within 24 hours it stays a count of hours, across midnight too.
    expect(formatRelativeTime(new Date('2026-10-09T21:30:00Z'), ROME)).toBe('1 ora fa');
  });

  it('keeps a count of hours on a 25-hour day, where 24 hours earlier is still the same day', () => {
    // 23:55 on 25 October in Rome, the day clocks go back; 24h10m earlier is 00:45 that same day.
    vi.setSystemTime(new Date('2026-10-25T22:55:00Z'));
    expect(formatRelativeTime(new Date('2026-10-24T22:45:00Z'), ROME)).toBe('24 ore fa');
  });

  it('writes minutes and hours before the zone is known, and a count of days only after', () => {
    expect(formatRelativeTime(ago(3 * HOUR), undefined)).toBe('3 ore fa');
    expect(formatRelativeTime(ago(2 * DAY), undefined)).toBe('…');
  });

  it('reads a past timestamp from a clock running behind as now, not as ahead', () => {
    expect(formatRelativeTime(ahead(3 * MINUTE), ROME)).toBe('ora');
  });
});
