/**
 * Kimo + Bidone statistics service — streaming XLSX builder.
 * Uses ExcelJS WorkbookWriter (same architecture as sales.statistics.ts) for O(1) memory.
 * 28 fixed columns following the SO schema (query step 0), with DocType distinguishing SO vs BASKET.
 */

import ExcelJS from 'exceljs';

import { isInstantInRange, wallClockDate } from '@luke/core';
import type { KimoRow } from '@luke/nav';

import {
  type XlsxMeta,
  applyStreamingHeaderStyle,
  createStreamingBuffer,
} from '../lib/export/xlsxStreaming';

// ─── Column definitions ───────────────────────────────────────────────────────

/**
 * Output column definitions in Excel order, matching the SO schema (query #14 kimo-test.txt).
 */
const KIMO_COLUMNS: { header: string; key: keyof KimoRow }[] = [
  { header: 'DocType',                    key: 'docType' },
  { header: 'Trademark Code',             key: 'trademarkCode' },
  { header: 'Salesperson Code Nav',       key: 'salespersonCodeNav' },
  { header: 'SalesPersonName',            key: 'salespersonName' },
  { header: 'Entry No_',                  key: 'entryNo' },
  { header: 'No_',                        key: 'no_' },
  { header: 'Model Item No_',             key: 'modelItemNo' },
  { header: 'Color Code',                 key: 'colorCode' },
  { header: 'Size Code',                  key: 'sizeCode' },
  { header: 'Description',               key: 'description' },
  { header: 'Description 2',             key: 'description2' },
  { header: 'Line Code',                  key: 'lineCode' },
  { header: 'Pairs',                      key: 'pairs' },
  { header: 'Value Sold',                 key: 'valueSold' },
  { header: 'Vendor No_',                 key: 'vendorNo' },
  { header: 'Vendor Name',               key: 'vendorName' },
  { header: 'Manufacturer Code',          key: 'manufacturerCode' },
  { header: 'Manufacturer Name',          key: 'manufacturerName' },
  { header: 'Collection Code',            key: 'collectionCode' },
  { header: 'Season Code',               key: 'seasonCode' },
  { header: 'Assigned Sales Document No_', key: 'assignedSalesDocumentNo' },
  { header: 'Sell-to Customer No_',       key: 'customerNo' },
  { header: 'Customer Name',             key: 'customerName' },
  { header: 'Type',                       key: 'type' },
  { header: 'Create SO Date Time',        key: 'createSoDateTime' },
  { header: 'Release SO Date Time',       key: 'releaseSoDateTime' },
  { header: 'KIMO_FASHION SO Reference',  key: 'kimoFashionSoReference' },
  { header: 'KIMO Document Type',         key: 'kimoDocumentType' },
];

const NUMERIC_KEYS = new Set<keyof KimoRow>(['pairs', 'valueSold']);
const DATE_KEYS    = new Set<keyof KimoRow>(['createSoDateTime', 'releaseSoDateTime']);

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Builds an XLSX buffer from KIMO SO + BASKET query results using streaming WorkbookWriter.
 * Each row is committed immediately, keeping memory usage O(1) relative to row count.
 *
 * @param timeZone - The reader's zone (`getUserTimeZone`): the datetime cells show its wall clock,
 *   and a note on their headers names it (ADR-035 §Formatting) — the column names stay the NAV
 *   field names that readers of the workbook look columns up by.
 * @param sheetName - Worksheet tab name (default: 'Vendite+Bidone').
 * @param meta - Optional workbook metadata (title, author, etc.).
 */
export async function buildKimoXlsx(
  rows: KimoRow[],
  timeZone: string,
  sheetName = 'Vendite+Bidone',
  meta: XlsxMeta = {},
): Promise<Buffer> {
  const { wb, bufferPromise } = createStreamingBuffer(meta);

  const sheet = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  if (rows.length === 0) {
    await wb.commit();
    return bufferPromise;
  }

  sheet.columns = KIMO_COLUMNS.map(c => ({ key: c.key, width: 20 }));

  // Header row
  const headerRow = sheet.addRow(KIMO_COLUMNS.map(c => c.header));
  KIMO_COLUMNS.forEach((c, i) => {
    if (DATE_KEYS.has(c.key)) headerRow.getCell(i + 1).note = `Orari in ${timeZone}`;
  });
  applyStreamingHeaderStyle(headerRow, 'report');
  await (headerRow as ExcelJS.Row & { commit(): Promise<void> }).commit();

  // Data rows — committed immediately to free memory
  for (const row of rows) {
    const values = KIMO_COLUMNS.map(col => {
      const val = row[col.key];
      if (val === null || val === undefined || val === '') return null;
      // Excel has no zones: the cell holds the reader's wall clock. NAV's blank datetime (1753-01-01),
      // or any other value outside the stored range, is a missing value (ADR-035 §External dates).
      if (DATE_KEYS.has(col.key) && val instanceof Date) return isInstantInRange(val, { allDay: false }) ? wallClockDate(val, timeZone) : null;
      if (NUMERIC_KEYS.has(col.key) && typeof val === 'number') return val;
      if (typeof val === 'boolean') return val ? 'SI' : 'NO';
      return String(val);
    });

    const dataRow = sheet.addRow(values);
    dataRow.height = 15;

    KIMO_COLUMNS.forEach((col, i) => {
      const cell = dataRow.getCell(i + 1);
      const val  = row[col.key];
      if (NUMERIC_KEYS.has(col.key) && typeof val === 'number') {
        cell.numFmt = '#,##0.00';
      } else if (DATE_KEYS.has(col.key) && val instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy hh:mm';
      }
    });

    await (dataRow as ExcelJS.Row & { commit(): Promise<void> }).commit();
  }

  await (sheet as ExcelJS.Worksheet & { commit(): Promise<void> }).commit();
  await wb.commit();

  return bufferPromise;
}
