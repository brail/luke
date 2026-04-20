import { PassThrough } from 'stream';

import ExcelJS from 'exceljs';

export interface XlsxMeta {
  title?: string;
  subject?: string;
  author?: string;
  /** Accepted but not written to file — reserved for future use */
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
