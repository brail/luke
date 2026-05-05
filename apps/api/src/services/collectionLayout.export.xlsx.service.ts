import ExcelJS from 'exceljs';

import type {
  CollectionLayout,
  CollectionGroup,
  CollectionLayoutRow,
  Vendor,
  Brand,
  Season,
} from '@prisma/client';

import type { PrismaClient } from '@prisma/client';

import { applyStreamingHeaderStyle } from '../lib/export/xlsx-streaming';
import { readFileBuffer } from '../storage';
import type { QuotationWithParamSet } from './collectionLayout.service';

// ─── Types ────────────────────────────────────────────────────────────────────

type RowWithVendor = CollectionLayoutRow & {
  vendor: Pick<Vendor, 'id' | 'name' | 'nickname'> | null;
  quotations: QuotationWithParamSet[];
};

type GroupWithRows = CollectionGroup & { rows: RowWithVendor[] };

export type CollectionLayoutForExport = CollectionLayout & {
  brand:  Pick<Brand,  'name' | 'code' | 'logoKey'>;
  season: Pick<Season, 'name' | 'code' | 'year'>;
  groups: GroupWithRows[];
};

// ─── Margin computation per quotation ─────────────────────────────────────────

type QuotationMarginResult = {
  pct: number;
  status: 'green' | 'yellow' | 'red';
  fillColor: string;
};

function computeQuotationMargin(q: QuotationWithParamSet): QuotationMarginResult | null {
  if (!q.pricingParameterSet || !q.supplierQuotation || !q.retailPrice) return null;
  if (q.supplierQuotation <= 0 || q.retailPrice <= 0) return null;
  const ps = q.pricingParameterSet;
  const qc         = q.supplierQuotation * (ps.qualityControlPercent / 100);
  const withQC     = q.supplierQuotation + qc + ps.tools;
  const withTransp = withQC + ps.transportInsuranceCost;
  const withDuty   = withTransp * (1 + ps.duty / 100);
  const landed     = withDuty / ps.exchangeRate + ps.italyAccessoryCosts;
  const wholesale  = q.retailPrice / ps.retailMultiplier;
  const pct        = Math.round(((wholesale - landed) / wholesale) * 10000) / 100;
  const status: 'green' | 'yellow' | 'red' =
    pct >= ps.optimalMargin ? 'green'
    : pct >= ps.optimalMargin - 3 ? 'yellow'
    : 'red';
  const fillColor = status === 'green' ? 'C8E6C9' : status === 'yellow' ? 'FFF9C4' : 'FFCDD2';
  return { pct, status, fillColor };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FOTO_COL_INDEX = 1; // 0-based index of 'Foto' column (B)
const FOTO_COL_WIDTH_PX  = 170;
const FOTO_ROW_HEIGHT_PX = 60;
// ExcelJS column width in chars (Calibri 11): (px - 5) / 7
const FOTO_COL_CHARS = Math.round((FOTO_COL_WIDTH_PX - 5) / 7); // ≈ 24
// ExcelJS row height in points: px * 0.75
const ROW_HEIGHT_WITH_IMAGE = Math.round(FOTO_ROW_HEIGHT_PX * 0.75); // 45pt = 60px

// ─── Column definitions ───────────────────────────────────────────────────────

type ColDef = { header: string; key: string; width: number };

const BASE_COLUMNS: ColDef[] = [
  { header: 'GRUPPO',          key: 'gruppo',          width: 20 },
  { header: 'FOTO',            key: 'foto',            width: FOTO_COL_CHARS },
  { header: 'LINEA',           key: 'line',            width: 22 },
  { header: 'GENDER',          key: 'gender',          width: 12 },
  { header: 'FORNITORE',       key: 'vendor',          width: 40 },
  { header: 'CATEGORIA',       key: 'productCategory', width: 18 },
  { header: 'STRATEGY',        key: 'strategy',        width: 14 },
  { header: 'STATUS',          key: 'status',          width: 14 },
  { header: 'STYLE STATUS',    key: 'styleStatus',     width: 14 },
  { header: 'PROGRESS',        key: 'progress',        width: 28 },
  { header: 'SKU',             key: 'skuForecast',     width: 10 },
  { header: 'QTY',             key: 'qtyForecast',     width: 10 },
  { header: 'DESIGNER',        key: 'designer',        width: 16 },
  { header: 'NOTE STYLE',      key: 'styleNotes',      width: 30 },
  { header: 'NOTE MATERIALE',  key: 'materialNotes',   width: 30 },
  { header: 'NOTE COLORE',     key: 'colorNotes',      width: 30 },
  { header: 'NOTE TOOLING',    key: 'toolingNotes',    width: 30 },
];

const NOTE_KEYS = ['styleNotes', 'materialNotes', 'colorNotes', 'toolingNotes'];
// 1-based col indices within BASE_COLUMNS (before quotation cols are appended)
const BASE_NOTE_COLS = NOTE_KEYS.map(k => BASE_COLUMNS.findIndex(c => c.key === k) + 1);

function buildQuotationColumns(maxQ: number): ColDef[] {
  const cols: ColDef[] = [];
  for (let i = 1; i <= maxQ; i++) {
    cols.push(
      { header: `${i} RETAIL TARGET`, key: `q${i}_retail`,    width: 14 },
      { header: `${i} QUOTAZIONE`,    key: `q${i}_quotation`, width: 14 },
      { header: `${i} MARGINE`,       key: `q${i}_margin`,    width: 12 },
      { header: `${i} NOTE`,          key: `q${i}_notes`,     width: 24 },
    );
  }
  return cols;
}

// ─── Image helpers ────────────────────────────────────────────────────────────

function getImageDimensions(buf: Buffer, key: string): { width: number; height: number } | null {
  try {
    if (key.toLowerCase().endsWith('.png')) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG: scan for SOF marker (FF C0–CF, excluding C4/C8/CC)
    let i = 2;
    while (i + 3 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      const segLen = buf.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
  } catch { /* ignore */ }
  return null;
}

function fitInBox(imgW: number, imgH: number, boxW: number, boxH: number, padding: number) {
  const scale = Math.min((boxW - padding * 2) / imgW, (boxH - padding * 2) / imgH, 1);
  const w = Math.round(imgW * scale);
  const h = Math.round(imgH * scale);
  // Fractional col offset: pixels-based (ExcelJS uses col char-width EMU internally)
  const colFrac = Math.max(0, (boxW - w) / 2 / boxW);
  // Fractional row offset: convert px to pt (÷1.333) then normalise by row height in pt
  // rowFrac = ((rowPt - imgPt) / 2) / rowPt  where imgPt = h * 0.75, rowPt = boxH * 0.75
  const rowFrac = Math.max(0, (boxH - h) / 2 / boxH);
  return { w, h, colFrac, rowFrac };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

type Logger = { warn: (obj: object, msg: string) => void };

export async function buildCollectionLayoutXlsx(
  layout: CollectionLayoutForExport,
  prisma: PrismaClient,
  logger?: Logger,
): Promise<Buffer> {
  const allRows = layout.groups.flatMap((g: GroupWithRows) => g.rows);

  // Determine max quotations across all rows for dynamic columns
  const maxQ = allRows.reduce((m, r) => Math.max(m, r.quotations?.length ?? 0), 0);
  const quotCols = buildQuotationColumns(maxQ);
  const COLUMNS = [...BASE_COLUMNS, ...quotCols];
  const NOTE_COLS = BASE_NOTE_COLS; // indices valid since quotation cols are appended after

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Luke';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Collection Layout', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

  // Header row
  const headerRow = sheet.addRow(COLUMNS.map(c => c.header));
  applyStreamingHeaderStyle(headerRow, 'planning');
  headerRow.height = ROW_HEIGHT_WITH_IMAGE;
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };

  // Auto-filter
  const lastColLetter = columnIndexToLetter(COLUMNS.length);
  sheet.autoFilter = { from: 'A1', to: `${lastColLetter}1` };

  // Fetch images
  const uniqueKeys = [...new Set(allRows.map(r => r.pictureKey).filter((k): k is string => !!k))];
  const keyToBuffer = new Map<string, Buffer | null>();
  await Promise.all(
    uniqueKeys.map(key => readFileBuffer(prisma, 'collection-row-pictures', key, logger).then(buf => keyToBuffer.set(key, buf))),
  );

  // Data rows
  let dataRowIndex = 1;
  for (const group of layout.groups) {
    for (const row of group.rows) {
      const vendorLabel = row.vendor?.nickname ?? row.vendor?.name ?? null;

      // Base data values
      const baseValues: unknown[] = [
        group.name,
        '',
        row.line,
        row.gender,
        vendorLabel,
        row.productCategory,
        row.strategy,
        row.status,
        row.styleStatus,
        row.progress,
        row.skuForecast,
        row.qtyForecast,
        row.designer,
        row.styleNotes,
        row.materialNotes,
        row.colorNotes,
        row.toolingNotes,
      ];

      // Quotation block values (4 cells per quotation slot) + cached margin results
      const quotValues: unknown[] = [];
      const quotMargins: (QuotationMarginResult | null)[] = [];
      for (let i = 0; i < maxQ; i++) {
        const q = row.quotations?.[i];
        const marginResult = q ? computeQuotationMargin(q) : null;
        quotMargins.push(marginResult);
        quotValues.push(
          q?.retailPrice ?? null,
          q?.supplierQuotation ?? null,
          marginResult?.pct ?? null,
          q?.notes ?? null,
        );
      }

      const dataRow = sheet.addRow([...baseValues, ...quotValues]);

      dataRow.height = ROW_HEIGHT_WITH_IMAGE;
      dataRow.alignment = { vertical: 'middle' };
      for (const c of NOTE_COLS) {
        dataRow.getCell(c).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      }

      // Format and color quotation cells
      for (let i = 0; i < maxQ; i++) {
        const q = row.quotations?.[i];
        const baseOffset = BASE_COLUMNS.length + i * 4 + 1; // 1-based
        const retailCol    = baseOffset;
        const quotationCol = baseOffset + 1;
        const marginCol    = baseOffset + 2;
        if (q?.retailPrice)       dataRow.getCell(retailCol).numFmt    = '#,##0.00';
        if (q?.supplierQuotation) dataRow.getCell(quotationCol).numFmt = '#,##0.00';
        const marginResult = quotMargins[i];
        if (marginResult !== null) {
          dataRow.getCell(marginCol).numFmt = '0.00"%"';
          dataRow.getCell(marginCol).fill = {
            type: 'pattern', pattern: 'solid', fgColor: { argb: marginResult!.fillColor },
          };
        }
      }

      const imageBuf = row.pictureKey ? keyToBuffer.get(row.pictureKey) ?? null : null;
      if (imageBuf) {
        const ext = detectExtension(row.pictureKey!);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageId = wb.addImage({ buffer: imageBuf as any, extension: ext });
        const dims = getImageDimensions(imageBuf, row.pictureKey!);
        const fit = dims
          ? fitInBox(dims.width, dims.height, FOTO_COL_WIDTH_PX, FOTO_ROW_HEIGHT_PX, 4)
          : fitInBox(FOTO_COL_WIDTH_PX, FOTO_ROW_HEIGHT_PX, FOTO_COL_WIDTH_PX, FOTO_ROW_HEIGHT_PX, 12);
        sheet.addImage(imageId, {
          tl: { col: FOTO_COL_INDEX + fit.colFrac, row: dataRowIndex + fit.rowFrac } as ExcelJS.Anchor,
          ext: { width: fit.w, height: fit.h },
        });
      }

      dataRowIndex++;
    }
  }

  for (let r = 2; r <= dataRowIndex; r++) {
    sheet.getRow(r).height = ROW_HEIGHT_WITH_IMAGE;
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function columnIndexToLetter(colIndex: number): string {
  let result = '';
  let n = colIndex;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function detectExtension(url: string): 'jpeg' | 'png' | 'gif' {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'png';
  if (lower.includes('.gif')) return 'gif';
  return 'jpeg';
}
