/**
 * Export filenames carry a `YYYYMMdd-HHmm` stamp on the requester's wall clock, not the server's.
 */

import { describe, expect, it } from 'vitest';

import { exportTimestamp } from '../src/lib/export/xlsxStreaming';

describe('exportTimestamp', () => {
  it("writes the requester's local date and time", () => {
    const at = new Date('2032-03-01T20:05:00Z');
    expect(exportTimestamp('Asia/Tokyo', at)).toBe('20320302-0505');
    expect(exportTimestamp('Europe/Rome', at)).toBe('20320301-2105');
    expect(exportTimestamp('America/Los_Angeles', at)).toBe('20320301-1205');
  });

  it('writes midnight as 00, not 24', () => {
    expect(exportTimestamp('UTC', new Date('2032-03-01T00:07:00Z'))).toBe('20320301-0007');
  });
});
