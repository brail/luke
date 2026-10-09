import { PassThrough, type Writable } from 'stream';
import { buffer } from 'stream/consumers';

import ExcelJS from 'exceljs';

/**
 * Document metadata for generated XLSX files.
 */
export interface XlsxMeta {
  title?: string;
  subject?: string;
  author?: string;
  /** Accepted but not written to the file — reserved for future use. */
  manager?: string;
}

/**
 * Predefined header row style variants for streamed XLSX exports.
 */
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

/**
 * Creates a streaming ExcelJS workbook that writes into `stream` as rows are committed, carrying
 * the document metadata every export sets.
 *
 * @param stream - Destination of the XLSX bytes (a response, or a PassThrough to collect them).
 * @param meta - Document metadata applied to the workbook properties.
 */
export function createStreamingWorkbook(stream: Writable, meta: XlsxMeta): ExcelJS.stream.xlsx.WorkbookWriter {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: false,
  });

  wb.creator        = meta.author  ?? 'Luke';
  wb.lastModifiedBy = meta.author  ?? 'Luke';
  wb.title          = meta.title   ?? '';
  wb.subject        = meta.subject ?? '';
  wb.created        = new Date();
  wb.modified       = new Date();

  return wb;
}

/**
 * Creates a streaming workbook whose bytes are collected in memory.
 *
 * @param meta - Document metadata applied to the workbook properties.
 * @returns `wb` — the workbook writer to add sheets to;
 *   `bufferPromise` — resolves with the complete XLSX buffer after `wb.commit()`.
 */
export function createStreamingBuffer(meta: XlsxMeta): {
  wb: ExcelJS.stream.xlsx.WorkbookWriter;
  bufferPromise: Promise<Buffer>;
} {
  const pass = new PassThrough();
  return { wb: createStreamingWorkbook(pass, meta), bufferPromise: buffer(pass) };
}

/**
 * Returns a compact timestamp string formatted as `YYYYMMdd-HHmm`, on the wall clock in `timeZone`
 * (the requester's, `getUserTimeZone`). Suitable for embedding in export filenames.
 */
export function exportTimestamp(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}`;
}

/**
 * Applies a predefined style variant to a header row in a streaming workbook.
 *
 * @param row - ExcelJS row object to style (must already be added to the sheet).
 * @param variant - One of the keys defined in `XLSX_HEADER_STYLES`.
 */
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
