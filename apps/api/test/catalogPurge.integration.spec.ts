/**
 * Purging a test brand or season deletes it with everything under it, in one transaction: only an
 * inactive, NAV-free entity, by an admin who types its name. Stored files and Google copies go after
 * the commit, and a failure there leaves the purge done; revision pictures stay. References from
 * outside the subtree refuse it, and a restore racing it wins.
 */

import { randomUUID } from 'crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createRevision } from '../src/services/collectionLayoutRevision.service';
import { resetStorageProvider } from '../src/storage';

import { createCalendarFixture, createCallerAs, createTestUser, setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';
import { seedLocalStorageConfig } from './helpers/storageTestHelper';

// Real local storage on a temp directory and a real audit failure (a trigger), not module mocks:
// `appRouter` is loaded by a setup file before this file's `vi.mock` could apply (see
// `brandLogo.service.integration.spec.ts`). Google is not configured here, so its clean-up is a
// no-op; `catalogPurgeCleanup.spec.ts` covers it.

let prisma: PrismaClient;
let adminId: string;
let basePath: string;

beforeAll(async () => {
  prisma = await setupTestDb();
  adminId = (await createTestUser('admin')).user.id;
});

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), 'luke-purge-'));
  await prisma.appConfig.deleteMany({ where: { key: { startsWith: 'storage.' } } });
  await seedLocalStorageConfig(prisma, basePath);
});

afterEach(async () => {
  await prisma.appConfig.deleteMany({ where: { key: { startsWith: 'storage.' } } });
  resetStorageProvider();
  await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function store(bucket: string, key: string) {
  const path = join(basePath, bucket, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'x');
}
const stored = (bucket: string, key: string) =>
  access(join(basePath, bucket, key)).then(() => true, () => false);

const parameterSet = (brandId: string, seasonId: string) =>
  prisma.pricingParameterSet.create({
    data: {
      brandId, seasonId, name: `Set ${randomUUID().slice(0, 4)}`, purchaseCurrency: 'USD', sellingCurrency: 'EUR',
      countryCode: 'CN', qualityControlPercent: 0, transportInsuranceCost: 0, duty: 0, exchangeRate: 1,
      italyAccessoryCosts: 0, tools: 0, retailMultiplier: 2, optimalMargin: 52,
    },
  });

/** An inactive test brand and season with one of everything a purge deletes under them. */
async function tree() {
  const uid = randomUUID().slice(0, 6);
  const calendar = await createCalendarFixture(prisma, { prefix: 'PG' });
  const { brandId, seasonId, calendarId, planningGroupId } = calendar;
  const set = await parameterSet(brandId, seasonId);
  const layout = await prisma.collectionLayout.create({ data: { brandId, seasonId } });
  const group = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'Borse' } });
  const row = await prisma.collectionLayoutRow.create({
    data: {
      collectionLayoutId: layout.id, groupId: group.id, planningGroupId, gender: 'MAN', line: 'Tote',
      status: 'NEW', productCategory: 'TEST', pictureKey: `row-${uid}.jpg`,
    },
  });
  await prisma.collectionRowQuotation.create({ data: { rowId: row.id, pricingParameterSetId: set.id } });
  await createRevision(
    { collectionLayoutId: layout.id, revisionTypeValue: 'NUMERAZIONE', cause: 'MANUAL' },
    adminId,
    async key => `rev-${key}`,
    prisma
  );
  const event = await prisma.calendarEvent.create({
    data: { calendarId, planningGroupId, title: 'Gate', startAt: new Date('2099-03-01'), allDay: true },
  });
  const fn = await prisma.companyFunction.create({ data: { slug: `purge_${uid}`, name: `Purge ${uid}` } });
  await prisma.googleCalendarBinding.create({
    data: { seasonCalendarId: calendarId, companyFunctionId: fn.id, googleCalendarId: `gcal-${uid}`, isProvisioned: true },
  });
  await prisma.googleEventMapping.create({
    data: {
      eventId: event.id, companyFunctionId: fn.id, googleEventId: `gev-${uid}`, googleCalendarId: `gcal-${uid}`,
      contentHash: 'h', lastSyncedAt: new Date(),
    },
  });
  const plan = await prisma.merchandisingPlan.create({ data: { brandId, seasonId } });
  const merchRow = await prisma.merchandisingPlanRow.create({
    data: {
      planId: plan.id, pricingParameterSetId: set.id, articleCode: 'A1', styleDescription: 'S', colorCode: 'C',
      colorDescription: 'Black', gender: 'MAN', productCategory: 'TEST',
    },
  });
  const specsheet = await prisma.merchandisingSpecsheet.create({ data: { rowId: merchRow.id } });
  await prisma.merchandisingImage.create({ data: { specsheetId: specsheet.id, key: `img-${uid}.jpg` } });
  await prisma.editLock.create({
    data: { entityType: 'COLLECTION_LAYOUT', entityId: layout.id, lockedByUserId: adminId, expiresAt: new Date(Date.now() + 60_000) },
  });
  await Promise.all([
    store('collection-row-pictures', `row-${uid}.jpg`),
    store('collection-row-pictures-revisions', `rev-row-${uid}.jpg`),
    store('merchandising-specsheet-images', `img-${uid}.jpg`),
    store('brand-logos', `logo-${uid}.png`),
  ]);
  const [brand, season] = await Promise.all([
    prisma.brand.update({ where: { id: brandId }, data: { isActive: false, logoKey: `logo-${uid}.png` } }),
    prisma.season.update({ where: { id: seasonId }, data: { isActive: false } }),
  ]);
  return { brand, season, layoutId: layout.id, calendarId, planningGroupId, planId: plan.id, uid };
}

type Tree = Awaited<ReturnType<typeof tree>>;

const asAdmin = () => createCallerAs('admin');

describe.each(['brand', 'season'] as const)('%s.purge', kind => {
  const target = (t: Tree) => (kind === 'brand' ? t.brand : t.season);
  const purgeAs = async (t: Tree, confirmName = target(t).name) =>
    (await asAdmin())[kind].purge({ id: target(t).id, confirmName });
  const exists = (t: Tree) =>
    kind === 'brand' ? prisma.brand.count({ where: { id: t.brand.id } }) : prisma.season.count({ where: { id: t.season.id } });

  it('previews what it deletes, the other dimension it spans and the revision pictures kept', async () => {
    const t = await tree();

    const preview = await (await asAdmin())[kind].purgePreview({ id: target(t).id });

    expect(preview).toMatchObject({
      name: target(t).name,
      counts: {
        layouts: 1, groups: 1, rows: 1, quotations: 1, revisions: 1, calendars: 1, events: 1,
        merchandisingPlans: 1, merchandisingRows: 1, parameterSets: 1,
      },
      involved: [kind === 'brand' ? t.season.name : t.brand.name],
      keptPictureReferences: 1,
      outside: { rows: 0, events: 0, quotations: 0, merchandisingRows: 0 },
    });
  });

  it('deletes everything under it, then its files and Google copies, and records one audit entry', async () => {
    const t = await tree();

    await expect(purgeAs(t)).resolves.toMatchObject({ deletedCounts: { layouts: 1, rows: 1, events: 1 }, keptPictureReferences: 1 });

    expect(await exists(t)).toBe(0);
    const [layouts, revisions, calendars, plans, sets, events, mappings, bindings, locks] = await Promise.all([
      prisma.collectionLayout.count({ where: { id: t.layoutId } }),
      prisma.collectionLayoutRevision.count({ where: { collectionLayoutId: t.layoutId } }),
      prisma.seasonCalendar.count({ where: { id: t.calendarId } }),
      prisma.merchandisingPlan.count({ where: { id: t.planId } }),
      prisma.pricingParameterSet.count({ where: { brandId: t.brand.id } }),
      prisma.calendarEvent.count({ where: { calendarId: t.calendarId } }),
      prisma.googleEventMapping.count({ where: { googleCalendarId: `gcal-${t.uid}` } }),
      prisma.googleCalendarBinding.count({ where: { seasonCalendarId: t.calendarId } }),
      prisma.editLock.count({ where: { entityId: t.layoutId } }),
    ]);
    expect([layouts, revisions, calendars, plans, sets, events, mappings, bindings, locks]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);

    expect(await stored('collection-row-pictures', `row-${t.uid}.jpg`)).toBe(false);
    expect(await stored('merchandising-specsheet-images', `img-${t.uid}.jpg`)).toBe(false);
    expect(await stored('brand-logos', `logo-${t.uid}.png`)).toBe(kind === 'season');
    expect(await stored('collection-row-pictures-revisions', `rev-row-${t.uid}.jpg`)).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: kind === 'brand' ? 'BRAND_PURGE' : 'SEASON_PURGE', targetId: target(t).id } });
    expect(audit.metadata).toMatchObject({ name: target(t).name, deletedCounts: { layouts: 1, rows: 1 }, keptPictureReferences: 1 });
  });

  it('refuses an active entity, a NAV-linked one and a wrong name, and deletes nothing', async () => {
    const t = await tree();
    await expect(purgeAs(t, `${target(t).name} x`)).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const navCode = `N${t.uid}`;
    if (kind === 'brand') {
      await prisma.navBrand.create({ data: { navCode, syncedAt: new Date() } });
      await prisma.brand.update({ where: { id: t.brand.id }, data: { navBrandId: navCode } });
    } else {
      await prisma.navSeason.create({ data: { navCode, syncedAt: new Date() } });
      await prisma.season.update({ where: { id: t.season.id }, data: { navSeasonId: navCode } });
    }
    await expect(purgeAs(t)).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const t2 = await tree();
    if (kind === 'brand') await prisma.brand.update({ where: { id: t2.brand.id }, data: { isActive: true } });
    else await prisma.season.update({ where: { id: t2.season.id }, data: { isActive: true } });
    await expect(purgeAs(t2)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect(await exists(t)).toBe(1);
    expect(await prisma.collectionLayout.count({ where: { id: { in: [t.layoutId, t2.layoutId] } } })).toBe(2);
    expect(await stored('collection-row-pictures', `row-${t.uid}.jpg`)).toBe(true);
  });

  it('is admin only, preview included', async () => {
    const t = await tree();
    const editor = await createCallerAs('editor');

    await expect(editor[kind].purgePreview({ id: target(t).id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(editor[kind].purge({ id: target(t).id, confirmName: target(t).name })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await exists(t)).toBe(1);
  });

  it('deletes nothing when its audit entry cannot be written', async () => {
    const t = await tree();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION refuse_purge_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit unavailable'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER refuse_purge_audit BEFORE INSERT ON audit_logs FOR EACH ROW
      WHEN (NEW.action LIKE '%_PURGE') EXECUTE FUNCTION refuse_purge_audit()`);
    try {
      await expect(purgeAs(t)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER refuse_purge_audit ON audit_logs');
      await prisma.$executeRawUnsafe('DROP FUNCTION refuse_purge_audit()');
    }

    expect(await exists(t)).toBe(1);
    expect(await prisma.collectionLayout.count({ where: { id: t.layoutId } })).toBe(1);
    expect(await stored('collection-row-pictures', `row-${t.uid}.jpg`)).toBe(true);
  });

  it('stays done when storage fails after the commit', async () => {
    const t = await tree();
    await prisma.appConfig.update({ where: { key: 'storage.type' }, data: { value: 'unknown' } });
    resetStorageProvider();

    await expect(purgeAs(t)).resolves.toMatchObject({ deletedCounts: { layouts: 1 } });
    expect(await exists(t)).toBe(0);
    expect(await stored('collection-row-pictures', `row-${t.uid}.jpg`)).toBe(true);
  });

  it('loses to a restore that holds the row first', async () => {
    const t = await tree();
    const table = kind === 'brand' ? 'brands' : 'seasons';

    const outcome = await whileHeld(
      holder => holder.query(`UPDATE ${table} SET "isActive" = true WHERE id = $1`, [target(t).id]),
      () => purgeAs(t)
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'PRECONDITION_FAILED' } });
    expect(await prisma.collectionLayout.count({ where: { id: t.layoutId } })).toBe(1);
  });

  it('refuses while data outside it uses its planning groups, and keeps a file another record names', async () => {
    const t = await tree();
    const other = await createCalendarFixture(prisma, { prefix: 'PO' });
    const outsideLayout = await prisma.collectionLayout.create({ data: { brandId: other.brandId, seasonId: other.seasonId } });
    const outsideGroup = await prisma.collectionGroup.create({ data: { collectionLayoutId: outsideLayout.id, name: 'Fuori' } });
    const outsideRow = await prisma.collectionLayoutRow.create({
      data: {
        collectionLayoutId: outsideLayout.id, groupId: outsideGroup.id, planningGroupId: t.planningGroupId,
        gender: 'MAN', line: 'Shared', status: 'NEW', productCategory: 'TEST', pictureKey: `row-${t.uid}.jpg`,
      },
    });

    await expect(purgeAs(t)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining('righe 1') });
    expect(await exists(t)).toBe(1);

    await prisma.collectionLayoutRow.update({ where: { id: outsideRow.id }, data: { planningGroupId: other.planningGroupId } });
    await purgeAs(t);

    expect(await stored('collection-row-pictures', `row-${t.uid}.jpg`)).toBe(true);
    expect(await stored('merchandising-specsheet-images', `img-${t.uid}.jpg`)).toBe(false);
  });
});

it('takes a layout created for the brand while it waits, with the rest', async () => {
  const t = await tree();
  const season = await prisma.season.create({ data: { code: `PW${t.uid}`, name: `Wait ${t.uid}` } });

  const outcome = await whileHeld(
    holder => holder.query(
      `INSERT INTO collection_layouts (id, "brandId", "seasonId", "updatedAt") VALUES ($1, $2, $3, now())`,
      [randomUUID(), t.brand.id, season.id]
    ),
    async () => (await asAdmin()).brand.purge({ id: t.brand.id, confirmName: t.brand.name })
  );

  expect(outcome).toMatchObject({ status: 'fulfilled', value: { deletedCounts: { layouts: 2 } } });
  expect(await prisma.collectionLayout.count({ where: { brandId: t.brand.id } })).toBe(0);
});
