/**
 * Export service for a single Collection Layout row.
 * PDF: A4 landscape — product sheet with photo, identification fields, and a quotations table.
 * XLSX: single-workbook export with an identification sheet and a quotations sheet.
 */

import ExcelJS from 'exceljs';


import { calcMaxSupplierCost, formatDateTime } from '@luke/core';

import { bufferToDataUri, EMBED_OVERSAMPLE_FACTOR, extensionForExcelJs, resizeForEmbed } from '../lib/export/image';
import { buildBrandPageHeader, buildPdfFooter, createPdfBuffer, fetchCompanyExportContext } from '../lib/export/pdf';
import { applyStreamingHeaderStyle } from '../lib/export/xlsxStreaming';

import { readAssetBuffer, resolveLogoDataUri } from './asset.service';
import { buildProgressLabelMap } from './collectionLayout.service';

import type { QuotationWithParamSet } from './collectionLayout.service';
import type { PrismaClient,
  Brand,
  CollectionLayoutRow,
  Season,
  Vendor } from '@prisma/client';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CollectionRowForExport = CollectionLayoutRow & {
  vendor: Pick<Vendor, 'id' | 'name' | 'nickname'> | null;
  quotations: QuotationWithParamSet[];
};

export type RowExportContext = {
  brand: Pick<Brand, 'name' | 'code' | 'logoKey'>;
  season: Pick<Season, 'name' | 'code' | 'year'>;
  row: CollectionRowForExport;
};

// ─── Currency symbols ────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', CHF: 'CHF', CNY: '¥',
};

function currSym(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

// ─── Margin computation ───────────────────────────────────────────────────────

type MarginResult = {
  bt: number | null;
  lc: number | null;
  ws: number | null;
  margin: number | null;
  targetMargin: number | null;
  status: 'green' | 'yellow' | 'red' | null;
};

function computeQuotationMargin(q: QuotationWithParamSet): MarginResult {
  const empty: MarginResult = { bt: null, lc: null, ws: null, margin: null, targetMargin: null, status: null };
  const ps = q.pricingParameterSet;
  if (!ps) return empty;

  const targetMargin = ps.optimalMargin;

  let bt: number | null = null;
  if (q.retailPrice && q.retailPrice > 0) {
    bt = calcMaxSupplierCost(q.retailPrice, ps);
  }

  if (!q.supplierQuotation || q.supplierQuotation <= 0) {
    return { ...empty, bt, targetMargin };
  }

  const qc         = q.supplierQuotation * (ps.qualityControlPercent / 100);
  const withQC     = q.supplierQuotation + qc + ps.tools;
  const withTransp = withQC + ps.transportInsuranceCost;
  const withDuty   = withTransp * (1 + ps.duty / 100);
  const lc         = withDuty / ps.exchangeRate + ps.italyAccessoryCosts;

  if (!q.retailPrice || q.retailPrice <= 0) {
    return { ...empty, bt, lc: Math.round(lc * 100) / 100, targetMargin };
  }

  const ws     = q.retailPrice / ps.retailMultiplier;
  const margin = ((ws - lc) / ws) * 100;
  const status: 'green' | 'yellow' | 'red' =
    margin >= ps.optimalMargin ? 'green'
    : margin >= ps.optimalMargin - 3 ? 'yellow'
    : 'red';

  return {
    bt:          Math.round(bt! * 100) / 100,
    lc:          Math.round(lc * 100) / 100,
    ws:          Math.round(ws * 100) / 100,
    margin:      Math.round(margin * 100) / 100,
    targetMargin,
    status,
  };
}

function fmt(val: number | null, sym?: string): string {
  if (val === null) return '—';
  const s = sym ? `${sym} ` : '';
  return `${s}${val.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(val: number | null): string {
  if (val === null) return '—';
  return `${val.toFixed(2)}%`;
}

// ─── PDF Builder ──────────────────────────────────────────────────────────────

type Logger = { warn: (obj: object, msg: string) => void };

const ROW_PHOTO_WIDTH = 120;
const ROW_PHOTO_HEIGHT = 90;

/**
 * Builds an A4 landscape PDF product sheet for a single collection row.
 * Includes the row photo, identification fields, and a per-quotation margin table.
 *
 * @param extractedBy - Display name of the requesting user (shown in the header).
 * @param extractedAt - Timestamp to include in the header.
 * @returns A Buffer containing the PDF file.
 */
export async function buildCollectionRowPdf(
  ctx: RowExportContext,
  prisma: PrismaClient,
  extractedBy: string,
  extractedAt: Date,
  logger?: Logger,
): Promise<Buffer> {
  const { brand, season, row } = ctx;

  const [brandLogoDataUri, rowImageDataUri, company, progressLabelMap] = await Promise.all([
    resolveLogoDataUri(prisma, brand.logoKey, logger),
    row.pictureKey
      ? readAssetBuffer(prisma, 'collection-row-pictures', row.pictureKey, 'export', logger).then(async result => {
          if (!result) return null;
          const resized = await resizeForEmbed(result.buffer, ROW_PHOTO_WIDTH * EMBED_OVERSAMPLE_FACTOR, ROW_PHOTO_HEIGHT * EMBED_OVERSAMPLE_FACTOR, logger);
          return resized ? bufferToDataUri(resized, result.contentType) : null;
        })
      : Promise.resolve(null),
    fetchCompanyExportContext(prisma, logger),
    buildProgressLabelMap(prisma),
  ]);

  const vendorLabel = row.vendor?.nickname ?? row.vendor?.name ?? '—';
  const pageHeader = buildBrandPageHeader(
    { name: brand.name, logoDataUri: brandLogoDataUri },
    1,
    1,
    {
      subtitle: `${row.line}${row.article ? ` / ${row.article}` : ''} — ${season.code} ${season.year}`,
      extractedInfo: `${extractedBy} — ${formatDateTime(extractedAt)}`,
    },
  );

  // Identification block
  const identFields: [string, string][] = [
    ['Gender',      row.gender],
    ['Linea',       row.line],
    ['Articolo',    row.article ?? '—'],
    ['Fornitore',   vendorLabel],
    ['Categoria',   row.productCategory],
    ['Strategy',    row.strategy ?? '—'],
    ['Status',      row.status],
    ['Style Status',row.styleStatus ?? '—'],
    ['Progress',    row.phaseId ? (progressLabelMap.get(row.phaseId) ?? '—') : '—'],
    ['Designer',    row.designer ?? '—'],
    ['SKU Forecast', row.skuForecast != null ? String(row.skuForecast) : '—'],
    ['QTY Forecast', row.qtyForecast != null ? String(row.qtyForecast) : '—'],
  ];
  if (row.toolingQuotation) {
    identFields.push(['Tooling', fmt(row.toolingQuotation, '€')]);
  }

  const identTable: Content = {
    table: {
      widths: [90, '*'],
      body: identFields.map(([label, value]) => [
        { text: label, bold: true, fontSize: 8, color: '#555555' },
        { text: value, fontSize: 8 },
      ]),
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 8] as [number, number, number, number],
  };

  const photoCell: Content = rowImageDataUri
    ? { image: rowImageDataUri, fit: [ROW_PHOTO_WIDTH, ROW_PHOTO_HEIGHT], alignment: 'center', margin: [0, 0, 0, 8] as [number, number, number, number] }
    : { text: 'No foto', fontSize: 8, color: '#999', alignment: 'center', margin: [0, 8] as [number, number] };

  const topSection: Content = {
    columns: [
      { width: 130, stack: [photoCell] },
      { width: '*', stack: [identTable] },
    ],
    columnGap: 12,
    margin: [0, 0, 0, 12] as [number, number, number, number],
  };

  // Quotations table
  const quotHeaders: Content[] = [
    'Param Set', 'Retail', 'Quotazione (FOB)', 'BT', 'LC', 'WS', 'M%', 'TM', 'Note',
  ].map(h => ({ text: h, bold: true, fontSize: 7, fillColor: '#E8EDF5', alignment: 'center' as const }));

  const quotRows: Content[][] = row.quotations.map(q => {
    const ps = q.pricingParameterSet;
    const m  = computeQuotationMargin(q);
    const sellSym = ps ? currSym(ps.sellingCurrency) : '€';
    const buySym  = ps ? currSym(ps.purchaseCurrency) : '$';

    const marginColor = m.status === 'green' ? '#22c55e' : m.status === 'yellow' ? '#f59e0b' : m.status === 'red' ? '#ef4444' : '#555555';

    return [
      { text: ps ? `${ps.name} (${ps.countryCode}/${ps.purchaseCurrency})` : '—', fontSize: 7 },
      { text: fmt(q.retailPrice, sellSym), fontSize: 7, alignment: 'right' as const },
      { text: fmt(q.supplierQuotation, buySym), fontSize: 7, alignment: 'right' as const },
      { text: fmt(m.bt, buySym), fontSize: 7, alignment: 'right' as const, color: '#555555' },
      { text: fmt(m.lc, sellSym), fontSize: 7, alignment: 'right' as const, color: '#555555' },
      { text: fmt(m.ws, sellSym), fontSize: 7, alignment: 'right' as const, color: '#555555' },
      { text: fmtPct(m.margin), fontSize: 7, alignment: 'right' as const, color: marginColor, bold: true },
      { text: fmtPct(m.targetMargin), fontSize: 7, alignment: 'right' as const, color: '#555555' },
      { text: q.notes ?? '—', fontSize: 7 },
    ];
  });

  const quotTable: Content = row.quotations.length > 0
    ? {
        table: {
          headerRows: 1,
          widths: [90, 45, 60, 45, 45, 45, 35, 35, '*'],
          body: [quotHeaders, ...quotRows],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#CCCCCC',
          vLineColor: () => '#CCCCCC',
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      }
    : { text: 'Nessuna quotazione inserita.', fontSize: 8, color: '#999999', italics: true };

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 50, 30, 56],
    header: pageHeader as Content,
    content: [topSection, quotTable],
    defaultStyle: { font: 'Roboto' },
    footer: (currentPage: number, pageCount: number) =>
      buildPdfFooter(currentPage, pageCount, {
        logoDataUri: company.companyLogoDataUri,

        address: company.address,
        footerText: company.exportSettings.footerText,
      }),
  };

  return createPdfBuffer(docDef);
}

// ─── XLSX Builder ─────────────────────────────────────────────────────────────

const ROW_XLSX_MAX_H_PX = 189; // 50mm at 96dpi

/**
 * Builds a two-sheet XLSX workbook for a single collection row:
 * `Riga` sheet with identification data and embedded photo, `Quotazioni` sheet with margin calculations.
 *
 * @returns A Buffer containing the XLSX file.
 */
export async function buildCollectionRowXlsx(
  ctx: RowExportContext,
  prisma: PrismaClient,
  logger?: Logger,
): Promise<Buffer> {
  const { brand, season, row } = ctx;
  const vendorLabel = row.vendor?.nickname ?? row.vendor?.name ?? '';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Luke';
  wb.created = new Date();

  const [rowImageResult, progressLabelMap] = await Promise.all([
    row.pictureKey ? readAssetBuffer(prisma, 'collection-row-pictures', row.pictureKey, 'export', logger) : null,
    buildProgressLabelMap(prisma),
  ]);
  // Width is capped generously (not tied to the embed box) since only height is
  // visually constrained here — see the proportional scale-by-height below.
  const rowImageBuf = rowImageResult
    ? await resizeForEmbed(rowImageResult.buffer, ROW_XLSX_MAX_H_PX * 10, ROW_XLSX_MAX_H_PX * EMBED_OVERSAMPLE_FACTOR, logger)
    : null;

  // Sheet 1: identification
  const infoSheet = wb.addWorksheet('Riga');
  infoSheet.columns = [
    { key: 'label', width: 20 },
    { key: 'value', width: 40 },
    { key: 'image', width: 18 },
  ];

  const infoHeaderRow = infoSheet.addRow(['DATI RIGA', `${brand.name} — ${season.code} ${season.year}`]);
  applyStreamingHeaderStyle(infoHeaderRow, 'planning');
  centreHeaderRow(infoHeaderRow);

  const infoData: [string, string | number | null][] = [
    ['Linea', row.line],
    ['Articolo', row.article ?? null],
    ['Gender', row.gender],
    ['Fornitore', vendorLabel],
    ['Categoria', row.productCategory],
    ['Strategy', row.strategy ?? null],
    ['Status', row.status],
    ['Style Status', row.styleStatus ?? null],
    ['Progress', row.phaseId ? (progressLabelMap.get(row.phaseId) ?? null) : null],
    ['Designer', row.designer ?? null],
    ['SKU Forecast', row.skuForecast],
    ['QTY Forecast', row.qtyForecast],
    ['Tooling', row.toolingQuotation ?? null],
  ];

  for (const [label, value] of infoData) {
    if (value === null || value === undefined) continue;
    const r = infoSheet.addRow([label, value]);
    r.getCell(1).font = { bold: true };
  }

  // Embed product image in column C, max height 50mm (189px at 96dpi), aspect-ratio preserved
  if (rowImageBuf && rowImageResult) {
    const ext = extensionForExcelJs(rowImageResult.contentType);
    let imgW = ROW_XLSX_MAX_H_PX;
    let imgH = ROW_XLSX_MAX_H_PX;
    if (rowImageResult.height && rowImageResult.height > 0) {
      const scale = Math.min(1, ROW_XLSX_MAX_H_PX / rowImageResult.height);
      imgW = Math.round((rowImageResult.width ?? ROW_XLSX_MAX_H_PX) * scale);
      imgH = Math.round(rowImageResult.height * scale);
    }
     
    const imageId = wb.addImage({ buffer: rowImageBuf as unknown as NonNullable<ExcelJS.Image['buffer']>, extension: ext }); // exceljs bundles its own stale non-generic Buffer type, structurally incompatible with @types/node's current Buffer<ArrayBufferLike>
    infoSheet.addImage(imageId, { tl: { col: 2, row: 0 }, ext: { width: imgW, height: imgH } });
    // Set row heights so the image region is visible (distribute imgH across rows 1-N)
    const rowsNeeded = Math.ceil(imgH / 20);
    for (let i = 1; i <= rowsNeeded; i++) {
      infoSheet.getRow(i).height = Math.ceil(imgH / rowsNeeded);
    }
  }

  // Sheet 2: quotations
  const quotSheet = wb.addWorksheet('Quotazioni');

  const quotColumnDefs = [
    { key: 'paramSet', width: 28 },
    { key: 'retail', width: 14 },
    { key: 'quotation', width: 16 },
    { key: 'bt', width: 14 },
    { key: 'lc', width: 14 },
    { key: 'ws', width: 14 },
    { key: 'margin', width: 10 },
    { key: 'targetMargin', width: 10 },
    { key: 'notes', width: 30 },
  ];
  quotSheet.columns = quotColumnDefs;

  const qHeaderRow = quotSheet.addRow([
    'Param Set', 'Retail', 'Quotazione (FOB)', 'BT', 'LC', 'WS', 'M%', 'TM', 'Note',
  ]);
  applyStreamingHeaderStyle(qHeaderRow, 'planning');
  centreHeaderRow(qHeaderRow);

  for (const q of row.quotations) {
    const ps = q.pricingParameterSet;
    const m  = computeQuotationMargin(q);
    const r  = quotSheet.addRow([
      ps ? `${ps.name} (${ps.countryCode}/${ps.purchaseCurrency})` : '',
      q.retailPrice ?? null,
      q.supplierQuotation ?? null,
      m.bt,
      m.lc,
      m.ws,
      m.margin !== null ? m.margin / 100 : null,
      m.targetMargin !== null ? m.targetMargin / 100 : null,
      q.notes ?? '',
    ]);
    // Format
    for (let col = 2; col <= 6; col++) r.getCell(col).numFmt = '#,##0.00';
    r.getCell(7).numFmt = '0.00%';
    r.getCell(8).numFmt = '0.00%';

    // Color margin cell
    if (m.status) {
      const fillColor = m.status === 'green' ? 'C8E6C9' : m.status === 'yellow' ? 'FFF9C4' : 'FFCDD2';
      r.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function centreHeaderRow(row: ExcelJS.Row): void {
  row.eachCell(cell => { cell.alignment = { ...cell.alignment, horizontal: 'center' }; });
}
