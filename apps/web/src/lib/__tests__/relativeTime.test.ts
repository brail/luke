/**
 * A relative time reads as Italian, past or ahead: singular and plural agree with the number.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatRelativeTime } from '../relativeTime';

const NOW = new Date('2026-10-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it('agrees singular and plural with the number', () => {
    expect(formatRelativeTime(ago(30_000))).toBe('ora');
    expect(formatRelativeTime(ago(MINUTE))).toBe('1 minuto fa');
    expect(formatRelativeTime(ago(5 * MINUTE))).toBe('5 minuti fa');
    expect(formatRelativeTime(ago(HOUR))).toBe('1 ora fa');
    expect(formatRelativeTime(ago(3 * HOUR))).toBe('3 ore fa');
    expect(formatRelativeTime(ago(DAY))).toBe('ieri');
    expect(formatRelativeTime(ago(5 * DAY))).toBe('5 giorni fa');
  });

  it('words a time ahead the same way when asked to', () => {
    expect(formatRelativeTime(ahead(30_000), { ahead: true })).toBe('ora');
    expect(formatRelativeTime(ahead(5 * MINUTE), { ahead: true })).toBe('tra 5 minuti');
    expect(formatRelativeTime(ahead(HOUR), { ahead: true })).toBe('tra 1 ora');
    expect(formatRelativeTime(ahead(DAY), { ahead: true })).toBe('domani');
  });

  it('reads a past timestamp from a clock running behind as now, not as ahead', () => {
    expect(formatRelativeTime(ahead(3 * MINUTE))).toBe('ora');
  });
});
