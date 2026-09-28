/**
 * The deadline rules every consumer shares: the day a deadline falls on, the instant it is reached
 * — an all-day deadline at the end of its day in the business zone, a timed one at its instant —
 * and the post-freeze lock built on it.
 */

import { describe, it, expect } from 'vitest';

import { deadlineDay, deadlineReachedAt, isEventDateLocked } from '../calendarEventLock.js';

const ROME = 'Europe/Rome';
const iso = (d: Date) => d.toISOString();

describe('deadlineDay', () => {
  it('an all-day deadline is its stored date, whatever the zone', () => {
    const event = { startAt: '2026-10-02T00:00:00.000Z', allDay: true };
    expect(deadlineDay(event, ROME)).toBe('2026-10-02');
    expect(deadlineDay(event, 'America/Los_Angeles')).toBe('2026-10-02');
  });

  it('a timed deadline is the date of its instant in the business zone', () => {
    const event = { startAt: '2026-10-02T22:30:00.000Z', allDay: false };
    expect(deadlineDay(event, ROME)).toBe('2026-10-03');
    expect(deadlineDay(event, 'UTC')).toBe('2026-10-02');
  });

  it('measures a window against its end', () => {
    const event = { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-09T00:00:00.000Z', allDay: true };
    expect(deadlineDay(event, ROME)).toBe('2026-10-09');
  });
});

describe('deadlineReachedAt', () => {
  it('an all-day deadline is reached when its day ends in the business zone', () => {
    const event = { startAt: '2026-10-02T00:00:00.000Z', allDay: true };
    expect(iso(deadlineReachedAt(event, ROME))).toBe('2026-10-02T22:00:00.000Z');
    expect(iso(deadlineReachedAt(event, 'Asia/Shanghai'))).toBe('2026-10-02T16:00:00.000Z');
    // West of UTC the end of the day falls on the next UTC date.
    expect(iso(deadlineReachedAt(event, 'America/Los_Angeles'))).toBe('2026-10-03T07:00:00.000Z');
  });

  it('follows a DST change on the following night', () => {
    const event = { startAt: '2026-10-24T00:00:00.000Z', allDay: true };
    expect(iso(deadlineReachedAt(event, ROME))).toBe('2026-10-24T22:00:00.000Z');
    const next = { startAt: '2026-10-25T00:00:00.000Z', allDay: true };
    expect(iso(deadlineReachedAt(next, ROME))).toBe('2026-10-25T23:00:00.000Z');
  });

  it('a timed deadline is reached at its own instant', () => {
    const event = { startAt: '2026-10-02T08:00:00.000Z', allDay: false };
    expect(iso(deadlineReachedAt(event, ROME))).toBe('2026-10-02T08:00:00.000Z');
  });
});

describe('isEventDateLocked', () => {
  const frozen = { phaseId: 'phase-1', frozenAt: '2026-01-01T00:00:00.000Z' };
  const dueFriday = { ...frozen, startAt: '2026-10-02T00:00:00.000Z', allDay: true };

  it('an all-day deadline stays editable all day and locks when the day ends', () => {
    expect(isEventDateLocked(dueFriday, ROME, new Date('2026-10-02T21:59:59.999Z'))).toBe(false);
    expect(isEventDateLocked(dueFriday, ROME, new Date('2026-10-02T22:00:00.000Z'))).toBe(true);
  });

  it('a timed deadline locks at its instant', () => {
    const timed = { ...frozen, startAt: '2026-10-02T08:00:00.000Z', allDay: false };
    expect(isEventDateLocked(timed, ROME, new Date('2026-10-02T07:59:59.999Z'))).toBe(false);
    expect(isEventDateLocked(timed, ROME, new Date('2026-10-02T08:00:00.000Z'))).toBe(true);
  });

  it('needs both a phase and a frozen group', () => {
    const after = new Date('2026-11-01T00:00:00.000Z');
    expect(isEventDateLocked({ ...dueFriday, phaseId: null }, ROME, after)).toBe(false);
    expect(isEventDateLocked({ ...dueFriday, frozenAt: null }, ROME, after)).toBe(false);
  });
});
