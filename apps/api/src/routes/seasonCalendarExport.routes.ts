/**
 * Fastify plugin for season calendar export endpoints.
 *
 * Endpoints (all require authentication; brand access is enforced per-request):
 *  - GET /download/season-calendar/ical  — download milestones as an iCal (.ics) file
 *  - GET /download/season-calendar/pdf   — download milestones as a PDF (list/week/month/gantt view)
 *  - GET /download/season-calendar/xlsx  — download milestones as an Excel workbook
 *
 * Query parameters: seasonId (required), brandIds (comma-separated, required),
 * functionId (optional filter), view (list|week|month|gantt, default: list),
 * viewDate (the `YYYY-MM-DD` calendar date the week/month views show; default: today; a malformed
 * one is a 400 on every endpoint).
 *
 * PDF and XLSX write every date in the requester's zone (`resolveUserTimeZone`): an all-day event
 * as its stored date, a timed one as the date its instant falls on there (`eventCalendarDays`).
 * iCal carries UTC instants and the stored all-day dates; the calendar app converts them.
 */

import ExcelJS from 'exceljs';
import fp from 'fastify-plugin';


import { generateIcal } from '@luke/calendar';
import {
  addCalendarDays,
  calendarDateIn,
  eventCalendarDays,
  formatCalendarDate,
  isDevelopment,
  parseCalendarDate,
  utcMidnightOf,
  type CalendarDate,
  type Role,
} from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { authenticateRequest, rateLimitKeyFromRequest } from '../lib/auth';
// Single entry point to the PDF engine: it's the only place where `setUrlAccessPolicy`
// and `setLocalAccessPolicy` are locked down. Four hand-built `new PdfPrinter(...)`
// instances used to live here, inheriting no policy — and which, since the pdfmake
// 0.2→0.3 bump, were broken anyway: in 0.3 `createPdfKitDocument` returns a
// Promise, not a stream, so `doc.on(...)` threw (500 to the caller) and the
// orphaned Promise rejected with an unhandled TypeError, which `server.ts`'s
// guards turn into `process.exit(1)`.
import { createPdfBuffer } from '../lib/export/pdf';
import { resolveUserTimeZone } from '../lib/userTimeZone';
import { getUserAllowedIds } from '../services/context.service';
import { listMilestonesDb } from '../services/seasonCalendar.service';

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TDocumentDefinitions, TableCell, Content } from 'pdfmake/interfaces';


// ─── Shared types ────────────────────────────────────────────────────────────

interface ExportMilestone {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  visibleFunctionNames: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  publishExternally: boolean;
  brandCode: string;
  /** First and last calendar dates the milestone covers for the requester. */
  firstDay: CalendarDate;
  lastDay: CalendarDate;
}

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function fetchExportMilestones(
  seasonId: string,
  brandIds: string[],
  userId: string,
  prisma: PrismaClient,
  timeZone: string,
  functionId?: string,
  allowedFunctionIds?: string[] | null
): Promise<ExportMilestone[]> {
  const milestones = await listMilestonesDb(seasonId, brandIds, userId, prisma, functionId, allowedFunctionIds);

  const brandMap = new Map<string, string>();
  const functionNameMap = new Map<string, string>();

  if (milestones.length > 0) {
    const uniqueBrandIds = [...new Set(milestones.map(m => m.brandId).filter(Boolean) as string[])];
    const brands = await prisma.brand.findMany({
      where: { id: { in: uniqueBrandIds } },
      select: { id: true, code: true },
    });
    for (const b of brands) brandMap.set(b.id, b.code);

    const uniqueFunctionIds = [...new Set(milestones.flatMap(m => m.visibilities.map(v => v.functionId)))];
    const functions = await prisma.companyFunction.findMany({
      where: { id: { in: uniqueFunctionIds } },
      select: { id: true, name: true },
    });
    for (const f of functions) functionNameMap.set(f.id, f.name);
  }

  return milestones.map(m => {
    const startAt = new Date(m.startAt);
    const endAt = m.endAt ? new Date(m.endAt) : null;
    const [firstDay, lastDay] = eventCalendarDays(startAt, endAt, m.allDay, timeZone);
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      status: m.cancelledAt ? 'CANCELLED' : 'ACTIVE',
      visibleFunctionNames: m.visibilities.map(v => functionNameMap.get(v.functionId) ?? v.functionId).join(', '),
      startAt,
      endAt,
      allDay: m.allDay,
      publishExternally: m.publishExternally,
      brandCode: m.brandId ? (brandMap.get(m.brandId) ?? m.brandId) : '—',
      firstDay,
      lastDay,
    };
  });
}

/** "Esportato il …" for the requester's today. */
function exportedOnLabel(today: CalendarDate): string {
  return `Esportato il ${formatCalendarDate(today, { day: '2-digit', month: 'long', year: 'numeric' })}`;
}

// ─── PDF generation (pdfmake) ─────────────────────────────────────────────────

function generatePdf(milestones: ExportMilestone[], seasonLabel: string, today: CalendarDate): Promise<Buffer> {
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

  const tableBody: TableCell[][] = [
    [
      headerCell('Data'),
      headerCell('Milestone'),
      headerCell('Brand'),
      headerCell('Visibile a'),
      headerCell('Stato'),
      headerCell('Google Cal'),
    ],
    ...milestones.map((m, i) => {
      const cancelled = m.status === 'CANCELLED';
      const fill = cancelled ? '#fee2e2' : (i % 2 === 0 ? '#f8fafc' : '#ffffff');
      const dateStr = formatCalendarDate(m.firstDay, { day: '2-digit', month: 'short', year: '2-digit' });
      const endStr = m.lastDay !== m.firstDay
        ? ` → ${formatCalendarDate(m.lastDay, { day: '2-digit', month: 'short' })}`
        : '';
      return [
        dataCell(`${dateStr}${endStr}`, fill),
        dataCell(m.title, fill),
        dataCell(m.brandCode, fill),
        dataCell(m.visibleFunctionNames, fill),
        dataCell(cancelled ? 'Annullato' : 'Attivo', fill),
        dataCell(m.publishExternally ? 'Sì' : 'No', fill),
      ];
    }),
  ];

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 50, 30, 40],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    header: {
      columns: [
        { text: `Calendario Stagionale — ${seasonLabel}`, bold: true, fontSize: 13, margin: [30, 15, 0, 0] },
        {
          text: exportedOnLabel(today),
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
          widths: [70, '*', 40, 90, 65, 52],
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

  return createPdfBuffer(docDef);
}

// ─── PDF helpers ─────────────────────────────────────────────────────────────

const MONTH_IT_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_IT_LONG = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const DAY_IT_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/** The Monday-to-Sunday week `viewDate` falls in. */
export function weekDays(viewDate: CalendarDate): CalendarDate[] {
  const monday = addCalendarDays(viewDate, -((utcMidnightOf(viewDate).getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(monday, i));
}

/** The month `viewDate` falls in (`'YYYY-MM'`) and its 6 × 7 grid, from the Monday on or before the 1st. */
export function monthGrid(viewDate: CalendarDate): { month: string; cells: CalendarDate[] } {
  const firstOfMonth = addCalendarDays(viewDate, 1 - Number(viewDate.slice(8, 10)));
  const gridStart = weekDays(firstOfMonth)[0]!;
  return { month: firstOfMonth.slice(0, 7), cells: Array.from({ length: 42 }, (_, i) => addCalendarDays(gridStart, i)) };
}

/** Day of the month of a calendar date, as written in a grid cell. */
function dayNumber(date: CalendarDate): string {
  return String(Number(date.slice(8, 10)));
}

/** `'YYYY-MM'` → the following month, same shape. */
function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
}

/** Every month (`'YYYY-MM'`) from the earliest first day to the latest last day; at least one milestone. */
export function ganttMonths(milestones: Pick<ExportMilestone, 'firstDay' | 'lastDay'>[]): string[] {
  const minMonth = milestones.map(m => m.firstDay.slice(0, 7)).reduce((a, b) => a < b ? a : b);
  const maxMonth = milestones.map(m => m.lastDay.slice(0, 7)).reduce((a, b) => a > b ? a : b);
  const months: string[] = [];
  for (let month = minMonth; month <= maxMonth; month = nextMonth(month)) months.push(month);
  return months;
}

function milestonesOnDay(milestones: ExportMilestone[], day: CalendarDate): ExportMilestone[] {
  return milestones.filter(m => m.firstDay <= day && day <= m.lastDay);
}

const BRAND_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function milestoneColor(m: ExportMilestone): string {
  const key = m.brandCode;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
  return BRAND_PALETTE[Math.abs(hash) % BRAND_PALETTE.length]!;
}

function makePdfHeader(title: string, subtitle: string, today: CalendarDate): Content {
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
        text: exportedOnLabel(today),
        alignment: 'right',
        color: '#64748b',
        fontSize: 8,
        margin: [0, 20, 30, 0],
      },
    ],
  };
}

// ─── PDF week view ────────────────────────────────────────────────────────────

function generatePdfWeek(milestones: ExportMilestone[], seasonLabel: string, viewDate: CalendarDate, today: CalendarDate): Promise<Buffer> {
  const days = weekDays(viewDate);
  const weekStart = days[0]!;

  const startFmt = formatCalendarDate(weekStart, { day: 'numeric', month: 'short' });
  const endFmt = formatCalendarDate(days[6]!, { day: 'numeric', month: 'short', year: 'numeric' });
  const weekLabel = `Settimana ${startFmt} – ${endFmt}`;

  const colWidths = Array(7).fill('*') as string[];

  const headerRow: TableCell[] = days.map((d, i) => ({
    stack: [
      { text: DAY_IT_SHORT[i], fontSize: 7, color: '#64748b' } as Content,
      { text: dayNumber(d), fontSize: 11, bold: true } as Content,
    ],
    fillColor: d === today ? '#eff6ff' : '#f8fafc',
    alignment: 'center' as const,
    margin: [2, 4, 2, 4],
  } as unknown as TableCell));

  const maxItems = Math.max(...days.map(d => milestonesOnDay(milestones, d).length), 1);
  const contentRows: TableCell[][] = Array.from({ length: maxItems }, (_, rowIdx) =>
    days.map(day => {
      const items = milestonesOnDay(milestones, day);
      const m = items[rowIdx];
      if (!m) return { text: '', margin: [2, 2, 2, 2], fillColor: day === today ? '#eff6ff' : '#ffffff' } as unknown as TableCell;
      return {
        stack: [
          { text: m.title, fontSize: 7, bold: true, color: '#ffffff' } as Content,
          { text: m.status === 'CANCELLED' ? 'Annullato' : 'Attivo', fontSize: 6, color: '#e2e8f0' } as Content,
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
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    header: makePdfHeader(`Calendario Stagionale — ${seasonLabel}`, weekLabel, today),
    footer: (p: number, t: number): Content => ({ text: `${p} / ${t}`, alignment: 'center', color: '#94a3b8', fontSize: 8, margin: [0, 10, 0, 0] }),
    content: [{
      table: { headerRows: 1, widths: colWidths, body: [headerRow, ...contentRows] },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0' },
    }],
  };

  return createPdfBuffer(docDef);
}

// ─── PDF month view ───────────────────────────────────────────────────────────

function generatePdfMonth(milestones: ExportMilestone[], seasonLabel: string, viewDate: CalendarDate, today: CalendarDate): Promise<Buffer> {
  const { month, cells } = monthGrid(viewDate);
  const monthLabel = `${MONTH_IT_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

  const MAX_PER_CELL = 3;
  const colWidths = Array(7).fill('*') as string[];

  const dayHeaderRow: TableCell[] = DAY_IT_SHORT.map(d => ({
    text: d, bold: true, fontSize: 7, alignment: 'center' as const,
    fillColor: '#1e293b', color: '#ffffff', margin: [2, 4, 2, 4],
  } as unknown as TableCell));

  const weeks: TableCell[][] = [];
  for (let w = 0; w < 6; w++) {
    weeks.push(cells.slice(w * 7, w * 7 + 7).map(day => {
      const inMonth = day.slice(0, 7) === month;
      const isToday = day === today;
      const items = milestonesOnDay(milestones, day);
      const shown = items.slice(0, MAX_PER_CELL);
      const overflow = items.length - MAX_PER_CELL;

      return {
        stack: [
          {
            text: dayNumber(day),
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
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    header: makePdfHeader(`Calendario Stagionale — ${seasonLabel}`, monthLabel, today),
    footer: (p: number, t: number): Content => ({ text: `${p} / ${t}`, alignment: 'center', color: '#94a3b8', fontSize: 8, margin: [0, 10, 0, 0] }),
    content: [{
      table: { headerRows: 1, widths: colWidths, body: [dayHeaderRow, ...weeks] },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0' },
    }],
  };

  return createPdfBuffer(docDef);
}

// ─── PDF gantt view ───────────────────────────────────────────────────────────

function generatePdfGantt(milestones: ExportMilestone[], seasonLabel: string, today: CalendarDate): Promise<Buffer> {
  if (milestones.length === 0) return generatePdf(milestones, seasonLabel, today);

  const LABEL_W = 160;

  const months = ganttMonths(milestones);

  const colWidths: (string | number)[] = [LABEL_W, ...months.map(() => '*')];

  const headerRow: TableCell[] = [
    { text: 'Milestone', bold: true, fontSize: 8, fillColor: '#1e293b', color: '#ffffff', margin: [4, 4, 4, 4] } as unknown as TableCell,
    ...months.map(m => ({
      text: `${MONTH_IT_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`,
      bold: true, fontSize: 7, fillColor: '#1e293b', color: '#ffffff',
      alignment: 'center' as const, margin: [2, 4, 2, 4],
    } as unknown as TableCell)),
  ];

  const dataRows: TableCell[][] = milestones.map(m => {
    const mStart = m.firstDay.slice(0, 7);
    const mEnd = m.lastDay.slice(0, 7);
    const color = milestoneColor(m);

    return [
      { text: m.title, fontSize: 7, margin: [4, 3, 4, 3] },
      ...months.map(mon => {
        const inRange = mon >= mStart && mon <= mEnd;
        return {
          text: inRange && mon === mStart ? (m.title.length > 12 ? m.title.slice(0, 12) + '…' : m.title) : '',
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
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    header: makePdfHeader(`Calendario Stagionale — ${seasonLabel}`, 'Vista Gantt', today),
    footer: (p: number, t: number): Content => ({ text: `${p} / ${t}`, alignment: 'center', color: '#94a3b8', fontSize: 8, margin: [0, 10, 0, 0] }),
    content: [{
      table: { headerRows: 1, widths: colWidths, body: [headerRow, ...dataRows] },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0' },
    }],
  };

  return createPdfBuffer(docDef);
}

// ─── XLSX generation (ExcelJS) ────────────────────────────────────────────────

/** `dd/mm/yyyy`, what the sheet has always shown. */
const XLSX_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

async function generateXlsx(milestones: ExportMilestone[], seasonLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Luke';
  wb.created = new Date();

  const ws = wb.addWorksheet('Calendario', { views: [{ state: 'frozen', ySplit: 2 }] });

  ws.mergeCells('A1:G1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Calendario Stagionale — ${seasonLabel}`;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  const headerRow = ws.addRow(['Data inizio', 'Data fine', 'Milestone', 'Brand', 'Visibile a', 'Stato', 'Google Cal']);
  headerRow.height = 18;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle' };
  });

  ws.columns = [
    { width: 14 }, { width: 12 }, { width: 38 },
    { width: 10 }, { width: 24 }, { width: 14 }, { width: 12 },
  ];

  milestones.forEach((m, i) => {
    const cancelled = m.status === 'CANCELLED';
    const row = ws.addRow([
      formatCalendarDate(m.firstDay, XLSX_DATE),
      m.endAt ? formatCalendarDate(m.lastDay, XLSX_DATE) : '',
      m.title,
      m.brandCode,
      m.visibleFunctionNames,
      cancelled ? 'Annullato' : 'Attivo',
      m.publishExternally ? 'Sì' : 'No',
    ]);
    row.height = 16;
    // Only cancelled events carry a distinct fill; active ones fall back to the alternating row color.
    const bgColor = cancelled ? 'FFFEE2E2' : (i % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF');
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };
    });
  });

  ws.autoFilter = { from: 'A2', to: 'G2' };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Fastify plugin ───────────────────────────────────────────────────────────

export default fp(async (app: FastifyInstance, options: { prisma: PrismaClient }) => {
  const prisma = options.prisma;

  /**
   * Per-route limit on top of the global limiter registered in `server.ts`.
   *
   * `@fastify/rate-limit` isn't registered here: this plugin is wrapped in
   * `fp()`, so an `app.register(rateLimit, ...)` would end up in the root
   * scope and become the server's global limit — the same incident documented
   * in `brandLogo.routes.ts`. The per-route option only tightens these three.
   *
   * The global default (100 req/min per IP) is too generous for PDF
   * generation, which holds the entire document in memory.
   */
  const exportRateLimit = {
    config: {
      rateLimit: {
        max: isDevelopment() ? 100 : 10,
        timeWindow: '1 minute',
        keyGenerator: rateLimitKeyFromRequest,
      },
    },
  };

  async function resolveParams(req: FastifyRequest, reply: FastifyReply) {
    const session = await authenticateRequest(req, reply, prisma);
    if (!session) {
      reply.code(401).send({ error: 'Unauthorized' });
      return null;
    }

    const { seasonId, brandIds: brandIdsCsv, functionId, view, viewDate } = req.query as Record<string, string | undefined>;
    if (!seasonId || !brandIdsCsv) {
      reply.code(400).send({ error: 'seasonId and brandIds are required' });
      return null;
    }

    const requestedBrandIds = brandIdsCsv.split(',').map(s => s.trim()).filter(Boolean);
    const allowed = await getUserAllowedIds(session.user.id, prisma, session.user.role as Role);
    const allowedBrandIds = allowed.brandIds === null
      ? requestedBrandIds
      : requestedBrandIds.filter(id => allowed.brandIds!.includes(id));
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

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { timezone: true } });
    const timeZone = await resolveUserTimeZone(prisma, { id: session.user.id, timezone: user?.timezone ?? '' }, req.log);
    const today = calendarDateIn(new Date(), timeZone);
    const parsedViewDate = viewDate ? parseCalendarDate(viewDate) : today;
    if (!parsedViewDate) {
      reply.code(400).send({ error: 'viewDate must be a YYYY-MM-DD calendar date' });
      return null;
    }

    return { session, seasonId, allowedBrandIds, allowedFunctionIds: allowed.functionIds, functionId, seasonLabel, view: parsedView, viewDate: parsedViewDate, timeZone, today };
  }

  app.get('/download/season-calendar/ical', exportRateLimit, async (req, reply) => {
    const ctx = await resolveParams(req, reply);
    if (!ctx) return;

    const milestones = await fetchExportMilestones(
      ctx.seasonId, ctx.allowedBrandIds, ctx.session.user.id, prisma, ctx.timeZone, ctx.functionId, ctx.allowedFunctionIds
    );

    const icalString = generateIcal(
      milestones.map(m => ({
        id: m.id, title: m.title, description: m.description,
        startAt: m.startAt, endAt: m.endAt, allDay: m.allDay,
        cancelled: m.status === 'CANCELLED', brandCode: m.brandCode,
      })),
      `Luke · ${ctx.seasonLabel}`
    );

    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="luke-calendar-${ctx.seasonId}.ics"`)
      .send(icalString);
  });

  app.get('/download/season-calendar/pdf', exportRateLimit, async (req, reply) => {
    const ctx = await resolveParams(req, reply);
    if (!ctx) return;

    const milestones = await fetchExportMilestones(
      ctx.seasonId, ctx.allowedBrandIds, ctx.session.user.id, prisma, ctx.timeZone, ctx.functionId, ctx.allowedFunctionIds
    );

    let pdfBuffer: Buffer;
    if (ctx.view === 'week') {
      pdfBuffer = await generatePdfWeek(milestones, ctx.seasonLabel, ctx.viewDate, ctx.today);
    } else if (ctx.view === 'month') {
      pdfBuffer = await generatePdfMonth(milestones, ctx.seasonLabel, ctx.viewDate, ctx.today);
    } else if (ctx.view === 'gantt') {
      pdfBuffer = await generatePdfGantt(milestones, ctx.seasonLabel, ctx.today);
    } else {
      pdfBuffer = await generatePdf(milestones, ctx.seasonLabel, ctx.today);
    }

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="luke-calendar-${ctx.seasonId}.pdf"`)
      .send(pdfBuffer);
  });

  app.get('/download/season-calendar/xlsx', exportRateLimit, async (req, reply) => {
    const ctx = await resolveParams(req, reply);
    if (!ctx) return;

    const milestones = await fetchExportMilestones(
      ctx.seasonId, ctx.allowedBrandIds, ctx.session.user.id, prisma, ctx.timeZone, ctx.functionId, ctx.allowedFunctionIds
    );

    const xlsxBuffer = await generateXlsx(milestones, ctx.seasonLabel);

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="luke-calendar-${ctx.seasonId}.xlsx"`)
      .send(xlsxBuffer);
  });
});
