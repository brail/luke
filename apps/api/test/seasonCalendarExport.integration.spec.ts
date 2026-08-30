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

import fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createToken } from '../src/lib/auth';
import seasonCalendarExportRoutes from '../src/routes/seasonCalendarExport.routes';

import { createCalendarFixture, createTestUser, setupTestDb } from './helpers';

import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
let app: FastifyInstance;
let authHeader: string;
let seasonId: string;
let brandId: string;

beforeAll(async () => {
  prisma = await setupTestDb();

  // Admin: `getUserAllowedBrandIds` returns `null`, so the route doesn't filter
  // by brand and the generators actually receive milestones.
  const { user } = await createTestUser('admin');
  authHeader = `Bearer ${createToken({
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    tokenVersion: 0,
  })}`;

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

  app = fastify({ logger: false });
  await app.register(seasonCalendarExportRoutes, { prisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /download/season-calendar/pdf', () => {
  it.each(['list', 'week', 'month', 'gantt'])(
    'la vista %s produce un PDF valido',
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

  it('senza Authorization risponde 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/download/season-calendar/pdf?seasonId=${seasonId}&brandIds=${brandId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
