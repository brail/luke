import type { Content, TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';

export { Content, TDocumentDefinitions, TFontDictionary };

export const LUKE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 629.54 628.34" fill="#1a1a1a">
  <circle cx="379.54" cy="50.00" r="14.49"/>
  <circle cx="250.60" cy="51.45" r="15.10"/>
  <circle cx="378.42" cy="121.64" r="28.65"/>
  <circle cx="250.62" cy="121.80" r="28.65"/>
  <circle cx="122.32" cy="121.83" r="28.65"/>
  <circle cx="506.56" cy="122.38" r="28.65"/>
  <circle cx="385.80" cy="242.42" r="50.26"/>
  <circle cx="244.16" cy="242.67" r="50.26"/>
  <circle cx="579.54" cy="250.00" r="14.49"/>
  <circle cx="507.19" cy="250.41" r="29.60"/>
  <circle cx="51.09" cy="250.50" r="14.49"/>
  <circle cx="122.98" cy="250.83" r="29.60"/>
  <circle cx="506.63" cy="377.52" r="29.60"/>
  <circle cx="578.37" cy="377.78" r="14.49"/>
  <circle cx="122.54" cy="377.89" r="29.60"/>
  <circle cx="50.00" cy="378.34" r="14.49"/>
  <circle cx="385.78" cy="385.72" r="50.26"/>
  <circle cx="244.22" cy="385.89" r="50.26"/>
  <circle cx="123.16" cy="506.26" r="28.65"/>
  <circle cx="379.04" cy="506.85" r="28.65"/>
  <circle cx="507.31" cy="506.91" r="28.65"/>
  <circle cx="251.27" cy="507.02" r="28.65"/>
  <circle cx="378.90" cy="576.86" r="15.10"/>
  <circle cx="250.00" cy="578.34" r="14.49"/>
</svg>`;

let cachedFonts: TFontDictionary | null = null;

export function getPdfFonts(): TFontDictionary {
  if (!cachedFonts) {
    // pdfmake/build/vfs_fonts exports the VFS object directly (not pdfMake.vfs)
    // eslint-disable-next-line no-undef
    const vfs = require('pdfmake/build/vfs_fonts') as Record<string, string>;
    cachedFonts = {
      Roboto: {
        normal:      Buffer.from(vfs['Roboto-Regular.ttf']!,       'base64'),
        bold:        Buffer.from(vfs['Roboto-Medium.ttf']!,        'base64'),
        italics:     Buffer.from(vfs['Roboto-Italic.ttf']!,        'base64'),
        bolditalics: Buffer.from(vfs['Roboto-MediumItalic.ttf']!,  'base64'),
      },
    };
  }
  return cachedFonts;
}

export function buildBrandPageHeader(
  brand: { name: string; logoDataUri?: string | null },
  season: { name: string; code?: string; year?: number | null },
  currentPage: number,
  totalPages: number,
): Content {
  const seasonLabel = [season.code, season.year, season.name]
    .filter(Boolean)
    .join(' ');

  const brandLogoCol: Content = brand.logoDataUri
    ? { image: brand.logoDataUri, fit: [36, 36], alignment: 'right' as const, margin: [0, 4, 0, 0] }
    : { text: '' };

  return {
    margin: [20, 8, 20, 0] as [number, number, number, number],
    columns: [
      { svg: LUKE_LOGO_SVG, width: 36, height: 36, margin: [0, 5, 0, 0] as [number, number, number, number] },
      {
        stack: [
          { text: brand.name, bold: true, fontSize: 11 },
          { text: seasonLabel, fontSize: 9, color: '#666666' },
        ],
        alignment: 'center' as const,
        margin: [0, 8, 0, 0] as [number, number, number, number],
      },
      {
        stack: [
          brandLogoCol,
          { text: `${currentPage} / ${totalPages}`, fontSize: 8, color: '#999999', alignment: 'right' as const },
        ],
        alignment: 'right' as const,
        width: 80,
      },
    ],
  };
}

export async function createPdfBuffer(def: TDocumentDefinitions): Promise<Buffer> {
  // eslint-disable-next-line no-undef
  const PdfPrinter = require('pdfmake') as new (fonts: TFontDictionary) => {
    createPdfKitDocument(
      def: TDocumentDefinitions,
      options?: Record<string, unknown>,
    ): NodeJS.EventEmitter & { end(): void };
  };

  const printer = new PdfPrinter(getPdfFonts());
  const doc = printer.createPdfKitDocument(def);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
