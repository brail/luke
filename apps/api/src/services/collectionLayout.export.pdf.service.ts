import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import type {
  CollectionLayout,
  CollectionGroup,
  CollectionLayoutRow,
  Vendor,
  Brand,
  Season,
} from '@prisma/client';

import { buildBrandPageHeader, createPdfBuffer } from '../lib/export/pdf';
import { fetchImageAsBase64 } from '../lib/export/image';

// ─── Types ────────────────────────────────────────────────────────────────────

type RowWithVendor = CollectionLayoutRow & {
  vendor: Pick<Vendor, 'id' | 'name' | 'nickname'> | null;
};

type GroupWithRows = CollectionGroup & { rows: RowWithVendor[] };

export type CollectionLayoutForPdf = CollectionLayout & {
  brand:  Pick<Brand,  'name' | 'code' | 'logoUrl'>;
  season: Pick<Season, 'name' | 'code' | 'year'>;
  groups: GroupWithRows[];
};

// ─── Column definitions ───────────────────────────────────────────────────────

const PDF_COLUMNS = [
  { header: 'Foto',      width: 55 },
  { header: 'Linea',     width: '*' as const },
  { header: 'Gender',    width: 50 },
  { header: 'Fornitore', width: 80 },
  { header: 'Categoria', width: 70 },
  { header: 'Strategy',  width: 60 },
  { header: 'Status',    width: 65 },
  { header: 'Progress',  width: 100 },
  { header: 'SKU',       width: 40 },
  { header: 'Qty',       width: 40 },
];

const HEADER_FILL = '#E8E0D5';
const IMAGE_WIDTH  = 50;
const IMAGE_HEIGHT = 65;

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildCollectionLayoutPdf(
  layout: CollectionLayoutForPdf,
): Promise<Buffer> {
  // Fetch brand logo and row images concurrently
  const allRows = layout.groups.flatMap(g => g.rows);
  const imageUrls: (string | null)[] = [
    layout.brand.logoUrl ?? null,
    ...allRows.map(r => r.pictureUrl ?? null),
  ];

  const fetchedImages = await Promise.all(
    imageUrls.map(url => (url ? fetchImageAsBase64(url) : Promise.resolve(null))),
  );

  const brandLogoBase64 = fetchedImages[0];
  const rowImages = fetchedImages.slice(1);

  // Build row index map
  const rowImageMap = new Map<string, string | null>();
  allRows.forEach((row, i) => rowImageMap.set(row.id, rowImages[i]!));

  // Build table body
  const tableBody: Content[][] = [
    // Header row
    PDF_COLUMNS.map(col => ({
      text: col.header,
      bold: true,
      fillColor: HEADER_FILL,
      fontSize: 8,
      margin: [3, 4, 3, 4] as [number, number, number, number],
    })),
  ];

  for (const group of layout.groups) {
    if (group.rows.length === 0) continue;

    // Group header row (spans all columns)
    tableBody.push([
      {
        text: group.name,
        bold: true,
        colSpan: PDF_COLUMNS.length,
        fontSize: 9,
        fillColor: '#F5F0EB',
        margin: [4, 4, 4, 4] as [number, number, number, number],
      },
      ...Array(PDF_COLUMNS.length - 1).fill(''),
    ]);

    for (const row of group.rows) {
      const imageBase64 = rowImageMap.get(row.id) ?? null;
      const vendorLabel = row.vendor?.nickname ?? row.vendor?.name ?? '';

      const photoCell: Content = imageBase64
        ? { image: `data:image/jpeg;base64,${imageBase64}`, width: IMAGE_WIDTH, height: IMAGE_HEIGHT }
        : { text: '' };

      tableBody.push([
        { ...photoCell, margin: [2, 2, 2, 2] as [number, number, number, number] },
        { text: row.line,            fontSize: 8, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: row.gender ?? '',    fontSize: 8, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: vendorLabel,         fontSize: 8, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: row.productCategory, fontSize: 8, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: row.strategy ?? '',  fontSize: 8, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: row.status,          fontSize: 8, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: row.progress ?? '',  fontSize: 8, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: String(row.skuForecast), fontSize: 8, alignment: 'right' as const, margin: [3, 4, 3, 4] as [number, number, number, number] },
        { text: String(row.qtyForecast), fontSize: 8, alignment: 'right' as const, margin: [3, 4, 3, 4] as [number, number, number, number] },
      ]);
    }
  }

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [20, 60, 20, 30],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    header: (currentPage, totalPages) =>
      buildBrandPageHeader(
        { name: layout.brand.name, logoBase64: brandLogoBase64 },
        { name: layout.season.name, code: layout.season.code, year: layout.season.year },
        currentPage,
        totalPages,
      ),
    content: [
      layout.groups.length === 0
        ? ({ text: 'Nessuna riga nel layout.', italics: true, color: '#999999' } as Content)
        : ({
            table: {
              headerRows: 1,
              widths: PDF_COLUMNS.map(c => c.width),
              body: tableBody,
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => '#CCCCCC',
              vLineColor: () => '#CCCCCC',
              paddingLeft:   () => 0,
              paddingRight:  () => 0,
              paddingTop:    () => 0,
              paddingBottom: () => 0,
            },
          } as Content),
    ],
  };

  return createPdfBuffer(docDefinition);
}
