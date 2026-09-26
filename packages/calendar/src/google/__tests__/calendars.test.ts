import { describe, it, expect } from 'vitest';

import { buildCalendarSummary } from '../calendars.js';

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
