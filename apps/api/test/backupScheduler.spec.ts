/**
 * Which scheduled slot a backup tick answers for (`latestBackupSlot`): today's `dailyTime` in the
 * business zone, or yesterday's while today's is still ahead — so a slot crossed between two hourly
 * ticks, or around midnight, still gets its run, attributed to its own date.
 */

import { describe, it, expect } from 'vitest';

import { latestBackupSlot } from '../src/lib/backupScheduler';

const ROME = 'Europe/Rome';
const slot = (now: string, dailyTime: string) => latestBackupSlot(new Date(now), dailyTime, ROME).toISOString();

describe('latestBackupSlot', () => {
  it("is today's slot once it has come", () => {
    // 23:30 in Rome, slot at 23:00.
    expect(slot('2026-10-02T21:30:00.000Z', '23:00')).toBe('2026-10-02T21:00:00.000Z');
    expect(slot('2026-10-02T21:00:00.000Z', '23:00')).toBe('2026-10-02T21:00:00.000Z');
  });

  it("is yesterday's slot while today's is still ahead", () => {
    // 22:30 in Rome, slot at 23:00: the one that counts is yesterday's.
    expect(slot('2026-10-02T20:30:00.000Z', '23:00')).toBe('2026-10-01T21:00:00.000Z');
  });

  it("a 23:30 slot crossed by ticks at :15 runs after midnight, as the previous day's", () => {
    // 00:15 in Rome on the 3rd.
    expect(slot('2026-10-02T22:15:00.000Z', '23:30')).toBe('2026-10-02T21:30:00.000Z');
  });

  it('is read in the business zone, whatever the process zone', () => {
    // 03:00 in Rome is 01:00Z in summer and 02:00Z in winter.
    expect(slot('2026-07-01T05:00:00.000Z', '03:00')).toBe('2026-07-01T01:00:00.000Z');
    expect(slot('2026-12-01T05:00:00.000Z', '03:00')).toBe('2026-12-01T02:00:00.000Z');
  });

  it('a slot the spring-forward jump skips starts right after it', () => {
    expect(slot('2026-03-29T01:30:00.000Z', '02:00')).toBe('2026-03-29T01:00:00.000Z');
  });
});
