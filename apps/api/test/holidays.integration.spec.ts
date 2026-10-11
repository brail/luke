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
