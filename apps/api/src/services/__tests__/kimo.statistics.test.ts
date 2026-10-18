/**
 * The KIMO workbook writes NAV's datetimes — instants — in the reader zone and names it in a note
 * on their headers (ADR-035 §Formatting): its cells showed the UTC time without saying so.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { KimoRow } from '@luke/nav';

import { buildKimoXlsx } from '../kimo.statistics';

// Type assertion: the builder reads each column by key, and an absent one is an empty cell.
// NAV's blank datetime is 1753-01-01: a missing value.
const row = { docType: 'SO', createSoDateTime: new Date('2026-07-01T10:00:00Z'), releaseSoDateTime: new Date('1753-01-01T00:00:00Z') } as unknown as KimoRow;

describe('buildKimoXlsx', () => {
  it('writes the datetimes in the reader zone, and names it in a note on their headers', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(await buildKimoXlsx([row], 'Europe/Rome')).buffer);
    const sheet = workbook.worksheets[0]!;
    // Type assertion: a row's `values` is a sparse array, index 0 unused.
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const created = headers.indexOf('Create SO Date Time') + 1;
    const released = headers.indexOf('Release SO Date Time') + 1;

    // The column names stay NAV's: the zone is in a note.
    expect([sheet.getRow(1).getCell(created).note, sheet.getRow(1).getCell(released).note]).toEqual(['Orari in Europe/Rome', 'Orari in Europe/Rome']);
    // Excel has no zones: the cell holds Rome's wall clock, 12:00 in July.
    // Type assertion: a datetime cell reads back as a `Date`.
    expect((sheet.getRow(2).getCell(created).value as Date).toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(sheet.getRow(2).getCell(released).value).toBeNull();
  });
});
