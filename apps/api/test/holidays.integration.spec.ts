/**
 * The year filter of the holiday list required a holiday to start and end inside the year, so a
 * range from late December to early January belonged to neither year. The import writes single-day
 * rows only; the model allows ranges, which reach the table some other way.
 *
 * Vendor closures took instants for their `@db.Date` days, which only the dialog's UTC midnights
 * kept on the right day, and nothing stopped an end before the start.
 */

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let caller: ReturnType<typeof createCallerWithSession>;
let namesIn: (year: number) => Promise<string[]>;

beforeAll(async () => {
  prisma = await setupTestDb();
  const admin = await createTestUser('admin');
  await prisma.holidayCountry.upsert({ where: { code: 'ZZ' }, update: {}, create: { code: 'ZZ', name: 'Test' } });
  await prisma.holiday.createMany({
    data: [
      { countryCode: 'ZZ', name: 'Chiusura invernale', startDate: new Date('2030-12-28'), endDate: new Date('2031-01-03') },
      { countryCode: 'ZZ', name: 'Festa 2029', startDate: new Date('2029-06-02'), endDate: new Date('2029-06-02') },
    ],
  });
  caller = createCallerWithSession(admin.session);
  namesIn = async year => (await caller.holidays.listHolidays({ countryCodes: ['ZZ'], year })).map(h => h.name);
});

describe('holidays.listHolidays — year', () => {
  it('keeps a holiday range that spans the turn of the year in both years', async () => {
    expect(await namesIn(2030)).toEqual(['Chiusura invernale']);
    expect(await namesIn(2031)).toEqual(['Chiusura invernale']);
    expect(await namesIn(2029)).toEqual(['Festa 2029']);
  });
});

describe('holidays.upsertVendorClosure — calendar days', () => {
  it('stores the days it is given and refuses an end before the start', async () => {
    const uid = randomUUID().slice(0, 6);
    const [vendor, season] = await Promise.all([
      prisma.vendor.create({ data: { name: `Vendor ${uid}` } }),
      prisma.season.create({ data: { code: `VC${uid}`, name: `Closure Season ${uid}`, year: 2036, isActive: true } }),
    ]);
    const closure = { vendorId: vendor.id, seasonId: season.id, countryCode: null, name: 'Ferie', type: 'CLOSURE' as const };

    const saved = await caller.holidays.upsertVendorClosure({ ...closure, startDate: '2026-08-10', endDate: '2026-08-21' });
    expect([saved.startDate.toISOString(), saved.endDate.toISOString()]).toEqual(['2026-08-10T00:00:00.000Z', '2026-08-21T00:00:00.000Z']);

    await expect(caller.holidays.upsertVendorClosure({ ...closure, startDate: '2026-08-21', endDate: '2026-08-10' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
