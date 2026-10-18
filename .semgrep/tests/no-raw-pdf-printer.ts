// ok: luke-no-raw-pdf-printer
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
// ruleid: luke-no-raw-pdf-printer
import PdfPrinter from 'pdfmake/js/Printer';

declare function createPdfBuffer(def: TDocumentDefinitions): Promise<Buffer>;

export function viaRequire() {
  // ruleid: luke-no-raw-pdf-printer
  const pdfMake = require('pdfmake');
  return pdfMake;
}

export function viaSingleton(pdfMake: { createPdf(def: TDocumentDefinitions): unknown }, def: TDocumentDefinitions) {
  // ruleid: luke-no-raw-pdf-printer
  return pdfMake.createPdf(def);
}

export async function viaHelper(def: TDocumentDefinitions) {
  // ok: luke-no-raw-pdf-printer
  return createPdfBuffer(def);
}

export { PdfPrinter };
