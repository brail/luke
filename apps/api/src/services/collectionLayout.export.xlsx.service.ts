import ExcelJS from 'exceljs';

import type {
  PricingParameterSet,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type RowWithVendor = CollectionLayoutRow & {
  vendor: Pick<Vendor, 'id' | 'name' | 'nickname'> | null;
};

type GroupWithRows = CollectionGroup & { rows: RowWithVendor[] };

export type CollectionLayoutForExport = CollectionLayout & {
  brand:  Pick<Brand,  'name' | 'code' | 'logoKey'>;
  season: Pick<Season, 'name' | 'code' | 'year'>;
  groups: GroupWithRows[];
};

// ─── Margin computation (mirrors usePricingCalc.ts — pure math) ───────────────

function computeMarginPct(
  row: Pick<CollectionLayoutRow, 'pricingParameterSetId' | 'supplierFirstQuotation' | 'retailTargetPrice'>,
  pricingSets: PricingParameterSet[],
): number | null {
  if (!row.pricingParameterSetId || !row.supplierFirstQuotation || !row.retailTargetPrice) return null;
  if (row.supplierFirstQuotation <= 0 || row.retailTargetPrice <= 0) return null;
  const ps = pricingSets.find(p => p.id === row.pricingParameterSetId);
  if (!ps) return null;
  const qc          = row.supplierFirstQuotation * (ps.qualityControlPercent / 100);
  const withQC      = row.supplierFirstQuotation + qc + ps.tools;
  const withTransp  = withQC + ps.transportInsuranceCost;
  const withDuty    = withTransp * (1 + ps.duty / 100);
  const landed      = withDuty / ps.exchangeRate + ps.italyAccessoryCosts;
  const wholesale   = row.retailTargetPrice / ps.retailMultiplier;
  return Math.round(((wholesale - landed) / wholesale) * 10000) / 100; // %
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

const COLUMNS: { header: string; key: string; width: number }[] = [
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
  { header: 'RETAIL TARGET',   key: 'retailTargetPrice', width: 14 },
  { header: '1ª QUOTAZIONE',   key: 'supplierFirstQuotation', width: 14 },
  { header: 'MARGINE%',        key: 'margin',          width: 12 },
  { header: 'NOTE STYLE',      key: 'styleNotes',      width: 30 },
  { header: 'NOTE MATERIALE',  key: 'materialNotes',   width: 30 },
  { header: 'NOTE COLORE',     key: 'colorNotes',      width: 30 },
  { header: 'NOTE PREZZO',     key: 'priceNotes',      width: 30 },
  { header: 'NOTE TOOLING',    key: 'toolingNotes',    width: 30 },
];

// ExcelJS getCell() is 1-based; derive from column definitions to stay in sync
const colIdx = (key: string) => COLUMNS.findIndex(c => c.key === key) + 1;
const RETAIL_TARGET_COL = colIdx('retailTargetPrice');
const SUPPLIER_QUOT_COL = colIdx('supplierFirstQuotation');
const MARGIN_COL        = colIdx('margin');
const NOTE_COLS = ['styleNotes', 'materialNotes', 'colorNotes', 'priceNotes', 'toolingNotes'].map(colIdx);

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
  pricingSets: PricingParameterSet[],
  prisma: PrismaClient,
  logger?: Logger,
): Promise<Buffer> {
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
  headerRow.height = ROW_HEIGHT_WITH_IMAGE; // must come AFTER applyStreamingHeaderStyle (which sets height=20)
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };

  // Auto-filter on all header columns
  const lastColLetter = String.fromCharCode(65 + COLUMNS.length - 1);
  sheet.autoFilter = { from: 'A1', to: `${lastColLetter}1` };

  // Fetch images directly from storage by key (no URL resolution needed)
  const allRows = layout.groups.flatMap((g: GroupWithRows) => g.rows);
  const uniqueKeys = [...new Set(allRows.map(r => r.pictureKey).filter((k): k is string => !!k))];
  const keyToBuffer = new Map<string, Buffer | null>();
  await Promise.all(
    uniqueKeys.map(key => readFileBuffer(prisma, 'collection-row-pictures', key, logger).then(buf => keyToBuffer.set(key, buf))),
  );

  // Data rows
  let dataRowIndex = 1; // 0-based; row 0 is the header
  for (const group of layout.groups) {
    for (const row of group.rows) {
      const margin = computeMarginPct(row, pricingSets);
      const vendorLabel = row.vendor?.nickname ?? row.vendor?.name ?? null;

      const dataRow = sheet.addRow([
        group.name,
        '', // foto — filled by image
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
        row.retailTargetPrice,
        row.supplierFirstQuotation,
        margin,
        row.styleNotes,
        row.materialNotes,
        row.colorNotes,
        row.priceNotes,
        row.toolingNotes,
      ]);

      // Number formats
      if (row.retailTargetPrice)      dataRow.getCell(RETAIL_TARGET_COL).numFmt = '#,##0.00';
      if (row.supplierFirstQuotation) dataRow.getCell(SUPPLIER_QUOT_COL).numFmt = '#,##0.00';
      if (margin !== null)            dataRow.getCell(MARGIN_COL).numFmt        = '0.00"%"';

      const imageBuf = row.pictureKey ? keyToBuffer.get(row.pictureKey) ?? null : null;

      dataRow.height = ROW_HEIGHT_WITH_IMAGE;
      dataRow.alignment = { vertical: 'middle' };
      for (const c of NOTE_COLS) {
        dataRow.getCell(c).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      }

      if (imageBuf) {
        const ext = detectExtension(row.pictureKey!);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageId = wb.addImage({ buffer: imageBuf as any, extension: ext });
        const dims = getImageDimensions(imageBuf, row.pictureKey!);
        const fit = dims
          ? fitInBox(dims.width, dims.height, FOTO_COL_WIDTH_PX, FOTO_ROW_HEIGHT_PX, 4)
          : fitInBox(FOTO_COL_WIDTH_PX, FOTO_ROW_HEIGHT_PX, FOTO_COL_WIDTH_PX, FOTO_ROW_HEIGHT_PX, 12);
        // Fractional tl positions center the image within the cell (more reliable than nativeColOff/nativeRowOff)
        sheet.addImage(imageId, {
          tl: { col: FOTO_COL_INDEX + fit.colFrac, row: dataRowIndex + fit.rowFrac } as ExcelJS.Anchor,
          ext: { width: fit.w, height: fit.h },
        });
      }

      dataRowIndex++;
    }
  }

  // Enforce uniform row height — re-apply via getRow() to override any auto-sizing
  for (let r = 2; r <= dataRowIndex; r++) {
    sheet.getRow(r).height = ROW_HEIGHT_WITH_IMAGE;
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function detectExtension(url: string): 'jpeg' | 'png' | 'gif' {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'png';
  if (lower.includes('.gif')) return 'gif';
  return 'jpeg';
}
