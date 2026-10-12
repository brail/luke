/**
 * The year filter of the holiday list required a holiday to start and end inside the year, so a
 * range from late December to early January belonged to neither year. The import writes single-day
 * rows only; the model allows ranges, which reach the table some other way.
 *
 * Vendor closures took instants for their `@db.Date` days, which only the dialog's UTC midnights
 * kept on the right day, and nothing stopped an end before the start. Their writes answered a
 * missing closure, vendor or season with a 500; the placeholder country and the closure were two
 * separate writes; an update found its row by id alone, so another vendor's id was edited; and
 * confirming overwrote an earlier confirmation and counted the ids sent.
 *
 * The Nager.Date import wrote one row at a time from days it never checked, so a malformed day was
 * stored as another (`Date` rolls 2031-02-30 over to March), and a country Nager.Date did not answer
 * was skipped without a word while the preview had dropped it too. Prefilling a vendor's closures
 * copied the holidays of every year, even for a season with a year.
 */

import { randomUUID } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

/** A vendor and a season of their own, and the fields of a closure between them. */
async function newClosure() {
  const uid = randomUUID().slice(0, 6);
  const [vendor, season] = await Promise.all([
    prisma.vendor.create({ data: { name: `Vendor ${uid}` } }),
    prisma.season.create({ data: { code: `VC${uid}`, name: `Closure Season ${uid}`, year: 2036, isActive: true } }),
  ]);
  return { vendorId: vendor.id, seasonId: season.id, countryCode: null, name: 'Ferie', type: 'CLOSURE' as const, startDate: '2026-08-10', endDate: '2026-08-21' };
}

describe('holidays.upsertVendorClosure — calendar days', () => {
  it('stores the days it is given and refuses an end before the start', async () => {
    const closure = await newClosure();

    const saved = await caller.holidays.upsertVendorClosure(closure);
    expect([saved.startDate.toISOString(), saved.endDate.toISOString()]).toEqual(['2026-08-10T00:00:00.000Z', '2026-08-21T00:00:00.000Z']);

    await expect(caller.holidays.upsertVendorClosure({ ...closure, startDate: '2026-08-21', endDate: '2026-08-10' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('vendor closures — writes', () => {
  it('refuses an id that no longer exists and keeps no country it would have added', async () => {
    const closure = await newClosure();

    const failure = await caller.holidays.upsertVendorClosure({ ...closure, id: randomUUID(), countryCode: 'QX' }).catch((e: unknown) => e);

    expect(await prisma.holidayCountry.findUnique({ where: { code: 'QX' } })).toBeNull();
    expect(failure).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updates a closure under its own vendor and season', async () => {
    const closure = await newClosure();
    const saved = await caller.holidays.upsertVendorClosure(closure);

    const updated = await caller.holidays.upsertVendorClosure({ ...closure, id: saved.id, name: 'Chiusura estiva', endDate: '2026-08-28' });
    expect(updated).toMatchObject({ id: saved.id, name: 'Chiusura estiva', endDate: new Date('2026-08-28T00:00:00.000Z') });
    expect(await prisma.auditLog.count({ where: { targetId: saved.id, action: 'VENDOR_CLOSURE_UPDATE' } })).toBe(1);
  });

  it("refuses to change a closure through another vendor or season", async () => {
    const [closure, other] = await Promise.all([newClosure(), newClosure()]);
    const saved = await caller.holidays.upsertVendorClosure(closure);

    for (const scope of [{ vendorId: other.vendorId }, { seasonId: other.seasonId }]) {
      await expect(caller.holidays.upsertVendorClosure({ ...closure, ...scope, id: saved.id, name: 'Altro' }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await prisma.vendorClosurePeriod.findUniqueOrThrow({ where: { id: saved.id } })).name).toBe('Ferie');
  });

  it('refuses a vendor or season that does not exist', async () => {
    const closure = await newClosure();

    for (const missing of [{ vendorId: randomUUID() }, { seasonId: randomUUID() }]) {
      await expect(caller.holidays.upsertVendorClosure({ ...closure, ...missing })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('refuses to prefill for a vendor that does not exist', async () => {
    const closure = await newClosure();

    await expect(caller.holidays.prefillVendorClosures({ vendorId: randomUUID(), seasonId: closure.seasonId, countryCodes: ['ZZ'] }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to delete a closure twice', async () => {
    const saved = await caller.holidays.upsertVendorClosure(await newClosure());
    await caller.holidays.deleteVendorClosure({ id: saved.id });

    await expect(caller.holidays.deleteVendorClosure({ id: saved.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('counts the closures it confirmed and keeps a confirmation a stale list repeats', async () => {
    const saved = await caller.holidays.upsertVendorClosure(await newClosure());
    expect(await caller.holidays.confirmVendorClosures({ ids: [saved.id, randomUUID()] })).toEqual({ confirmed: 1 });
    const { confirmedAt } = await prisma.vendorClosurePeriod.findUniqueOrThrow({ where: { id: saved.id } });

    expect(await caller.holidays.confirmVendorClosures({ ids: [saved.id] })).toEqual({ confirmed: 0 });
    expect((await prisma.vendorClosurePeriod.findUniqueOrThrow({ where: { id: saved.id } })).confirmedAt).toEqual(confirmedAt);
  });
});

/** Nager.Date answering each country with one holiday per day in `days`, 503 for `failing`, 404 for `unknown`. */
function stubNager(days: Record<string, string[]>, { failing = [], unknown = [] }: { failing?: string[]; unknown?: string[] } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const code = url.split('/').at(-1) ?? '';
    if (failing.includes(code)) return { ok: false, status: 503, json: async () => [] };
    if (unknown.includes(code)) return { ok: false, status: 404, json: async () => ({}) };
    const holidays = (days[code] ?? []).map((date, i) => ({ date, localName: `Festa ${i + 1}`, name: `Holiday ${i + 1}`, countryCode: code, fixed: true, global: true }));
    return { ok: true, status: 200, json: async () => holidays };
  }));
}

describe('holidays.confirmImport — Nager.Date days', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores each day at UTC midnight, once however often it is imported', async () => {
    stubNager({ XA: ['2031-01-01', '2031-04-25'] });
    expect(await caller.holidays.confirmImport({ countryCodes: ['XA'], year: 2031 })).toEqual({ imported: 2 });
    await caller.holidays.confirmImport({ countryCodes: ['XA'], year: 2031 });

    const rows = await prisma.holiday.findMany({ where: { countryCode: 'XA' }, orderBy: { startDate: 'asc' } });
    expect(rows.map(h => [h.startDate.toISOString(), h.endDate.toISOString()])).toEqual([
      ['2031-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z'],
      ['2031-04-25T00:00:00.000Z', '2031-04-25T00:00:00.000Z'],
    ]);
  });

  it('refuses a malformed day, and writes neither the holidays nor the country', async () => {
    stubNager({ XB: ['2031-01-06', '2031-02-30'] });
    await expect(caller.holidays.confirmImport({ countryCodes: ['XB'], year: 2031 }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('XB') });

    expect(await prisma.holiday.count({ where: { countryCode: 'XB' } })).toBe(0);
    expect(await prisma.holidayCountry.findUnique({ where: { code: 'XB' } })).toBeNull();
  });

  it('refuses the whole import, and its preview, when Nager.Date does not answer for one country', async () => {
    stubNager({ XC: ['2031-01-01'], XD: ['2031-01-01'] }, { failing: ['XD'] });
    for (const call of [caller.holidays.previewImport, caller.holidays.confirmImport]) {
      await expect(call({ countryCodes: ['XC', 'XD'], year: 2031 })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('XD') });
    }

    expect(await prisma.holiday.count({ where: { countryCode: { in: ['XC', 'XD'] } } })).toBe(0);
  });

  it('names a holiday by its English name when Nager.Date sends no local one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ date: '2031-01-01', localName: null, name: "New Year's Day" }] })));
    expect(await caller.holidays.previewImport({ countryCodes: ['XG'], year: 2031 })).toEqual([{ code: 'XG', name: "New Year's Day", nameEn: null, date: '2031-01-01' }]);
  });

  it('previews and imports no holidays for a country Nager.Date does not cover', async () => {
    stubNager({ XE: ['2031-01-01'] }, { unknown: ['XF'] });
    expect((await caller.holidays.previewImport({ countryCodes: ['XE', 'XF'], year: 2031 })).map(h => h.code)).toEqual(['XE']);
    expect(await caller.holidays.confirmImport({ countryCodes: ['XE', 'XF'], year: 2031 })).toEqual({ imported: 1 });
  });
});

describe('holidays.prefillVendorClosures — the season year', () => {
  beforeAll(async () => {
    await prisma.holidayCountry.upsert({ where: { code: 'XP' }, update: {}, create: { code: 'XP', name: 'Prefill' } });
    await prisma.holiday.createMany({
      data: [
        { countryCode: 'XP', name: 'Giugno 2034', startDate: new Date('2034-06-01'), endDate: new Date('2034-06-01') },
        { countryCode: 'XP', name: 'Giugno 2035', startDate: new Date('2035-06-01'), endDate: new Date('2035-06-01') },
        { countryCode: 'XP', name: 'Capodanno 2036', startDate: new Date('2035-12-31'), endDate: new Date('2036-01-01') },
        { countryCode: 'XP', name: 'Maggio 2036', startDate: new Date('2036-05-01'), endDate: new Date('2036-05-01') },
        { countryCode: 'XP', name: 'Capodanno 2037', startDate: new Date('2037-01-01'), endDate: new Date('2037-01-01') },
      ],
    });
  });

  /** The names of the closures prefilled for a new season of `year`. */
  async function prefilled(year: number | null) {
    const { vendorId, seasonId } = await newClosure();
    await prisma.season.update({ where: { id: seasonId }, data: { year } });
    await caller.holidays.prefillVendorClosures({ vendorId, seasonId, countryCodes: ['XP'] });
    return (await prisma.vendorClosurePeriod.findMany({ where: { vendorId, seasonId }, orderBy: { startDate: 'asc' } })).map(c => c.name);
  }

  it("copies the holidays overlapping the season's year and the one before, when its planning starts", async () => {
    expect(await prefilled(2036)).toEqual(['Giugno 2035', 'Capodanno 2036', 'Maggio 2036']);
  });

  it('copies the holidays of every year for a season without one, as NAV creates them', async () => {
    expect(await prefilled(null)).toEqual(['Giugno 2034', 'Giugno 2035', 'Capodanno 2036', 'Maggio 2036', 'Capodanno 2037']);
  });
});
