/**
 * The "last sync" and "next sync" labels of a NAV replica card: the next one only with an automatic
 * schedule, nothing at all before the first sync.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncStatusInfo } from '../navSyncStatus';

const NOW = new Date('2026-10-16T12:00:00Z');
const fmt = {
  dateTime: (value: Date) => value.toISOString(),
  relative: (value: Date, options?: { ahead?: boolean }) => `${options?.ahead ? 'in' : 'ago'} ${value.toISOString()}`,
};
const state = { tables: [{ tableName: 'nav_pf_sales_header', lastSyncedAt: '2026-10-16T11:00:00Z' }] };

describe('syncStatusInfo', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it('has no next sync without a schedule', () => {
    expect(syncStatusInfo(state, null, 'nav_pf_sales_header', fmt)?.nextSyncLabel).toBeNull();
  });

  it('has no next sync when the automatic sync is off', () => {
    const schedule = { autoSyncEnabled: false, intervalMinutes: 30 };
    expect(syncStatusInfo(state, schedule, 'nav_pf_sales_header', fmt)?.nextSyncLabel).toBeNull();
  });

  it('dates the next sync one interval after the last one', () => {
    const schedule = { autoSyncEnabled: true, intervalMinutes: 120 };
    expect(syncStatusInfo(state, schedule, 'nav_pf_sales_header', fmt)).toEqual({
      lastSyncLabel: '2026-10-16T11:00:00.000Z (ago 2026-10-16T11:00:00.000Z)',
      nextSyncLabel: 'in 2026-10-16T13:00:00.000Z',
    });
  });

  it('shows nothing before the first sync', () => {
    const schedule = { autoSyncEnabled: true, intervalMinutes: 120 };
    expect(syncStatusInfo({ tables: [] }, schedule, 'nav_pf_sales_header', fmt)).toBeNull();
  });
});
