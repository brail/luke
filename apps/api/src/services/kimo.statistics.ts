/**
 * Kimo + Bidone statistics service — xlsx builder (streaming)
 *
 * Stessa architettura di sales.statistics.ts (ExcelJS WorkbookWriter streaming).
 * 28 colonne fisse, schema SO (step0), con DocType che distingue SO vs BASKET.
 */

import ExcelJS from 'exceljs';

import type { KimoRow } from './kimo-pg-query';

import {
  type XlsxMeta,
  applyStreamingHeaderStyle,
  createStreamingBuffer,
} from '../lib/export/xlsx-streaming';

// ─── Column definitions ───────────────────────────────────────────────────────

/**
 * Colonne output nell'ordine dell'Excel, con nome display e chiave in KimoRow.
 * Ordine fedele allo schema SO (query #14 kimo-test.txt).
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
 * Costruisce un buffer xlsx dal risultato della query KIMO (SO + BASKET).
 * WorkbookWriter streaming: memoria O(1) rispetto alle righe.
 */
export async function buildKimoXlsx(
  rows: KimoRow[],
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

  // Riga intestazione
  const headerRow = sheet.addRow(KIMO_COLUMNS.map(c => c.header));
  applyStreamingHeaderStyle(headerRow, 'report');
  await (headerRow as ExcelJS.Row & { commit(): Promise<void> }).commit();

  // Righe dati — commit immediato per liberare memoria
  for (const row of rows) {
    const values = KIMO_COLUMNS.map(col => {
      const val = row[col.key];
      if (val === null || val === undefined || val === '') return null;
      if (DATE_KEYS.has(col.key) && val instanceof Date) return val;
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
