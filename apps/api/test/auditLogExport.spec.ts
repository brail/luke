/**
 * Every field of the audit log export reaches a spreadsheet as inert text: in the CSV no separator
 * inside a value can split it, whatever the reader splits on (#93); the XLSX holds every value as a
 * string cell (#113).
 */

import { PassThrough } from 'stream';
import { buffer } from 'stream/consumers';

import ExcelJS from 'exceljs';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuditLogFiltersSchema } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import {
  csvEscape,
  generateAuditLogCsv,
  registerAuditLogExportDownloadRoute,
  writeAuditLogXlsx,
} from '../src/routes/auditLogExportDownload';
import { signAuditLogExportToken } from '../src/utils/downloadToken';

/** A client whose audit log holds `events`, or answers through `findMany`. */
function prismaWith(events: object[] | (() => Promise<object[]>)): PrismaClient {
  const findMany = Array.isArray(events) ? vi.fn().mockResolvedValueOnce(events).mockResolvedValue([]) : events;
  // Only the two calls the generator makes; the rest of the client is never touched.
  return { auditLog: { findMany }, user: { findMany: async () => [] } } as unknown as PrismaClient;
}

const FORMULA_EVENT = {
  createdAt: new Date('2026-10-09T08:15:00.000Z'), actorId: null, actor: null, action: 'AUTH_LOGIN',
  targetType: '=1+1', targetId: '-1', result: 'FAILURE', ip: '@ip', metadata: { username: 'mario' },
};

/** `n` events like `FORMULA_EVENT`, each with the fields `at(i)` returns. */
function manyEvents(n: number, at: (i: number) => object): object[] {
  return Array.from({ length: n }, (_, i) => ({ ...FORMULA_EVENT, ...at(i) }));
}

/** The text of the first nine cells of `row`. */
function rowText(sheet: ExcelJS.Worksheet, row: number): string[] {
  return Array.from({ length: 9 }, (_, i) => sheet.getRow(row).getCell(i + 1).text);
}

describe('csvEscape', () => {
  it('prefixes an apostrophe to a value a spreadsheet would read as a formula', () => {
    expect(csvEscape('=1+1')).toBe(`"'=1+1"`);
    expect(csvEscape('+1')).toBe(`"'+1"`);
    expect(csvEscape('-1')).toBe(`"'-1"`);
    expect(csvEscape('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvEscape('\tx')).toBe(`"'\tx"`);
    expect(csvEscape('\rx')).toBe(`"'\rx"`);
  });

  it('quotes every value, doubling its quotes, and leaves its text unchanged', () => {
    expect(csvEscape('2026-10-09T08:15:00.000Z')).toBe('"2026-10-09T08:15:00.000Z"');
    expect(csvEscape('a,b;c\r\nd')).toBe('"a,b;c\r\nd"');
    expect(csvEscape('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(csvEscape('')).toBe('""');
  });
});

describe('generateAuditLogCsv', () => {
  it('passes every column of every event through csvEscape', async () => {
    const createdAt = new Date('2026-10-09T08:15:00.000Z');
    const events = [
      {
        // A failed login: no actor, the subject is the typed username.
        createdAt, actorId: null, actor: null, action: 'AUTH_LOGIN', targetType: '+User',
        targetId: '-1', result: 'FAILURE', ip: '@ip\rforged', metadata: { username: 'x;=1+1' },
      },
      {
        createdAt, actorId: 'u1', action: 'AUTH_LOGIN', targetType: 'User', targetId: 'u1',
        result: 'SUCCESS', ip: '127.0.0.1', metadata: null,
        actor: { firstName: '@Mario', lastName: 'Rossi', username: 'mario', email: '\tmario@example.com' },
      },
    ];
    const chunks: string[] = [];
    for await (const chunk of generateAuditLogCsv(prismaWith(events), {}, 'Europe/Rome')) chunks.push(chunk);

    expect(chunks.slice(1)).toEqual([
      `"2026-10-09T08:15:00.000Z","x;=1+1","","soggetto","Accesso effettuato","'+User","'-1","FAILURE","'@ip\rforged"\n`,
      `"2026-10-09T08:15:00.000Z","'@Mario Rossi","'\tmario@example.com","utente","Accesso effettuato","User","u1","SUCCESS","127.0.0.1"\n`,
    ]);
  });

  it("reads the filter's days in the zone the link was made for", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const filters = AuditLogFiltersSchema.parse({ dateFrom: '2026-10-09', dateTo: '2026-10-09' });

    for await (const _chunk of generateAuditLogCsv(prismaWith(findMany), filters, 'Pacific/Auckland'));

    // 9 October in Auckland (UTC+13 in daylight time) runs from 8 Oct 11:00Z to 9 Oct 11:00Z.
    expect(findMany.mock.calls[0]![0].where).toEqual({
      createdAt: { gte: new Date('2026-10-08T11:00:00.000Z'), lt: new Date('2026-10-09T11:00:00.000Z') },
    });
  });

  it('starts each batch after the last row read, not at an offset', async () => {
    const base = Date.parse('2026-10-09T08:00:00.000Z');
    const last = { createdAt: new Date(base - 499_000), id: 'id-499' };
    const findMany = vi.fn()
      .mockResolvedValueOnce(manyEvents(500, i => ({ createdAt: new Date(base - i * 1000), id: `id-${i}` })))
      .mockResolvedValue([]);

    for await (const _chunk of generateAuditLogCsv(prismaWith(findMany), { result: 'SUCCESS' }, 'Europe/Rome'));

    const second = findMany.mock.calls[1]![0];
    expect(second).not.toHaveProperty('skip');
    expect(second.where).toEqual({
      AND: [
        { result: 'SUCCESS' },
        {
          createdAt: { lte: last.createdAt },
          OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }],
        },
      ],
    });
  });
});

describe('writeAuditLogXlsx', () => {
  it('writes the CSV columns as string cells under a frozen header', async () => {
    const out = new PassThrough();
    const bytes = buffer(out);
    await writeAuditLogXlsx(prismaWith([FORMULA_EVENT]), {}, 'Europe/Rome', out);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(await bytes).buffer);
    const sheet = workbook.getWorksheet('Audit Log')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(rowText(sheet, 1)).toEqual(['Data/Ora (UTC)', 'Autore', 'Email', 'Attribuzione', 'Azione', 'Entità', 'ID Entità', 'Esito', 'IP']);
    expect(rowText(sheet, 2)).toEqual([
      '2026-10-09T08:15:00.000Z', 'mario', '', 'soggetto', 'Accesso effettuato', '=1+1', '-1', 'FAILURE', '@ip',
    ]);
    expect(sheet.getRow(2).getCell(6).type).toBe(ExcelJS.ValueType.String);
  });

  it('reads no further while the client takes nothing, and stops once it goes away', async () => {
    // Counted when a read starts, not when it returns: a read already in flight when the client
    // leaves still completes, and under load it did so after the snapshot below. Only a read that
    // starts afterwards means the export went on.
    let started = 0;
    const prisma = prismaWith(async () => {
      const batch = ++started;
      await new Promise(resolve => setTimeout(resolve, 5)); // a database round trip
      return batch > 20 ? [] : manyEvents(500, i => ({
        id: `${batch}-${i}`, targetId: crypto.randomUUID(), ip: crypto.randomUUID(),
      }));
    });
    const out = new PassThrough(); // never read: a client that has stopped downloading

    const written = writeAuditLogXlsx(prisma, {}, 'Europe/Rome', out);
    await new Promise(resolve => setTimeout(resolve, 300));
    const startedBeforeLeaving = started;
    out.destroy();
    await written;

    expect(startedBeforeLeaving).toBeLessThan(20);
    expect(started).toBe(startedBeforeLeaving);
  });
});

describe('/download/audit-log', () => {
  async function get(url: string) {
    const app = Fastify();
    await registerAuditLogExportDownloadRoute(app, prismaWith([FORMULA_EVENT]));
    return app.inject({ method: 'GET', url });
  }
  const token = () => encodeURIComponent(signAuditLogExportToken({ filters: {}, timeZone: 'Europe/Rome' }));

  it('refuses a link without a valid token', async () => {
    expect((await get('/download/audit-log?format=xlsx&token=forged')).statusCode).toBe(401);
  });

  it('refuses a format it does not serve', async () => {
    expect((await get(`/download/audit-log?format=pdf&token=${token()}`)).statusCode).toBe(400);
  });

  it('serves the XLSX when asked and the CSV by default', async () => {
    const xlsx = await get(`/download/audit-log?format=xlsx&token=${token()}`);
    expect(xlsx.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(xlsx.headers['content-disposition']).toMatch(/\.xlsx"$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(xlsx.rawPayload).buffer);
    expect(rowText(workbook.getWorksheet('Audit Log')!, 2)[5]).toBe('=1+1');

    const csv = await get(`/download/audit-log?token=${token()}`);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.body).toContain(`"'=1+1"`);
  });
});
