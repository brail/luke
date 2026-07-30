/**
 * Export del calendario stagionale.
 *
 * Le quattro viste PDF passavano da un `new PdfPrinter(...)` costruito a mano,
 * che non ereditava le access policy chiuse in `lib/export/pdf.ts` — e che dal
 * bump pdfmake 0.2→0.3 era comunque rotto: in 0.3 `createPdfKitDocument`
 * restituisce una Promise, non uno stream, quindi `doc.on(...)` lanciava (500 al
 * chiamante) e la Promise orfana rigettava con un TypeError non gestito, che i
 * guard di `server.ts` trasformano in `process.exit(1)`. Nessun test copriva la
 * rotta, quindi il guasto è passato inosservato: da qui la copertura per tutte e
 * quattro le viste, non solo per il default.
 */

import { randomUUID } from 'crypto';

import fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createToken } from '../src/lib/auth';
import seasonCalendarExportRoutes from '../src/routes/seasonCalendarExport.routes';

import { createTestUser, setupTestDb } from './helpers';

import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
let app: FastifyInstance;
let authHeader: string;
let seasonId: string;
let brandId: string;

beforeAll(async () => {
  prisma = await setupTestDb();

  const uid = randomUUID().substring(0, 6).toUpperCase();

  // Admin: `getUserAllowedBrandIds` restituisce `null`, così la rotta non filtra
  // via il brand e i generatori ricevono davvero delle milestone.
  const { user } = await createTestUser('admin');
  authHeader = `Bearer ${createToken({
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    tokenVersion: 0,
  })}`;

  const [brand, season] = await Promise.all([
    prisma.brand.create({
      data: { code: `CAL${uid}`, name: `Cal ${uid}`, isActive: true },
    }),
    prisma.season.create({
      data: { code: `C${uid}`, name: `Cal Season ${uid}`, year: 2032, isActive: true },
    }),
  ]);
  brandId = brand.id;
  seasonId = season.id;

  const calendar = await prisma.seasonCalendar.create({
    data: { brandId, seasonId },
  });
  const group = await prisma.planningGroup.create({
    data: { calendarId: calendar.id, name: `Cal Group ${uid}` },
  });
  await prisma.calendarEvent.create({
    data: {
      calendarId: calendar.id,
      planningGroupId: group.id,
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

describe('GET /season-calendar/export/pdf', () => {
  it.each(['list', 'week', 'month', 'gantt'])(
    'la vista %s produce un PDF valido',
    async view => {
      const res = await app.inject({
        method: 'GET',
        url: `/season-calendar/export/pdf?seasonId=${seasonId}&brandIds=${brandId}&view=${view}&viewDate=2032-03-01`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      // Il magic number, non la sola lunghezza: un body di errore serializzato
      // sarebbe comunque non vuoto.
      expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    }
  );

  it('senza Authorization risponde 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/season-calendar/export/pdf?seasonId=${seasonId}&brandIds=${brandId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
