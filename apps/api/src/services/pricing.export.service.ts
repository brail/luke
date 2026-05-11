import type { PrismaClient, PricingParameterSet } from '@prisma/client';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import { calcMaxSupplierCost, calculateCompanyMultiplier, generateRetailPriceRange } from '@luke/core';

import { buildBrandPageHeader, createPdfBuffer } from '../lib/export/pdf';
import { applyStreamingHeaderStyle, createStreamingBuffer } from '../lib/export/xlsx-streaming';
import { readFileBuffer } from '../storage';

type Brand = { name: string; code: string; logoKey?: string | null };
type Season = { code: string; year: number | null };

function toDataUri(buf: Buffer, key: string): string | null {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return `data:image/png;base64,${buf.toString('base64')}`;
  if (lower.endsWith('.webp')) return null;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function fmt2(n: number) { return n.toFixed(2); }
function fmt1(n: number) { return n.toFixed(1); }

function commonValue<K extends keyof PricingParameterSet>(
  sets: PricingParameterSet[],
  key: K,
): PricingParameterSet[K] | null {
  if (sets.length === 0) return null;
  const first = sets[0][key];
  return sets.every(s => s[key] === first) ? first : null;
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

export async function buildPricingGridXlsx(
  sets: PricingParameterSet[],
  brand: Brand,
  season: Season,
): Promise<Buffer> {
  const retailPrices = generateRetailPriceRange();
  const title = `${brand.name} — ${season.code} ${season.year ?? ""} — Griglia Prezzi`;

  const { wb, bufferPromise } = createStreamingBuffer({ title, author: 'Luke' });
  const ws = wb.addWorksheet('Griglia Prezzi');

  // Column widths
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 14;
  for (let i = 0; i < sets.length; i++) {
    ws.getColumn(3 + i).width = 16;
  }

  // Title row
  const titleRow = ws.addRow([title]);
  titleRow.font = { bold: true, size: 12, name: 'Calibri' };
  titleRow.height = 20;
  await titleRow.commit();

  // Parameters section
  const paramLabels: string[] = [
    'Margine target',
    'Tasso di cambio',
    'Moltiplicatore retail',
    'Trasporto + assicurazione',
    'Costi accessori Italia',
    'Stampi',
    'Moltiplicatore aziendale',
  ];
  const paramKeys = [
    'optimalMargin', 'exchangeRate', 'retailMultiplier',
    'transportInsuranceCost', 'italyAccessoryCosts', 'tools',
  ] as const;

  const blankRow = ws.addRow([]);
  await blankRow.commit();

  for (let i = 0; i < paramLabels.length; i++) {
    const label = paramLabels[i];
    const key = paramKeys[i];

    if (key === undefined) {
      const cm = commonValue(sets, 'optimalMargin');
      const row = ws.addRow([label, cm !== null ? `×${fmt2(calculateCompanyMultiplier(cm))}` : '(varia per variante)']);
      row.getCell(1).font = { italic: true, size: 9, name: 'Calibri', color: { argb: 'FF888888' } };
      row.getCell(2).font = { size: 9, name: 'Calibri', color: { argb: 'FF888888' } };
      await row.commit();
      continue;
    }

    const val = commonValue(sets, key);
    let valStr: string;
    if (val === null) {
      valStr = '(varia per variante — vedi colonne)';
    } else if (key === 'optimalMargin') {
      valStr = `${val}%`;
    } else if (key === 'retailMultiplier') {
      valStr = `×${fmt2(val as number)}`;
    } else {
      valStr = fmt2(val as number);
    }

    const row = ws.addRow([label, valStr]);
    row.getCell(1).font = { italic: true, size: 9, name: 'Calibri', color: { argb: 'FF888888' } };
    row.getCell(2).font = { size: 9, name: 'Calibri', color: { argb: 'FF888888' } };
    await row.commit();
  }

  const blankRow2 = ws.addRow([]);
  await blankRow2.commit();

  // Grid header
  const headerValues = [
    'IT Retail', 'IT Wholesale',
    ...sets.map(s => `${s.name}${s.countryCode ? ` (${s.countryCode})` : ''} — Dazio ${s.duty}%`),
  ];
  const headerRow = ws.addRow(headerValues);
  applyStreamingHeaderStyle(headerRow, 'report');
  await headerRow.commit();

  // Grid data
  const refSet = sets[0];
  for (const retail of retailPrices) {
    const wholesale = retail / refSet.retailMultiplier;
    const rowVals: (number | string)[] = [retail, Math.round(wholesale * 10) / 10];
    for (const set of sets) {
      const fob = calcMaxSupplierCost(retail, set);
      rowVals.push(fob > 0 ? fob : '');
    }
    const dataRow = ws.addRow(rowVals);
    dataRow.font = { size: 9, name: 'Calibri' };
    // Bold retail column
    dataRow.getCell(1).font = { size: 9, name: 'Calibri', bold: true };
    await dataRow.commit();
  }

  await wb.commit();
  return bufferPromise;
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function buildPricingGridPdf(
  sets: PricingParameterSet[],
  brand: Brand,
  season: Season,
  prisma: PrismaClient,
  extractedBy: string,
  extractedAt: Date,
): Promise<Buffer> {
  const retailPrices = generateRetailPriceRange();
  const refSet = sets[0];

  // Load brand logo
  const logoDataUri = brand.logoKey
    ? await readFileBuffer(prisma, 'brand-logos', brand.logoKey).then(buf =>
        buf ? toDataUri(buf, brand.logoKey!) : null,
      ).catch(() => null)
    : null;

  const subtitle = `${season.code} ${season.year ?? ''} — Griglia Prezzi`;
  const extractedInfo = `Estratto da ${extractedBy} il ${extractedAt.toLocaleDateString('it-IT')}`;

  // Parameters section
  const paramRows: Content[] = [];
  const paramDefs: Array<{ label: string; value: (sets: PricingParameterSet[]) => string }> = [
    { label: 'Margine target',             value: s => { const v = commonValue(s, 'optimalMargin');            return v !== null ? `${v}%` : '(varia)'; } },
    { label: 'Tasso di cambio',            value: s => { const v = commonValue(s, 'exchangeRate');             return v !== null ? String(v) : '(varia)'; } },
    { label: 'Moltiplicatore retail',      value: s => { const v = commonValue(s, 'retailMultiplier');         return v !== null ? `×${fmt2(v)}` : '(varia)'; } },
    { label: 'Moltiplicatore aziendale',   value: s => { const v = commonValue(s, 'optimalMargin');            return v !== null ? `×${fmt2(calculateCompanyMultiplier(v))}` : '(varia)'; } },
    { label: 'Trasporto + assicurazione',  value: s => { const v = commonValue(s, 'transportInsuranceCost');   return v !== null ? `${fmt2(v)} ${s[0].purchaseCurrency}` : '(varia)'; } },
    { label: 'Costi accessori Italia',     value: s => { const v = commonValue(s, 'italyAccessoryCosts');      return v !== null ? `${fmt2(v)} ${s[0].sellingCurrency}` : '(varia)'; } },
    { label: 'Stampi',                     value: s => { const v = commonValue(s, 'tools');                    return v !== null ? `${fmt2(v)} ${s[0].purchaseCurrency}` : '(varia)'; } },
  ];

  for (const def of paramDefs) {
    paramRows.push({
      columns: [
        { text: def.label, width: 140, fontSize: 8, color: '#666666' },
        { text: def.value(sets), fontSize: 8, bold: true },
      ],
      margin: [0, 1, 0, 1] as [number, number, number, number],
    } as Content);
  }

  // Grid table
  const headerStyle = { bold: true, fontSize: 7, color: '#ffffff', fillColor: '#1F4E79' };
  const colHeaders: Content[] = [
    { text: 'IT Retail', style: 'gridHeader' },
    { text: 'IT Wholesale', style: 'gridHeader' },
    ...sets.map(s => ({ text: `${s.name}\n${s.countryCode ?? ''} Dazio ${s.duty}%`, style: 'gridHeader' } as Content)),
  ];

  const gridBody: Content[][] = [colHeaders];

  for (const retail of retailPrices) {
    const wholesale = retail / refSet.retailMultiplier;
    const row: Content[] = [
      { text: fmt1(retail), bold: true, fontSize: 7 },
      { text: fmt1(wholesale), fontSize: 7, color: '#555555' },
    ];
    for (const set of sets) {
      const fob = calcMaxSupplierCost(retail, set);
      row.push({ text: fob > 0 ? fmt1(fob) : '—', fontSize: 7, color: fob > 0 ? '#000000' : '#999999' });
    }
    gridBody.push(row);
  }

  const colWidths: (number | string)[] = [40, 44, ...sets.map(() => '*' as const)];

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: sets.length > 4 ? 'landscape' : 'portrait',
    pageMargins: [20, 60, 20, 30] as [number, number, number, number],

    header: (currentPage, pageCount) =>
      buildBrandPageHeader(
        { name: brand.name, logoDataUri },
        currentPage,
        pageCount,
        { subtitle, extractedInfo },
      ),

    styles: {
      gridHeader: { ...headerStyle },
    },

    content: [
      // Parameters block
      {
        margin: [0, 0, 0, 12] as [number, number, number, number],
        stack: [
          { text: 'Parametri', fontSize: 9, bold: true, margin: [0, 0, 0, 4] as [number, number, number, number] },
          ...paramRows,
        ],
      } as Content,

      // Grid
      {
        table: {
          headerRows: 1,
          widths: colWidths,
          body: gridBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#dddddd',
          vLineColor: () => '#dddddd',
          fillColor: (row) => {
            if (row === 0) return '#1F4E79';
            return row % 2 === 1 ? '#F5F5F5' : null;
          },
        },
      } as Content,
    ],
  };

  return createPdfBuffer(docDef);
}
