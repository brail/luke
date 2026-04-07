/**
 * Kimo + Bidone statistics service — xlsx builder (streaming)
 *
 * Stessa architettura di sales.statistics.ts (ExcelJS WorkbookWriter streaming).
 * 28 colonne fisse, schema SO (step0), con DocType che distingue SO vs BASKET.
 */

import { PassThrough } from 'stream';

import ExcelJS from 'exceljs';

import type { KimoRow } from './kimo-pg-query';

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

interface XlsxMeta {
  title?: string;
  subject?: string;
  author?: string;
  manager?: string;
}

/**
 * Costruisce un buffer xlsx dal risultato della query KIMO (SO + BASKET).
 * WorkbookWriter streaming: memoria O(1) rispetto alle righe.
 */
export async function buildKimoXlsx(
  rows: KimoRow[],
  sheetName = 'Vendite+Bidone',
  meta: XlsxMeta = {},
): Promise<Buffer> {
  const pass = new PassThrough();

  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pass.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    pass.on('end',   () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);
  });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: pass,
    useStyles: true,
    useSharedStrings: false,
  });

  wb.creator        = meta.author  ?? 'Luke';
  wb.lastModifiedBy = meta.author  ?? 'Luke';
  wb.title          = meta.title   ?? '';
  wb.subject        = meta.subject ?? '';
  wb.created        = new Date();
  wb.modified       = new Date();

  const company = meta.manager ?? '';
  (wb as unknown as { addApp(): Promise<void> }).addApp = () =>
    new Promise<void>(resolve => {
      const sheetNames = (wb as unknown as { _worksheets: ({ name: string } | undefined)[] })
        ._worksheets.filter(Boolean).map(ws => ws!.name);
      const pairs = sheetNames.length;
      const titlesXml = sheetNames.map(n => `<vt:lpstr>${n}</vt:lpstr>`).join('');
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
        `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
        `<Application>Microsoft Excel</Application>` +
        `<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>` +
        `<HeadingPairs><vt:vector size="2" baseType="variant">` +
        `<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>` +
        `<vt:variant><vt:i4>${pairs}</vt:i4></vt:variant>` +
        `</vt:vector></HeadingPairs>` +
        `<TitlesOfParts><vt:vector size="${pairs}" baseType="lpstr">${titlesXml}</vt:vector></TitlesOfParts>` +
        `<Company></Company>` +
        `<Manager>${company}</Manager>` +
        `<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>` +
        `<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>` +
        `</Properties>`;
      (wb as unknown as { zip: { append(xml: string, opts: { name: string }): void } })
        .zip.append(xml, { name: 'docProps/app.xml' });
      resolve();
    });

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
  headerRow.height = 20;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' },
  } as ExcelJS.Fill;
  headerRow.alignment = { vertical: 'middle', wrapText: false };
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
