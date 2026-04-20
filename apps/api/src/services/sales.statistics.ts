/**
 * Sales statistics service — xlsx builder (streaming)
 *
 * Usa ExcelJS WorkbookWriter (streaming) invece del Workbook in-memory per evitare
 * OOM su dataset grandi (es. 76.000 righe × 100 colonne = ~4 GB heap con il builder
 * classico). Il builder streaming scrive ogni riga su stream e la libera subito.
 */

import ExcelJS from 'exceljs';

import type { PortafoglioRow } from '@luke/nav';

import {
  type XlsxMeta,
  applyStreamingHeaderStyle,
  createStreamingBuffer,
} from '../lib/export/xlsx-streaming';

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
export async function buildPortafoglioXlsx(
  rows: PortafoglioRow[],
  sheetName = 'Portafoglio',
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

  const columns = Object.keys(rows[0]!);

  // Larghezze colonne — va impostato PRIMA di aggiungere righe in streaming
  sheet.columns = columns.map(key => ({ key, width: 18 }));

  // Riga intestazione
  const headerRow = sheet.addRow(columns);
  applyStreamingHeaderStyle(headerRow, 'report');
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
