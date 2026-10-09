/**
 * The year filter of the holiday list required a holiday to start and end inside the year, so a
 * range from late December to early January belonged to neither year. The import writes single-day
 * rows only; the model allows ranges, which reach the table some other way.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
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
  const caller = createCallerWithSession(admin.session);
  namesIn = async year => (await caller.holidays.listHolidays({ countryCodes: ['ZZ'], year })).map(h => h.name);
});

describe('holidays.listHolidays — year', () => {
  it('keeps a holiday range that spans the turn of the year in both years', async () => {
    expect(await namesIn(2030)).toEqual(['Chiusura invernale']);
    expect(await namesIn(2031)).toEqual(['Chiusura invernale']);
    expect(await namesIn(2029)).toEqual(['Festa 2029']);
  });
});
