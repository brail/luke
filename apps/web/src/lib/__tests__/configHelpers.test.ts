/**
 * A config export is named, like the API's exports, by the server's export time read in the
 * reader zone.
 */

import { expect, it } from 'vitest';

import { generateExportFileName } from '../configHelpers';

it("names the config export by the server's export time in the reader zone", () => {
  // 23:30 UTC on 28 June is 01:30 on 29 June in Rome.
  expect(generateExportFileName('2026-06-28T23:30:00.000Z', 'Europe/Rome')).toBe('luke-config-export-20260629-0130.json');
});
