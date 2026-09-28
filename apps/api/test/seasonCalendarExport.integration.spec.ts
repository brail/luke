/**
 * Season calendar export.
 *
 * The four PDF views used to go through a hand-built `new PdfPrinter(...)`,
 * which didn't inherit the access policies locked down in `lib/export/pdf.ts`
 * — and which, since the pdfmake 0.2→0.3 bump, was broken anyway: in 0.3
 * `createPdfKitDocument` returns a Promise, not a stream, so `doc.on(...)`
 * threw (500 to the caller) and the orphaned Promise rejected with an
 * unhandled TypeError, which the guards in `server.ts` turn into
 * `process.exit(1)`. No test covered the route, so the breakage went
 * unnoticed: hence the coverage for all four views, not just the default one.
 */

import ExcelJS from 'exceljs';
import fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createToken } from '../src/lib/auth';
import seasonCalendarExportRoutes from '../src/routes/seasonCalendarExport.routes';

import { createCalendarFixture, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let app: FastifyInstance;
let authHeader: string;
let seasonId: string;
let brandId: string;

/**
 * An admin reading in `timeZone`. Admin: `getUserAllowedBrandIds` returns `null`, so the route
 * doesn't filter by brand and the generators actually receive milestones.
 */
async function adminIn(timeZone: string): Promise<string> {
  const { user } = await createTestUser('admin');
  await prisma.user.update({ where: { id: user.id }, data: { timezone: timeZone } });
  return `Bearer ${createToken({ id: user.id, email: user.email, username: user.username, role: user.role, tokenVersion: 0 })}`;
}

beforeAll(async () => {
  prisma = await setupTestDb();

  authHeader = await adminIn('Europe/Rome');

  const fixture = await createCalendarFixture(prisma, { prefix: 'CAL', year: 2032 });
  brandId = fixture.brandId;
  seasonId = fixture.seasonId;

  await prisma.calendarEvent.create({
    data: {
      calendarId: fixture.calendarId,
      planningGroupId: fixture.planningGroupId,
      title: 'Milestone di export',
      startAt: new Date('2032-03-01'),
      endAt: new Date('2032-03-05'),
    },
  });
  await prisma.calendarEvent.createMany({
    data: [
      // 20:00Z: 05:00 on March 2 in Tokyo, 21:00 on March 1 in Rome.
      { title: 'Evento serale', startAt: new Date('2032-03-01T20:00:00Z'), allDay: false },
      { title: 'Giornata intera', startAt: new Date('2032-03-05T00:00:00Z'), allDay: true },
      // Ends at local midnight in Rome (CET, UTC+1).
      { title: 'Fino a mezzanotte', startAt: new Date('2032-03-10T09:00:00Z'), endAt: new Date('2032-03-10T23:00:00Z'), allDay: false },
    ].map(event => ({ ...event, calendarId: fixture.calendarId, planningGroupId: fixture.planningGroupId })),
  });

  app = fastify({ logger: false });
  await app.register(seasonCalendarExportRoutes, { prisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /download/season-calendar/pdf', () => {
  it.each(['list', 'week', 'month', 'gantt'])(
    'the %s view produces a valid PDF',
    async view => {
      const res = await app.inject({
        method: 'GET',
        url: `/download/season-calendar/pdf?seasonId=${seasonId}&brandIds=${brandId}&view=${view}&viewDate=2032-03-01`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      // The magic number, not just the length: a serialized error body
      // would still be non-empty.
      expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    }
  );

  it('refuses a viewDate that is not a calendar date', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/download/season-calendar/pdf?seasonId=${seasonId}&brandIds=${brandId}&view=week&viewDate=2032-02-30`,
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(400);
  });

  it('without Authorization it responds 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/download/season-calendar/pdf?seasonId=${seasonId}&brandIds=${brandId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /download/season-calendar/xlsx — dates in the requester\'s zone', () => {
  /** Start and end cells by milestone title, as the requester reading in `timeZone` gets them. */
  async function datesFor(timeZone: string): Promise<Map<string, [string, string]>> {
    const res = await app.inject({
      method: 'GET',
      url: `/download/season-calendar/xlsx?seasonId=${seasonId}&brandIds=${brandId}`,
      headers: { authorization: await adminIn(timeZone) },
    });
    expect(res.statusCode).toBe(200);
    const workbook = new ExcelJS.Workbook();
    // ExcelJS types its input as its own `Buffer extends ArrayBuffer`: hand it a plain ArrayBuffer.
    await workbook.xlsx.load(Uint8Array.from(res.rawPayload).buffer);
    const rows = new Map<string, [string, string]>();
    workbook.worksheets[0]?.eachRow((row, index) => {
      if (index > 2) rows.set(String(row.getCell(3).value), [String(row.getCell(1).value), String(row.getCell(2).value)]);
    });
    return rows;
  }

  it('dates a timed event on the day it falls on for the requester', async () => {
    expect((await datesFor('Asia/Tokyo')).get('Evento serale')?.[0]).toBe('02/03/2032');
    expect((await datesFor('Europe/Rome')).get('Evento serale')?.[0]).toBe('01/03/2032');
  });

  it('dates an all-day event as its stored date for a requester west of UTC', async () => {
    expect((await datesFor('America/Los_Angeles')).get('Giornata intera')).toEqual(['05/03/2032', '']);
  });

  it('does not stretch a timed event that ends at local midnight into the next day', async () => {
    expect((await datesFor('Europe/Rome')).get('Fino a mezzanotte')).toEqual(['10/03/2032', '10/03/2032']);
  });
});
