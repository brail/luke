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

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: { header: string; key: string; width: number }[] = [
  { header: 'Gruppo',          key: 'gruppo',          width: 20 },
  { header: 'Foto',            key: 'foto',            width: 10 },
  { header: 'Linea',           key: 'line',            width: 22 },
  { header: 'Gender',          key: 'gender',          width: 12 },
  { header: 'Fornitore',       key: 'vendor',          width: 20 },
  { header: 'Categoria',       key: 'productCategory', width: 18 },
  { header: 'Strategy',        key: 'strategy',        width: 14 },
  { header: 'Status',          key: 'status',          width: 14 },
  { header: 'Style Status',    key: 'styleStatus',     width: 14 },
  { header: 'Progress',        key: 'progress',        width: 28 },
  { header: 'SKU',             key: 'skuForecast',     width: 10 },
  { header: 'Qty',             key: 'qtyForecast',     width: 10 },
  { header: 'Designer',        key: 'designer',        width: 16 },
  { header: 'Retail Target',   key: 'retailTargetPrice', width: 14 },
  { header: '1ª Quotazione',   key: 'supplierFirstQuotation', width: 14 },
  { header: 'Margine%',        key: 'margin',          width: 12 },
  { header: 'Note Style',      key: 'styleNotes',      width: 30 },
  { header: 'Note Materiale',  key: 'materialNotes',   width: 30 },
  { header: 'Note Colore',     key: 'colorNotes',      width: 30 },
  { header: 'Note Prezzo',     key: 'priceNotes',      width: 30 },
  { header: 'Note Tooling',    key: 'toolingNotes',    width: 30 },
];

const FOTO_COL_INDEX = 1; // 0-based index of 'Foto' column (B)
const ROW_HEIGHT_WITH_IMAGE = 60;
const ROW_HEIGHT_DEFAULT = 18;
const IMAGE_WIDTH = 45;  // px
const IMAGE_HEIGHT = 57; // px

// ExcelJS getCell() is 1-based; derive from column definitions to stay in sync
const colIdx = (key: string) => COLUMNS.findIndex(c => c.key === key) + 1;
const RETAIL_TARGET_COL = colIdx('retailTargetPrice');
const SUPPLIER_QUOT_COL = colIdx('supplierFirstQuotation');
const MARGIN_COL        = colIdx('margin');

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildCollectionLayoutXlsx(
  layout: CollectionLayoutForExport,
  pricingSets: PricingParameterSet[],
  prisma: PrismaClient,
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

  // Auto-filter on all header columns
  const lastColLetter = String.fromCharCode(65 + COLUMNS.length - 1);
  sheet.autoFilter = { from: 'A1', to: `${lastColLetter}1` };

  // Fetch images directly from storage by key (no URL resolution needed)
  const allRows = layout.groups.flatMap((g: GroupWithRows) => g.rows);
  const uniqueKeys = [...new Set(allRows.map(r => r.pictureKey).filter((k): k is string => !!k))];
  const keyToBuffer = new Map<string, Buffer | null>();
  await Promise.all(
    uniqueKeys.map(key => readFileBuffer(prisma, 'collection-row-pictures', key).then(buf => keyToBuffer.set(key, buf))),
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

      if (imageBuf) {
        dataRow.height = ROW_HEIGHT_WITH_IMAGE;
        const ext = detectExtension(row.pictureKey!);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageId = wb.addImage({ buffer: imageBuf as any, extension: ext });
        sheet.addImage(imageId, {
          tl: { col: FOTO_COL_INDEX, row: dataRowIndex } as ExcelJS.Anchor,
          ext: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
        });
      } else {
        dataRow.height = ROW_HEIGHT_DEFAULT;
      }

      dataRowIndex++;
    }
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
