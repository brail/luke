import type {
  Brand,
  CollectionGroup,
  CollectionLayout,
  CollectionLayoutRow,
  Season,
  Vendor,
} from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

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

// Fixed widths (pt) designed for A3 landscape — 1150pt usable. Text wraps automatically.
const PDF_COLUMNS = [
  { header: 'Foto',      width: 55  },
  { header: 'Linea',     width: 255 },
  { header: 'Gender',    width: 46  },
  { header: 'Fornitore', width: 148 },
  { header: 'Categoria', width: 118 },
  { header: 'Strategy',  width: 76  },
  { header: 'Status',    width: 80  },
  { header: 'Progress',  width: 178 },
  { header: 'SKU',       width: 48  },
  { header: 'Qty',       width: 48  },
]; // total ≈ 1052pt

const HEADER_FILL = '#E8E0D5';
const IMAGE_WIDTH  = 50;
const IMAGE_HEIGHT = 65;
const CELL_MARGIN = [3, 4, 3, 4] as [number, number, number, number];

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildCollectionLayoutPdf(
  layout: CollectionLayoutForPdf,
  prisma: PrismaClient,
): Promise<Buffer> {
  const allRows = layout.groups.flatMap(g => g.rows);

  // Fetch brand logo and row images directly from storage (no URL resolution needed)
  const uniqueRowKeys = [...new Set(allRows.map(r => r.pictureKey).filter((k): k is string => !!k))];
  const keyToDataUriMap = new Map<string, string | null>();
  const [brandLogoDataUri] = await Promise.all([
    layout.brand.logoKey
      ? readFileBuffer(prisma, 'brand-logos', layout.brand.logoKey).then(buf =>
          buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : null,
        )
      : Promise.resolve(null),
    ...uniqueRowKeys.map(key =>
      readFileBuffer(prisma, 'collection-row-pictures', key)
        .then(buf => keyToDataUriMap.set(key, buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : null)),
    ),
  ]);

  const rowImageMap = new Map<string, string | null>(
    allRows.map(row => [row.id, row.pictureKey ? (keyToDataUriMap.get(row.pictureKey) ?? null) : null]),
  );

  const headerRow: Content[] = PDF_COLUMNS.map(col => ({
    text: col.header,
    bold: true,
    fillColor: HEADER_FILL,
    fontSize: 8,
    margin: CELL_MARGIN,
  }));

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

  const nonEmptyGroups = layout.groups.filter(g => g.rows.length > 0);

  let content: Content;

  if (nonEmptyGroups.length === 0) {
    content = { text: 'Nessuna riga nel layout.', italics: true, color: '#999999' };
  } else {
    // Flat array: pageBreak on the title text so headerRows:1 works correctly
    // when a group's table spans multiple pages.
    content = nonEmptyGroups.flatMap((group, groupIndex) => {
      const tableBody: Content[][] = [headerRow];

      for (const row of group.rows) {
        const imageDataUri = rowImageMap.get(row.id) ?? null;
        const vendorLabel = row.vendor?.nickname ?? row.vendor?.name ?? '';

        const photoCell: Content = imageDataUri
          ? { image: imageDataUri, width: IMAGE_WIDTH, height: IMAGE_HEIGHT }
          : { text: '' };

        tableBody.push([
          { ...photoCell, margin: [2, 2, 2, 2] as [number, number, number, number] },
          { text: row.line,            fontSize: 8, margin: CELL_MARGIN },
          { text: row.gender ?? '',    fontSize: 8, margin: CELL_MARGIN },
          { text: vendorLabel,         fontSize: 8, margin: CELL_MARGIN },
          { text: row.productCategory, fontSize: 8, margin: CELL_MARGIN },
          { text: row.strategy ?? '',  fontSize: 8, margin: CELL_MARGIN },
          { text: row.status,          fontSize: 8, margin: CELL_MARGIN },
          { text: row.progress ?? '',  fontSize: 8, margin: CELL_MARGIN },
          { text: String(row.skuForecast), fontSize: 8, alignment: 'right' as const, margin: CELL_MARGIN },
          { text: String(row.qtyForecast), fontSize: 8, alignment: 'right' as const, margin: CELL_MARGIN },
        ]);
      }

      return [
        {
          text: group.name,
          bold: true,
          fontSize: 10,
          margin: [0, 0, 0, 4] as [number, number, number, number],
          ...(groupIndex > 0 ? { pageBreak: 'before' as const } : {}),
        } as Content,
        {
          table: {
            headerRows: 1,
            widths: PDF_COLUMNS.map(c => c.width),
            body: tableBody,
          },
          layout: tableLayout,
        } as Content,
      ];
    }) as Content;
  }

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [20, 60, 20, 30],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    header: (currentPage: number, totalPages: number) =>
      buildBrandPageHeader(
        { name: layout.brand.name, logoDataUri: brandLogoDataUri },
        { name: layout.season.name, code: layout.season.code, year: layout.season.year },
        currentPage,
        totalPages,
      ),
    content,
  };

  return createPdfBuffer(docDefinition);
}
