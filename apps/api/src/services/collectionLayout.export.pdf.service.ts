import type {
  Brand,
  CollectionGroup,
  CollectionLayout,
  CollectionLayoutRow,
  PricingParameterSet,
  Season,
  Vendor,
} from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import { formatDateTime } from '@luke/core';

import { buildBrandPageHeader, createPdfBuffer } from '../lib/export/pdf';
import { readFileBuffer } from '../storage';


// ─── Types ────────────────────────────────────────────────────────────────────

type RowWithVendor = CollectionLayoutRow & {
  vendor: Pick<Vendor, 'id' | 'name' | 'nickname'> | null;
};

type GroupWithRows = CollectionGroup & { rows: RowWithVendor[] };

export type CollectionLayoutForPdf = CollectionLayout & {
  brand:  Pick<Brand,  'name' | 'code' | 'logoKey'>;
  season: Pick<Season, 'name' | 'code' | 'year'>;
  groups: GroupWithRows[];
};

// ─── Column definitions ───────────────────────────────────────────────────────

// A3 landscape: 1190pt total - 40pt margins = 1150pt usable
const PAGE_USABLE_WIDTH = 1150;

const PDF_COLUMNS = [
  { header: '#',          width: 22  },
  { header: 'FOTO',       width: 55  },
  { header: 'LINEA',      width: 100 },
  { header: 'GENDER',     width: 44  },
  { header: 'FORNITORE',  width: 230 },
  { header: 'CATEGORIA',  width: 100 },
  { header: 'STRATEGY',   width: 70  },
  { header: 'STATUS',     width: 72  },
  { header: 'PROGRESS',   width: 168 },
  { header: 'SKU',        width: 44  },
  { header: 'QTY',        width: 44  },
  { header: 'MARGINE',    width: 62  },
]; // total = 989pt

const TABLE_WIDTH      = PDF_COLUMNS.reduce((s, c) => s + c.width, 0);
const TABLE_MARGIN_H   = Math.floor((PAGE_USABLE_WIDTH - TABLE_WIDTH) / 2);
const NUM_COLS         = PDF_COLUMNS.length;
const MARGINE_COL_IDX  = PDF_COLUMNS.findIndex(c => c.header === 'MARGINE'); // 10
const SKU_COL_IDX      = PDF_COLUMNS.findIndex(c => c.header === 'SKU');     // 8
const QTY_COL_IDX      = PDF_COLUMNS.findIndex(c => c.header === 'QTY');     // 9

// ─── Row heights ─────────────────────────────────────────────────────────────

const PDF_GROUP_HEADER_ROW_HEIGHT = 22;
const PDF_HEADER_ROW_HEIGHT       = 18;
const PDF_DATA_ROW_HEIGHT         = 50;
const PDF_SUBTOTAL_ROW_HEIGHT     = 16;

// ─── Colours ──────────────────────────────────────────────────────────────────

const HEADER_FILL       = '#E8E0D5';
const GROUP_HEADER_FILL = '#C8BFB3';
const SUBTOTAL_FILL     = '#F2EDE8';
const TOTAL_FILL        = '#C8BFB3';
const MARGIN_COLOR_GOOD = '#15803D';
const MARGIN_COLOR_WARN = '#D97706';
const MARGIN_COLOR_BAD  = '#B91C1C';
const MARGIN_FILL_GOOD  = '#DCFCE7';
const MARGIN_FILL_WARN  = '#FEF3C7';
const MARGIN_FILL_BAD   = '#FEE2E2';

// ─── Cell margin helpers ──────────────────────────────────────────────────────

// Vertical center text in data row: (50 - ~10pt line) / 2 = 20
const CELL_MARGIN        = [3, 20, 3, 20] as [number, number, number, number];
const HEADER_CELL_MARGIN = [3, 4,  3, 4 ] as [number, number, number, number];
// Group-header vertical center: (22 - 10) / 2 = 6
const GROUP_HDR_MARGIN   = [6, 6,  3, 6 ] as [number, number, number, number];
// Subtotal text center: (16 - 10) / 2 = 3
const SUBTOTAL_MARGIN    = [3, 3,  3, 3 ] as [number, number, number, number];

// Shoe images are typically landscape ~2.5:1. At width 44, rendered height ≈ 18pt.
// IMAGE_HEIGHT caps the fit box at ~actual height; PHOTO_MARGIN fills the 50pt row:
// 15 + 20 + 15 = 50pt → image center ≈ 15 + 10 = 25pt = row center.
const PHOTO_MARGIN = [2, 15, 2, 15] as [number, number, number, number];

const IMAGE_WIDTH  = 44;
const IMAGE_HEIGHT = 20;

// ─── Margin computation (mirrors usePricingCalc.ts) ──────────────────────────

function computeMarginResult(
  row: Pick<CollectionLayoutRow, 'pricingParameterSetId' | 'supplierFirstQuotation' | 'retailTargetPrice'>,
  pricingSetMap: Map<string, PricingParameterSet>,
): { pct: number; isAboveTarget: boolean; isWarning: boolean } | null {
  if (!row.pricingParameterSetId || !row.supplierFirstQuotation || !row.retailTargetPrice) return null;
  if (row.supplierFirstQuotation <= 0 || row.retailTargetPrice <= 0) return null;
  const ps = pricingSetMap.get(row.pricingParameterSetId);
  if (!ps) return null;
  const qc         = row.supplierFirstQuotation * (ps.qualityControlPercent / 100);
  const withQC     = row.supplierFirstQuotation + qc + ps.tools;
  const withTransp = withQC + ps.transportInsuranceCost;
  const withDuty   = withTransp * (1 + ps.duty / 100);
  const landed     = withDuty / ps.exchangeRate + ps.italyAccessoryCosts;
  const wholesale  = row.retailTargetPrice / ps.retailMultiplier;
  const margin     = (wholesale - landed) / wholesale;
  const marginPct = margin * 100;
  return {
    pct: Math.round(margin * 10000) / 100,
    isAboveTarget: marginPct >= ps.optimalMargin,
    isWarning: marginPct < ps.optimalMargin && marginPct >= ps.optimalMargin - 3,
  };
}

// ─── Image helpers ────────────────────────────────────────────────────────────

/** Returns a data URI string, or null for unsupported types (e.g. WebP). */
function toDataUri(buf: Buffer, key: string): string | null {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return `data:image/png;base64,${buf.toString('base64')}`;
  if (lower.endsWith('.webp')) return null;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// ─── Table layout ─────────────────────────────────────────────────────────────

const tableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#CCCCCC',
  vLineColor: () => '#CCCCCC',
  paddingLeft:   () => 0,
  paddingRight:  () => 0,
  paddingTop:    () => 0,
  paddingBottom: () => 0,
};

// ─── Cell builders ────────────────────────────────────────────────────────────

function emptyRow(n: number): Content[] {
  return Array.from({ length: n }, () => ({ text: '' } as Content));
}

function buildColumnHeaderRow(): Content[] {
  return PDF_COLUMNS.map(col => ({
    text: col.header,
    bold: true,
    fillColor: HEADER_FILL,
    fontSize: 7,
    alignment: 'center' as const,
    margin: HEADER_CELL_MARGIN,
  }));
}

function buildGroupNameRow(name: string): Content[] {
  return [
    {
      text: name,
      bold: true,
      fontSize: 9,
      fillColor: GROUP_HEADER_FILL,
      colSpan: NUM_COLS,
      margin: GROUP_HDR_MARGIN,
    } as Content,
    ...emptyRow(NUM_COLS - 1),
  ];
}

function buildSummaryRow(label: string, skuSum: number, qtySum: number, fill: string): Content[] {
  const cells: Content[] = emptyRow(NUM_COLS);

  // pdfmake requires colSpan cells followed by empty placeholder cells
  cells[0] = {
    text: label,
    bold: true,
    fontSize: 7,
    fillColor: fill,
    colSpan: SKU_COL_IDX,
    alignment: 'right' as const,
    margin: SUBTOTAL_MARGIN,
  } as Content;

  for (let i = 1; i < SKU_COL_IDX; i++) {
    cells[i] = { text: '', fillColor: fill } as Content;
  }

  cells[SKU_COL_IDX] = {
    text: String(skuSum),
    bold: true,
    fontSize: 7,
    fillColor: fill,
    alignment: 'right' as const,
    margin: SUBTOTAL_MARGIN,
  } as Content;

  cells[QTY_COL_IDX] = {
    text: String(qtySum),
    bold: true,
    fontSize: 7,
    fillColor: fill,
    alignment: 'right' as const,
    margin: SUBTOTAL_MARGIN,
  } as Content;

  cells[MARGINE_COL_IDX] = { text: '', fillColor: fill } as Content;

  return cells;
}

// ─── Heights callback ─────────────────────────────────────────────────────────

// i=0 → group name row, i=1 → column header row, last row → subtotal, rest → data
function makeHeightsFn(dataCount: number): (i: number) => number {
  const subtotalIdx = 2 + dataCount; // row index of the subtotal
  return (i: number) => {
    if (i === 0) return PDF_GROUP_HEADER_ROW_HEIGHT;
    if (i === 1) return PDF_HEADER_ROW_HEIGHT;
    if (i === subtotalIdx) return PDF_SUBTOTAL_ROW_HEIGHT;
    return PDF_DATA_ROW_HEIGHT;
  };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

type Logger = { warn: (obj: object, msg: string) => void };

export async function buildCollectionLayoutPdf(
  layout: CollectionLayoutForPdf,
  pricingSets: PricingParameterSet[],
  prisma: PrismaClient,
  extractedBy: string,
  extractedAt: Date,
  logger?: Logger,
): Promise<Buffer> {
  const allRows = layout.groups.flatMap(g => g.rows);

  const uniqueRowKeys = [...new Set(allRows.map(r => r.pictureKey).filter((k): k is string => !!k))];
  const keyToDataUriMap = new Map<string, string | null>();
  const [brandLogoDataUri] = await Promise.all([
    layout.brand.logoKey
      ? readFileBuffer(prisma, 'brand-logos', layout.brand.logoKey, logger).then(buf =>
          buf ? toDataUri(buf, layout.brand.logoKey!) : null,
        )
      : Promise.resolve(null),
    ...uniqueRowKeys.map(key =>
      readFileBuffer(prisma, 'collection-row-pictures', key, logger)
        .then(buf => keyToDataUriMap.set(key, buf ? toDataUri(buf, key) : null)),
    ),
  ]);

  const rowImageMap = new Map<string, string | null>(
    allRows.map(row => [row.id, row.pictureKey ? (keyToDataUriMap.get(row.pictureKey) ?? null) : null]),
  );

  const pricingSetMap = new Map(pricingSets.map(ps => [ps.id, ps]));
  const nonEmptyGroups = layout.groups.filter(g => g.rows.length > 0);

  let content: Content;
  let grandSkuSum = 0;
  let grandQtySum = 0;
  let rowNumber   = 0;

  if (nonEmptyGroups.length === 0) {
    content = { text: 'Nessuna riga nel layout.', italics: true, color: '#999999' };
  } else {
    const blocks: Content[] = [];

    nonEmptyGroups.forEach((group, groupIndex) => {
      const tableBody: Content[][] = [
        buildGroupNameRow(group.name),
        buildColumnHeaderRow(),
      ];

      let groupSkuSum = 0;
      let groupQtySum = 0;
      rowNumber = 0; // reset per group

      for (const row of group.rows) {
        const imageDataUri = rowImageMap.get(row.id) ?? null;
        const vendorLabel  = row.vendor?.nickname ?? row.vendor?.name ?? '';
        const marginResult = computeMarginResult(row, pricingSetMap);

        const photoCell: Content = imageDataUri
          ? { image: imageDataUri, fit: [IMAGE_WIDTH, IMAGE_HEIGHT], alignment: 'center' }
          : { text: '' };

        const marginCell: Content = marginResult
          ? {
              text: `${marginResult.pct.toFixed(2)}%`,
              fontSize: 7,
              bold: true,
              color: marginResult.isAboveTarget ? MARGIN_COLOR_GOOD : marginResult.isWarning ? MARGIN_COLOR_WARN : MARGIN_COLOR_BAD,
              fillColor: marginResult.isAboveTarget ? MARGIN_FILL_GOOD : marginResult.isWarning ? MARGIN_FILL_WARN : MARGIN_FILL_BAD,
              alignment: 'center' as const,
              margin: CELL_MARGIN,
            }
          : { text: '', margin: CELL_MARGIN };

        groupSkuSum += row.skuForecast ?? 0;
        groupQtySum += row.qtyForecast ?? 0;
        rowNumber++;

        tableBody.push([
          { text: String(rowNumber), fontSize: 7, alignment: 'center' as const, margin: CELL_MARGIN },
          { ...photoCell, margin: PHOTO_MARGIN },
          { text: row.line ?? '',            fontSize: 7, margin: CELL_MARGIN },
          { text: row.gender ?? '',           fontSize: 7, margin: CELL_MARGIN, alignment: 'center' as const },
          { text: vendorLabel,                fontSize: 7, margin: CELL_MARGIN },
          { text: row.productCategory ?? '',  fontSize: 7, margin: CELL_MARGIN },
          { text: row.strategy ?? '',         fontSize: 7, margin: CELL_MARGIN, alignment: 'center' as const },
          { text: row.status ?? '',           fontSize: 7, margin: CELL_MARGIN, alignment: 'center' as const },
          { text: row.progress ?? '',         fontSize: 7, margin: CELL_MARGIN },
          { text: String(row.skuForecast ?? ''), fontSize: 7, alignment: 'right' as const, margin: CELL_MARGIN },
          { text: String(row.qtyForecast ?? ''), fontSize: 7, alignment: 'right' as const, margin: CELL_MARGIN },
          marginCell,
        ]);
      }

      grandSkuSum += groupSkuSum;
      grandQtySum += groupQtySum;

      tableBody.push(buildSummaryRow(`Subtotale ${group.name}`, groupSkuSum, groupQtySum, SUBTOTAL_FILL));

      // Separate page-break element avoids pdfmake bug where pageBreak on a table
      // with headerRows > 1 causes a phantom blank row after the repeated headers.
      if (groupIndex > 0) {
        blocks.push({ text: '', pageBreak: 'before' } as Content);
      }
      blocks.push({
        margin: [TABLE_MARGIN_H, 0, TABLE_MARGIN_H, 8] as [number, number, number, number],
        table: {
          headerRows: 2,
          dontBreakRows: true,
          widths: PDF_COLUMNS.map(c => c.width),
          heights: makeHeightsFn(group.rows.length),
          body: tableBody,
        },
        layout: tableLayout,
      } as Content);
    });

    // Grand total table (appended after last group)
    const totalBody: Content[][] = [buildSummaryRow('TOTALE', grandSkuSum, grandQtySum, TOTAL_FILL)];
    blocks.push({
      margin: [TABLE_MARGIN_H, 0, TABLE_MARGIN_H, 0] as [number, number, number, number],
      table: {
        headerRows: 0,
        widths: PDF_COLUMNS.map(c => c.width),
        heights: () => PDF_SUBTOTAL_ROW_HEIGHT,
        body: totalBody,
      },
      layout: tableLayout,
    } as Content);

    content = blocks;
  }

  const subtitle      = `Collection Layout — ${[layout.season.code, layout.season.name].filter(Boolean).join(' ')}`;
  const extractedInfo = `${extractedBy} — ${formatDateTime(extractedAt)}`;

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [20, 68, 20, 30],
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    header: (currentPage: number, totalPages: number) =>
      buildBrandPageHeader(
        { name: layout.brand.name, logoDataUri: brandLogoDataUri },
        currentPage,
        totalPages,
        { showPageNumber: false, subtitle, extractedInfo },
      ),
    footer: (_currentPage: number, _totalPages: number): Content => ({
      text: `${_currentPage} / ${_totalPages}`,
      alignment: 'right',
      margin: [0, 8, 20, 0],
      fontSize: 8,
      color: '#999999',
    }),
    content,
  };

  return createPdfBuffer(docDefinition);
}
