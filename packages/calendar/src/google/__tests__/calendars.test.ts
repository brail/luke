import { describe, it, expect, vi } from 'vitest';

import { buildCalendarSummary, deleteCalendar } from '../calendars.js';

const { calendars } = vi.hoisted(() => ({
  calendars: { delete: vi.fn() },
}));

vi.mock('../client.js', () => ({
  getClient: () => ({ calendars }),
}));

describe('buildCalendarSummary', () => {
  it('composes the calendar name in the Luke • brand • season • section format', () => {
    // The name is the only way to recognize a Luke calendar among the dozens in a
    // Workspace account: the prefix and the segment order are part of the contract,
    // not cosmetics.
    expect(buildCalendarSummary('ACME', 'FW25', 'Prodotto')).toBe(
      'Luke • ACME • FW25 • Prodotto'
    );
  });

  it('does not alter the segments it receives', () => {
    expect(buildCalendarSummary('a-b', '2025/26', 'Sez. 1')).toBe(
      'Luke • a-b • 2025/26 • Sez. 1'
    );
  });
});

describe('deleteCalendar', () => {
  it.each([404, 410])('is idempotent: a %i is not an error', async code => {
    // Both mean the calendar is gone: the desired state.
    calendars.delete.mockRejectedValue(Object.assign(new Error('Gone'), { code }));

    await expect(deleteCalendar('gcal-1')).resolves.toBeUndefined();
  });

  it('propagates errors other than 404 and 410', async () => {
    calendars.delete.mockRejectedValue(Object.assign(new Error('Forbidden'), { code: 403 }));

    await expect(deleteCalendar('gcal-1')).rejects.toThrow('Forbidden');
  });
});
