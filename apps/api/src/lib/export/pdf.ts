import {
  CompanyAddressSchema,
  CompanyExportSettingsSchema,
  type CompanyAddress,
  type CompanyExportSettings,
} from '@luke/core';

import { readFileBuffer } from '../../storage/index.js';

import type { PrismaClient } from '@prisma/client';
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

/**
 * Returns the pdfmake font dictionary loaded from the bundled VFS.
 * The result is cached after the first call.
 */
export function getPdfFonts(): TFontDictionary {
  if (!cachedFonts) {
    // pdfmake/build/vfs_fonts exports the VFS object directly (not pdfMake.vfs)
     
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

/**
 * Builds a pdfmake header block for a branded document page.
 * Displays the Luke logo on the left, brand name + optional subtitle in the centre,
 * and the brand logo + optional page number on the right.
 *
 * @param brand - Brand display data.
 * @param currentPage - Current page number (provided by pdfmake's header callback).
 * @param totalPages - Total page count (provided by pdfmake's header callback).
 * @param opts - Optional rendering controls (subtitle, extractedInfo, showPageNumber).
 * @returns pdfmake `Content` object for use in `header`.
 */
export function buildBrandPageHeader(
  brand: { name: string; logoDataUri?: string | null },
  currentPage: number,
  totalPages: number,
  opts?: { showPageNumber?: boolean; subtitle?: string; extractedInfo?: string },
): Content {
  const { showPageNumber = true, subtitle, extractedInfo } = opts ?? {};

  const brandLogoCol: Content = brand.logoDataUri
    ? { image: brand.logoDataUri, fit: [36, 36], alignment: 'right' as const, margin: [0, 4, 0, 0] }
    : { text: '' };

  const centerStack: Content[] = [
    { text: brand.name, bold: true, fontSize: 11 },
  ];
  if (subtitle)       centerStack.push({ text: subtitle,       fontSize: 8, color: '#444444' } as Content);
  if (extractedInfo)  centerStack.push({ text: extractedInfo,  fontSize: 7, color: '#888888' } as Content);

  const rightStack: Content[] = [brandLogoCol];
  if (showPageNumber) {
    rightStack.push({ text: `${currentPage} / ${totalPages}`, fontSize: 8, color: '#999999', alignment: 'right' as const });
  }

  return {
    margin: [20, 8, 20, 0] as [number, number, number, number],
    columns: [
      { svg: LUKE_LOGO_SVG, width: 36, height: 36, margin: [0, 5, 0, 0] as [number, number, number, number] },
      {
        stack: centerStack,
        alignment: 'center' as const,
        margin: [0, 6, 0, 0] as [number, number, number, number],
      },
      {
        stack: rightStack,
        alignment: 'right' as const,
        width: 80,
      },
    ],
  };
}

function formatAddress(address: CompanyAddress | null | undefined): string {
  if (!address) return '';
  const parts: string[] = [];
  if (address.street) parts.push(address.street);
  const cityParts: string[] = [];
  if (address.zip) cityParts.push(address.zip);
  if (address.city) cityParts.push(address.city);
  if (address.province) cityParts.push(`(${address.province})`);
  if (cityParts.length) parts.push(cityParts.join(' '));
  if (address.countryCode && address.countryCode !== 'IT') parts.push(address.countryCode);
  return parts.join(', ');
}

/**
 * Builds a pdfmake footer block with optional company branding.
 * Shows the company logo and address on the left and the page number on the right.
 *
 * @param currentPage - Current page number (provided by pdfmake's footer callback).
 * @param totalPages - Total page count.
 * @param company - Optional company context (logo data URI, address, footer text).
 * @returns pdfmake `Content` object for use in `footer`.
 */
export function buildPdfFooter(
  currentPage: number,
  totalPages: number,
  company?: {
    logoDataUri?: string | null;
    address?: CompanyAddress | null;
    footerText?: string | null;
  },
): Content {
  const addressLine = formatAddress(company?.address);
  const infoLines: string[] = [];
  if (addressLine)         infoLines.push(addressLine);
  if (company?.footerText) infoLines.push(company.footerText);

  // pdfmake column objects support a `width` key that the Content type doesn't declare — cast needed

   
  const columns: any[] = [];

  if (company?.logoDataUri) {
     
    columns.push({ image: company.logoDataUri, fit: [48, 48], width: 'auto', margin: [0, 2, 8, 0] } as any);
  }

  columns.push({
    stack: infoLines.map(line => ({ text: line, fontSize: 6.5, color: '#555555' })),
    margin: [0, 2, 0, 0],
  });

  columns.push({
    text: `${currentPage} / ${totalPages}`,
    fontSize: 7,
    color: '#999999',
    alignment: 'right',
    width: 40,
    margin: [0, 2, 0, 0],
  });

  return {
    margin: [20, 6, 20, 0] as [number, number, number, number],
    columns,
  } as Content;
}

/**
 * Company branding and settings assembled for PDF export.
 */
export type CompanyExportContext = {
  companyLogoDataUri: string | null;
  exportSettings: CompanyExportSettings;
  address: CompanyAddress | null;
};

/**
 * Loads the company profile, logo, and export settings from the database.
 * Returns a safe empty context on any error so PDF generation can proceed without branding.
 *
 * @param prisma - Prisma client.
 * @param logger - Optional logger for non-fatal warnings.
 * @returns Populated `CompanyExportContext`, or a zeroed-out default on failure.
 */
export async function fetchCompanyExportContext(
  prisma: PrismaClient,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<CompanyExportContext> {
  const EMPTY: CompanyExportContext = {
    companyLogoDataUri: null,
    exportSettings: {},
    address: null,
  };
  try {
    const profile = await prisma.companyProfile.findUnique({ where: { id: 'singleton' } });
    if (!profile) return EMPTY;

    const exportSettings = CompanyExportSettingsSchema.parse(profile.exportSettings ?? {});
    const address = profile.address
      ? CompanyAddressSchema.parse(profile.address)
      : null;

    let companyLogoDataUri: string | null = null;
    if (profile.logoKey) {
      const buf = await readFileBuffer(prisma, 'company-assets', profile.logoKey, logger);
      if (buf) {
        const key = profile.logoKey.toLowerCase();
        if (key.endsWith('.png'))        companyLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
        else if (!key.endsWith('.webp')) companyLogoDataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
    }

    return { companyLogoDataUri, exportSettings, address };
  } catch {
    logger?.warn({}, 'fetchCompanyExportContext failed, using defaults');
    return EMPTY;
  }
}

/**
 * Renders a pdfmake document definition to a `Buffer` containing the PDF binary.
 *
 * @param def - pdfmake `TDocumentDefinitions` object.
 * @returns Buffer with the complete PDF content.
 */
export async function createPdfBuffer(def: TDocumentDefinitions): Promise<Buffer> {
   
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
