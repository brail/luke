import { PassThrough } from 'stream';

import ExcelJS from 'exceljs';

export interface XlsxMeta {
  title?: string;
  subject?: string;
  author?: string;
  manager?: string;
}

export const XLSX_HEADER_STYLES = {
  report: {
    fill: { argb: 'FF1F4E79' } as ExcelJS.Color,
    fontColor: { argb: 'FFFFFFFF' } as ExcelJS.Color,
  },
  planning: {
    fill: { argb: 'FFE8E0D5' } as ExcelJS.Color,
    fontColor: { argb: 'FF1A1A1A' } as ExcelJS.Color,
  },
} as const;

export function createStreamingBuffer(meta: XlsxMeta): {
  wb: ExcelJS.stream.xlsx.WorkbookWriter;
  bufferPromise: Promise<Buffer>;
} {
  const pass = new PassThrough();

  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pass.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);
  });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: pass,
    useStyles: true,
    useSharedStrings: false,
  });

  wb.creator        = meta.author  ?? 'Luke';
  wb.lastModifiedBy = meta.author  ?? 'Luke';
  wb.title          = meta.title   ?? '';
  wb.subject        = meta.subject ?? '';
  wb.created        = new Date();
  wb.modified       = new Date();

  const company = meta.manager ?? '';
  (wb as unknown as { addApp(): Promise<void> }).addApp = () =>
    new Promise<void>(resolve => {
      const sheetNames = (wb as unknown as { _worksheets: ({ name: string } | undefined)[] })
        ._worksheets.filter(Boolean).map(ws => ws!.name);
      const pairs = sheetNames.length;
      const titlesXml = sheetNames.map(n => `<vt:lpstr>${n}</vt:lpstr>`).join('');
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
        `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
        `<Application>Microsoft Excel</Application>` +
        `<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>` +
        `<HeadingPairs><vt:vector size="2" baseType="variant">` +
        `<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>` +
        `<vt:variant><vt:i4>${pairs}</vt:i4></vt:variant>` +
        `</vt:vector></HeadingPairs>` +
        `<TitlesOfParts><vt:vector size="${pairs}" baseType="lpstr">${titlesXml}</vt:vector></TitlesOfParts>` +
        `<Company></Company>` +
        `<Manager>${company}</Manager>` +
        `<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>` +
        `<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>` +
        `</Properties>`;
      (wb as unknown as { zip: { append(xml: string, opts: { name: string }): void } })
        .zip.append(xml, { name: 'docProps/app.xml' });
      resolve();
    });

  return { wb, bufferPromise };
}

export function applyStreamingHeaderStyle(
  row: ExcelJS.Row,
  variant: keyof typeof XLSX_HEADER_STYLES,
): void {
  const style = XLSX_HEADER_STYLES[variant];
  row.font = { bold: true, color: style.fontColor, size: 10, name: 'Calibri' };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: style.fill } as ExcelJS.Fill;
  row.alignment = { vertical: 'middle', wrapText: false };
  row.height = 20;
}
