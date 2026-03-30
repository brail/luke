/**
 * Sales statistics service — xlsx builder (streaming)
 *
 * Usa ExcelJS WorkbookWriter (streaming) invece del Workbook in-memory per evitare
 * OOM su dataset grandi (es. 76.000 righe × 100 colonne = ~4 GB heap con il builder
 * classico). Il builder streaming scrive ogni riga su stream e la libera subito.
 */

import { PassThrough } from 'stream';

import ExcelJS from 'exceljs';

import type { PortafoglioRow } from '@luke/nav';

// ─── Column formatting hints ─────────────────────────────────────────────────

const NUMERIC_COLUMNS = new Set([
  'QuantitySold', 'PairsSold', 'ValueSold',
  'QuantityShipped', 'PairsShipped', 'ValueShipped',
  'QuantityInvoiced', 'PairsInvoiced', 'ValueInvoiced',
  'QuantityReadyForShippingTotale', 'PairsReadyForShippingTotale', 'ValueReadyForShippingTotale',
  'QuantityReadyForShippingRilasciate', 'PairsReadyForShippingRilasciate', 'ValueReadyForShippingRilasciate',
  'QuantityReadyForShippingAperte', 'PairsReadyForShippingAperte', 'ValueReadyForShippingAperte',
  'QuantityReadyForShippingDaInviareWMSps', 'PairsReadyForShippingDaInviareWMSps',
  'QuantityReadyForShippingInviatoWMSps', 'PairsReadyForShippingInviatoWMSps',
  'QuantityReadyForShippingEvasoWMSps', 'PairsReadyForShippingEvasoWMSps',
  'QuantityShippedReleased', 'PairsShippedReleased', 'ValueShippedReleased',
  'QuantityReturned', 'PairsReturned', 'ValueReturned',
  'QuantityCredited', 'PairsCredited', 'ValueCredited',
  'ProvvigioneAgente', 'ProvvigioneCapozona',
  'ProvvigioneSoggetto1', 'ProvvigioneSoggetto2', 'ProvvigioneSoggetto3', 'ProvvigioneSoggetto4',
  'ScontoFattura', 'ScontoRiga', 'Sconto1Riga', 'Sconto2Riga', 'Sconto3Riga',
  'PercentualeDirittoAlReso',
  'landed Cost', 'EstimatedLandedCostOnSold', 'EstimatedMargin',
  'EstimatedCommissionSalesPerson', 'EstimatedCommissionAreaManager',
  'EstimatedCommissionSubject1', 'EstimatedCommissionSubject2',
  'EstimatedCommissionSubject3', 'EstimatedCommissionSubject4',
  'EstimatedSecondMargin',
  'PuntiVendita', 'MOQ',
]);

const DATE_COLUMNS = new Set([
  'Order Date', 'Delete Date', 'Anomalous Date', 'Checked Date',
  'Requested Delivery Date', 'Date Reservation', 'DataDecorrenza',
  'Sold Out Date', 'Sales_Purchase Status Date',
  'LinceAggiornamentoFile', 'LinceDataEvasione', 'Valuation Date',
]);

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Costruisce un buffer xlsx dal risultato del portafoglio ordini usando il
 * WorkbookWriter in streaming. Ogni riga viene scritta su stream e rilasciata
 * immediatamente: memoria O(1) rispetto alle righe (non O(n)).
 */
interface XlsxMeta {
  title?: string;
  subject?: string;
  author?: string;
  manager?: string;
}

export async function buildPortafoglioXlsx(
  rows: PortafoglioRow[],
  sheetName = 'Portafoglio',
  meta: XlsxMeta = {},
): Promise<Buffer> {
  const pass = new PassThrough();

  // Raccoglie i chunk in uscita dallo stream xlsx
  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pass.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);
  });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: pass,
    useStyles: true,
    useSharedStrings: false, // shared strings aumentano memoria senza benefici qui
  });

  // core.xml — letto correttamente da WorkbookWriter tramite `this`
  wb.creator        = meta.author ?? 'Luke';
  wb.lastModifiedBy = meta.author ?? 'Luke';
  wb.title          = meta.title  ?? '';
  wb.subject        = meta.subject ?? '';
  wb.created        = new Date();
  wb.modified       = new Date();

  // app.xml — ExcelJS streaming bug: addApp() passa { worksheets } senza company/manager.
  // Sovrascriviamo addApp per includere i campi mancanti.
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

  const columns = Object.keys(rows[0]!);

  // Larghezze colonne — va impostato PRIMA di aggiungere righe in streaming
  sheet.columns = columns.map(key => ({ key, width: 18 }));

  // Riga intestazione
  const headerRow = sheet.addRow(columns);
  headerRow.height = 20;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' },
  } as ExcelJS.Fill;
  headerRow.alignment = { vertical: 'middle', wrapText: false };
  await (headerRow as ExcelJS.Row & { commit(): Promise<void> }).commit();

  // Righe dati — commit immediato = memoria liberata dopo ogni riga
  for (const row of rows) {
    const values = columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined || val === '') return null;
      if (DATE_COLUMNS.has(col) && val instanceof Date) return val;
      if (NUMERIC_COLUMNS.has(col) && typeof val === 'number') return val;
      if (typeof val === 'boolean') return val ? 'SI' : 'NO';
      return String(val);
    });

    const dataRow = sheet.addRow(values);
    dataRow.height = 15;

    columns.forEach((col, i) => {
      const cell = dataRow.getCell(i + 1);
      if (NUMERIC_COLUMNS.has(col) && typeof row[col] === 'number') {
        cell.numFmt = '#,##0.00';
      } else if (DATE_COLUMNS.has(col) && row[col] instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy';
      }
    });

    await (dataRow as ExcelJS.Row & { commit(): Promise<void> }).commit();
  }

  await (sheet as ExcelJS.Worksheet & { commit(): Promise<void> }).commit();
  await wb.commit();

  return bufferPromise;
}
