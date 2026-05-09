import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/src/printer');
import ExcelJS from 'exceljs';
import type { TDocumentDefinitions, TableCell, Content } from 'pdfmake/interfaces';

import { generateIcal } from '@luke/calendar';
import { authenticateRequest } from '../lib/auth';
import { PLANNING_SECTION_KEYS, type PlanningSectionKey } from '@luke/core';
import { filterAllowedBrandIds, listMilestonesDb } from '../services/seasonCalendar.service';

// ─── Shared types ────────────────────────────────────────────────────────────

interface ExportMilestone {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  status: string;
  ownerSectionKey: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  publishExternally: boolean;
  brandCode: string;
}

const SECTION_LABELS: Record<string, string> = {
  'planning.sales': 'Vendite',
  'planning.product': 'Prodotto',
  'planning.sourcing': 'Sourcing',
  'planning.merchandising': 'Merchandising',
};

const TYPE_LABELS: Record<string, string> = {
  KICKOFF: 'Kickoff',
  REVIEW: 'Review',
  GATE: 'Gate',
  DEADLINE: 'Deadline',
  MILESTONE: 'Milestone',
  CUSTOM: 'Custom',
};

const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Pianificato',
  IN_PROGRESS: 'In corso',
  COMPLETED: 'Completato',
  CANCELLED: 'Annullato',
};

// pdfmake built-in PDF fonts — no font files needed
const PDF_FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function fetchExportMilestones(
  seasonId: string,
  brandIds: string[],
  userId: string,
  prisma: PrismaClient,
  sectionKey?: string
): Promise<ExportMilestone[]> {
  const validSectionKey = sectionKey && (PLANNING_SECTION_KEYS as readonly string[]).includes(sectionKey)
    ? sectionKey as PlanningSectionKey
    : undefined;

  const milestones = await listMilestonesDb(seasonId, brandIds, userId, prisma, validSectionKey);

  const brandMap = new Map<string, string>();
  if (milestones.length > 0) {
    const uniqueBrandIds = [...new Set(milestones.map(m => m.brandId).filter(Boolean) as string[])];
    const brands = await prisma.brand.findMany({
      where: { id: { in: uniqueBrandIds } },
      select: { id: true, code: true },
    });
    for (const b of brands) brandMap.set(b.id, b.code);
  }

  return milestones.map(m => ({
    id: m.id,
    title: m.title,
    description: m.description,
    type: m.type,
    status: m.status,
    ownerSectionKey: m.ownerSectionKey,
    startAt: new Date(m.startAt),
    endAt: m.endAt ? new Date(m.endAt) : null,
    allDay: m.allDay,
    publishExternally: m.publishExternally,
    brandCode: m.brandId ? (brandMap.get(m.brandId) ?? m.brandId) : '—',
  }));
}

// ─── PDF generation (pdfmake) ─────────────────────────────────────────────────

function generatePdf(milestones: ExportMilestone[], seasonLabel: string): Promise<Buffer> {
  const headerCell = (text: string): TableCell => ({
    text,
    bold: true,
    color: '#ffffff',
    fillColor: '#1e293b',
    fontSize: 8,
    margin: [3, 4, 3, 4],
  });

  const dataCell = (text: string, fillColor: string): TableCell => ({
    text,
    fontSize: 8,
    fillColor,
    margin: [3, 3, 3, 3],
  });

  const STATUS_FILL: Record<string, string> = {
    PLANNED: '#fef3c7',
    IN_PROGRESS: '#d1fae5',
    COMPLETED: '#f0f9ff',
    CANCELLED: '#fee2e2',
  };

  const tableBody: TableCell[][] = [
    [
      headerCell('Data'),
      headerCell('Milestone'),
      headerCell('Tipo'),
      headerCell('Brand'),
      headerCell('Sezione'),
      headerCell('Stato'),
      headerCell('Google Cal'),
    ],
    ...milestones.map((m, i) => {
      const fill = STATUS_FILL[m.status] ?? (i % 2 === 0 ? '#f8fafc' : '#ffffff');
      const dateStr = m.startAt.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });
      const endStr = m.endAt
        ? ` → ${m.endAt.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}`
        : '';
      return [
        dataCell(`${dateStr}${endStr}`, fill),
        dataCell(m.title, fill),
        dataCell(TYPE_LABELS[m.type] ?? m.type, fill),
        dataCell(m.brandCode, fill),
        dataCell(SECTION_LABELS[m.ownerSectionKey] ?? m.ownerSectionKey, fill),
        dataCell(STATUS_LABELS[m.status] ?? m.status, fill),
        dataCell(m.publishExternally ? 'Sì' : 'No', fill),
      ];
    }),
  ];

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 50, 30, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    header: {
      columns: [
        { text: `Calendario Stagionale — ${seasonLabel}`, bold: true, fontSize: 13, margin: [30, 15, 0, 0] },
        {
          text: `Esportato il ${new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}`,
          alignment: 'right',
          color: '#64748b',
          fontSize: 8,
          margin: [0, 20, 30, 0],
        },
      ],
    },
    footer: (currentPage: number, pageCount: number): Content => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      color: '#94a3b8',
      fontSize: 8,
      margin: [0, 10, 0, 0],
    }),
    content: [
      {
        table: {
          headerRows: 1,
          widths: [70, '*', 52, 40, 70, 65, 52],
          body: tableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => '#e2e8f0',
        },
      },
    ],
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(PDF_FONTS);
      const doc = printer.createPdfKitDocument(docDef);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── PDF helpers ─────────────────────────────────────────────────────────────

const MONTH_IT_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_IT_LONG = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const DAY_IT_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

function addDaysLocal(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function milestonesOnDay(milestones: ExportMilestone[], day: Date): ExportMilestone[] {
  const s = day.getTime();
  const e = s + 86_400_000 - 1;
  return milestones.filter(m => m.startAt.getTime() <= e && (m.endAt ?? m.startAt).getTime() >= s);
}

const BRAND_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function milestoneColor(m: ExportMilestone): string {
  const key = m.brandCode || m.ownerSectionKey;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
  return BRAND_PALETTE[Math.abs(hash) % BRAND_PALETTE.length]!;
}

function makePdfHeader(title: string, subtitle: string): Content {
  return {
    columns: [
      {
        stack: [
          { text: title, bold: true, fontSize: 13 },
          { text: subtitle, color: '#64748b', fontSize: 9, margin: [0, 2, 0, 0] },
        ],
        margin: [30, 12, 0, 0],
      },
      {
        text: `Esportato il ${new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}`,
        alignment: 'right',
        color: '#64748b',
        fontSize: 8,
        margin: [0, 20, 30, 0],
      },
    ],
  };
}

// ─── PDF week view ────────────────────────────────────────────────────────────

function generatePdfWeek(milestones: ExportMilestone[], seasonLabel: string, viewDate: Date): Promise<Buffer> {
  const weekStart = mondayOf(viewDate);
  const days = Array.from({ length: 7 }, (_, i) => addDaysLocal(weekStart, i));

  const startFmt = weekStart.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const endFmt = days[6]!.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  const weekLabel = `Settimana ${startFmt} – ${endFmt}`;

  const colWidths = Array(7).fill('*') as string[];

  const headerRow: TableCell[] = days.map((d, i) => ({
    stack: [
      { text: DAY_IT_SHORT[i], fontSize: 7, color: '#64748b' } as Content,
      { text: String(d.getDate()), fontSize: 11, bold: true } as Content,
    ],
    fillColor: isSameDay(d, new Date()) ? '#eff6ff' : '#f8fafc',
    alignment: 'center' as const,
    margin: [2, 4, 2, 4],
  } as unknown as TableCell));

  const maxItems = Math.max(...days.map(d => milestonesOnDay(milestones, d).length), 1);
  const contentRows: TableCell[][] = Array.from({ length: maxItems }, (_, rowIdx) =>
    days.map(day => {
      const items = milestonesOnDay(milestones, day);
      const m = items[rowIdx];
      if (!m) return { text: '', margin: [2, 2, 2, 2], fillColor: isSameDay(day, new Date()) ? '#eff6ff' : '#ffffff' } as unknown as TableCell;
      return {
        stack: [
          { text: m.title, fontSize: 7, bold: true, color: '#ffffff' } as Content,
          { text: STATUS_LABELS[m.status] ?? m.status, fontSize: 6, color: '#e2e8f0' } as Content,
        ],
        fillColor: milestoneColor(m),
        margin: [3, 3, 3, 3],
      } as unknown as TableCell;
    })
  );

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 55, 30, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 8 },
    header: makePdfHeader(`Calendario Stagionale — ${seasonLabel}`, weekLabel),
    footer: (p: number, t: number): Content => ({ text: `${p} / ${t}`, alignment: 'center', color: '#94a3b8', fontSize: 8, margin: [0, 10, 0, 0] }),
    content: [{
      table: { headerRows: 1, widths: colWidths, body: [headerRow, ...contentRows] },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0' },
    }],
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(PDF_FONTS);
      const doc = printer.createPdfKitDocument(docDef);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) { reject(err); }
  });
}

// ─── PDF month view ───────────────────────────────────────────────────────────

function generatePdfMonth(milestones: ExportMilestone[], seasonLabel: string, viewDate: Date): Promise<Buffer> {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const gridStart = mondayOf(new Date(year, month, 1));
  const cells = Array.from({ length: 42 }, (_, i) => addDaysLocal(gridStart, i));
  const today = new Date();
  const monthLabel = `${MONTH_IT_LONG[month]} ${year}`;

  const MAX_PER_CELL = 3;
  const colWidths = Array(7).fill('*') as string[];

  const dayHeaderRow: TableCell[] = DAY_IT_SHORT.map(d => ({
    text: d, bold: true, fontSize: 7, alignment: 'center' as const,
    fillColor: '#1e293b', color: '#ffffff', margin: [2, 4, 2, 4],
  } as unknown as TableCell));

  const weeks: TableCell[][] = [];
  for (let w = 0; w < 6; w++) {
    weeks.push(cells.slice(w * 7, w * 7 + 7).map(day => {
      const inMonth = day.getMonth() === month;
      const isToday = isSameDay(day, today);
      const items = milestonesOnDay(milestones, day);
      const shown = items.slice(0, MAX_PER_CELL);
      const overflow = items.length - MAX_PER_CELL;

      return {
        stack: [
          {
            text: String(day.getDate()),
            fontSize: 7,
            bold: isToday,
            color: isToday ? '#3b82f6' : inMonth ? '#1e293b' : '#94a3b8',
            decoration: isToday ? 'underline' : undefined,
            alignment: 'right',
            margin: [0, 0, 2, 2],
          } as Content,
          ...shown.map(m => ({
            text: `• ${m.title}`,
            fontSize: 6,
            color: milestoneColor(m),
            margin: [1, 1, 1, 0],
          } as Content)),
          ...(overflow > 0 ? [{ text: `  +${overflow} altri`, fontSize: 5, color: '#94a3b8', margin: [1, 0, 1, 0] } as Content] : []),
        ],
        fillColor: isToday ? '#eff6ff' : inMonth ? '#ffffff' : '#f8fafc',
        margin: [2, 2, 2, 2],
      } as unknown as TableCell;
    }));
  }

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 55, 30, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 8 },
    header: makePdfHeader(`Calendario Stagionale — ${seasonLabel}`, monthLabel),
    footer: (p: number, t: number): Content => ({ text: `${p} / ${t}`, alignment: 'center', color: '#94a3b8', fontSize: 8, margin: [0, 10, 0, 0] }),
    content: [{
      table: { headerRows: 1, widths: colWidths, body: [dayHeaderRow, ...weeks] },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0' },
    }],
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(PDF_FONTS);
      const doc = printer.createPdfKitDocument(docDef);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) { reject(err); }
  });
}

// ─── PDF gantt view ───────────────────────────────────────────────────────────

function generatePdfGantt(milestones: ExportMilestone[], seasonLabel: string): Promise<Buffer> {
  if (milestones.length === 0) return generatePdf(milestones, seasonLabel);

  const LABEL_W = 160;

  // Compute month range
  const starts = milestones.map(m => new Date(m.startAt.getFullYear(), m.startAt.getMonth(), 1));
  const ends = milestones.map(m => {
    const e = m.endAt ?? m.startAt;
    return new Date(e.getFullYear(), e.getMonth(), 1);
  });
  const minMonth = starts.reduce((a, b) => a < b ? a : b);
  const maxMonth = ends.reduce((a, b) => a > b ? a : b);

  const months: Date[] = [];
  const cur = new Date(minMonth);
  while (cur <= maxMonth) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  const colWidths: (string | number)[] = [LABEL_W, ...months.map(() => '*')];

  const headerRow: TableCell[] = [
    { text: 'Milestone', bold: true, fontSize: 8, fillColor: '#1e293b', color: '#ffffff', margin: [4, 4, 4, 4] } as unknown as TableCell,
    ...months.map(m => ({
      text: `${MONTH_IT_SHORT[m.getMonth()]} ${m.getFullYear()}`,
      bold: true, fontSize: 7, fillColor: '#1e293b', color: '#ffffff',
      alignment: 'center' as const, margin: [2, 4, 2, 4],
    } as unknown as TableCell)),
  ];

  const dataRows: TableCell[][] = milestones.map(m => {
    const mStart = new Date(m.startAt.getFullYear(), m.startAt.getMonth(), 1);
    const mEnd = m.endAt ? new Date(m.endAt.getFullYear(), m.endAt.getMonth(), 1) : mStart;
    const color = milestoneColor(m);

    return [
      { text: m.title, fontSize: 7, margin: [4, 3, 4, 3] },
      ...months.map(mon => {
        const inRange = mon >= mStart && mon <= mEnd;
        return {
          text: inRange && isSameDay(mon, mStart) ? (m.title.length > 12 ? m.title.slice(0, 12) + '…' : m.title) : '',
          fontSize: 6,
          color: '#ffffff',
          fillColor: inRange ? color : '#f8fafc',
          margin: [2, 3, 2, 3],
        } as TableCell;
      }),
    ];
  });

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 55, 30, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 8 },
    header: makePdfHeader(`Calendario Stagionale — ${seasonLabel}`, 'Vista Gantt'),
    footer: (p: number, t: number): Content => ({ text: `${p} / ${t}`, alignment: 'center', color: '#94a3b8', fontSize: 8, margin: [0, 10, 0, 0] }),
    content: [{
      table: { headerRows: 1, widths: colWidths, body: [headerRow, ...dataRows] },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0' },
    }],
  };

  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(PDF_FONTS);
      const doc = printer.createPdfKitDocument(docDef);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) { reject(err); }
  });
}

// ─── XLSX generation (ExcelJS) ────────────────────────────────────────────────

async function generateXlsx(milestones: ExportMilestone[], seasonLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Luke';
  wb.created = new Date();

  const ws = wb.addWorksheet('Calendario', { views: [{ state: 'frozen', ySplit: 2 }] });

  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Calendario Stagionale — ${seasonLabel}`;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  const headerRow = ws.addRow(['Data inizio', 'Data fine', 'Milestone', 'Tipo', 'Brand', 'Sezione', 'Stato', 'Google Cal']);
  headerRow.height = 18;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle' };
  });

  ws.columns = [
    { width: 14 }, { width: 12 }, { width: 38 }, { width: 12 },
    { width: 10 }, { width: 16 }, { width: 14 }, { width: 12 },
  ];

  const STATUS_COLORS: Record<string, string> = {
    PLANNED: 'FFFEF3C7',
    IN_PROGRESS: 'FFD1FAE5',
    COMPLETED: 'FFF0F9FF',
    CANCELLED: 'FFFEE2E2',
  };

  milestones.forEach((m, i) => {
    const row = ws.addRow([
      m.startAt.toLocaleDateString('it-IT'),
      m.endAt ? m.endAt.toLocaleDateString('it-IT') : '',
      m.title,
      TYPE_LABELS[m.type] ?? m.type,
      m.brandCode,
      SECTION_LABELS[m.ownerSectionKey] ?? m.ownerSectionKey,
      STATUS_LABELS[m.status] ?? m.status,
      m.publishExternally ? 'Sì' : 'No',
    ]);
    row.height = 16;
    const bgColor = STATUS_COLORS[m.status] ?? (i % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF');
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };
    });
  });

  ws.autoFilter = { from: 'A2', to: 'H2' };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Fastify plugin ───────────────────────────────────────────────────────────

export default fp(async (app: FastifyInstance, options: { prisma: PrismaClient }) => {
  const prisma = options.prisma;

  async function resolveParams(req: FastifyRequest, reply: FastifyReply) {
    const session = await authenticateRequest(req, reply);
    if (!session) {
      reply.code(401).send({ error: 'Unauthorized' });
      return null;
    }

    const { seasonId, brandIds: brandIdsCsv, sectionKey, view, viewDate } = req.query as Record<string, string | undefined>;
    if (!seasonId || !brandIdsCsv) {
      reply.code(400).send({ error: 'seasonId and brandIds are required' });
      return null;
    }

    const requestedBrandIds = brandIdsCsv.split(',').map(s => s.trim()).filter(Boolean);
    const allowedBrandIds = await filterAllowedBrandIds(session.user.id, requestedBrandIds, prisma);
    if (allowedBrandIds.length === 0) {
      reply.code(403).send({ error: 'No accessible brands' });
      return null;
    }

    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { name: true, year: true },
    });
    const seasonLabel = season
      ? `${season.name}${season.year ? ` ${season.year}` : ''}`
      : seasonId;

    const parsedView = (view && ['list', 'week', 'month', 'gantt'].includes(view))
      ? (view as 'list' | 'week' | 'month' | 'gantt')
      : 'list';
    const parsedViewDate = viewDate ? new Date(viewDate) : new Date();

    return { session, seasonId, allowedBrandIds, sectionKey, seasonLabel, view: parsedView, viewDate: parsedViewDate };
  }

  app.get('/season-calendar/export/ical', async (req, reply) => {
    const ctx = await resolveParams(req, reply);
    if (!ctx) return;

    const milestones = await fetchExportMilestones(
      ctx.seasonId, ctx.allowedBrandIds, ctx.session.user.id, prisma, ctx.sectionKey
    );

    const icalString = generateIcal(
      milestones.map(m => ({
        id: m.id, title: m.title, description: m.description,
        startAt: m.startAt, endAt: m.endAt, allDay: m.allDay,
        status: m.status, brandCode: m.brandCode,
      })),
      `Luke · ${ctx.seasonLabel}`
    );

    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="luke-calendar-${ctx.seasonId}.ics"`)
      .send(icalString);
  });

  app.get('/season-calendar/export/pdf', async (req, reply) => {
    const ctx = await resolveParams(req, reply);
    if (!ctx) return;

    const milestones = await fetchExportMilestones(
      ctx.seasonId, ctx.allowedBrandIds, ctx.session.user.id, prisma, ctx.sectionKey
    );

    let pdfBuffer: Buffer;
    if (ctx.view === 'week') {
      pdfBuffer = await generatePdfWeek(milestones, ctx.seasonLabel, ctx.viewDate);
    } else if (ctx.view === 'month') {
      pdfBuffer = await generatePdfMonth(milestones, ctx.seasonLabel, ctx.viewDate);
    } else if (ctx.view === 'gantt') {
      pdfBuffer = await generatePdfGantt(milestones, ctx.seasonLabel);
    } else {
      pdfBuffer = await generatePdf(milestones, ctx.seasonLabel);
    }

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="luke-calendar-${ctx.seasonId}.pdf"`)
      .send(pdfBuffer);
  });

  app.get('/season-calendar/export/xlsx', async (req, reply) => {
    const ctx = await resolveParams(req, reply);
    if (!ctx) return;

    const milestones = await fetchExportMilestones(
      ctx.seasonId, ctx.allowedBrandIds, ctx.session.user.id, prisma, ctx.sectionKey
    );

    const xlsxBuffer = await generateXlsx(milestones, ctx.seasonLabel);

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="luke-calendar-${ctx.seasonId}.xlsx"`)
      .send(xlsxBuffer);
  });
});
