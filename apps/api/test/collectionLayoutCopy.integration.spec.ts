/**
 * Copy from season with a row selection: the copy dialog sends the rows to bring over and, for
 * each, whether its quotations come too. A selected id outside the source used to be skipped in
 * silence — a partial or empty layout reported as copied, after which a retry met CONFLICT.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getOrCreateCalendar, resolveDefaultPlanningGroupId } from '../src/services/seasonCalendar.service';

import { createCalendarFixture, createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let asAdmin: ReturnType<typeof createCallerWithSession>;
let brandId: string;
let sourceSeasonId: string;
const rowIds: string[] = [];

/** A fresh target season for each copy: the copy creates the target layout. */
async function newSeason(): Promise<string> {
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const season = await prisma.season.create({
    data: { code: `T${uid}`, name: `Target ${uid}`, year: 2032, isActive: true },
  });
  return season.id;
}

function copyTo(toSeasonId: string, rows: { id: string; copyQuotations: boolean }[]) {
  return asAdmin.collectionLayout.copyFromSeason({
    fromBrandId: brandId,
    fromSeasonId: sourceSeasonId,
    toBrandId: brandId,
    toSeasonId,
    rows,
  });
}

function targetLayout(seasonId: string) {
  return prisma.collectionLayout.findUnique({ where: { brandId_seasonId: { brandId, seasonId } } });
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const admin = await createTestUser('admin');
  asAdmin = createCallerWithSession(admin.session);

  const brand = await prisma.brand.create({
    data: { code: `CP${uid}`, name: `Copy ${uid}`, isActive: true },
  });
  brandId = brand.id;
  sourceSeasonId = await newSeason();

  const layout = await asAdmin.collectionLayout.getOrCreate({
    brandId,
    seasonId: sourceSeasonId,
    availableGenders: ['MAN'],
  });
  const group = await asAdmin.collectionLayout.groups.create({
    collectionLayoutId: layout.id,
    data: { name: 'Borse', order: 0 },
  });
  for (const line of ['Tote', 'Clutch', 'Zaino']) {
    const row = await asAdmin.collectionLayout.rows.create({
      groupId: group.id,
      gender: 'MAN',
      line,
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });
    await asAdmin.collectionLayout.quotations.create({ rowId: row.id });
    rowIds.push(row.id);
  }
});

describe('collectionLayout.copyFromSeason — row selection', () => {
  it('copies only the rows chosen, with quotations only where asked', async () => {
    const target = await newSeason();
    const copy = await copyTo(target, [
      { id: rowIds[0], copyQuotations: false },
      { id: rowIds[2], copyQuotations: true },
    ]);

    const rows = await prisma.collectionLayoutRow.findMany({
      where: { collectionLayoutId: copy.id },
      select: { line: true, _count: { select: { quotations: true } } },
      orderBy: { line: 'asc' },
    });
    expect(rows).toEqual([
      { line: 'Tote', _count: { quotations: 0 } },
      { line: 'Zaino', _count: { quotations: 1 } },
    ]);
  });

  it('refuses a row that is not in the source, and creates nothing', async () => {
    const target = await newSeason();

    await expect(
      copyTo(target, [
        { id: rowIds[0], copyQuotations: true },
        { id: randomUUID(), copyQuotations: true },
      ])
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await targetLayout(target)).toBeNull();
  });

  it('refuses a row selected twice, and creates nothing', async () => {
    const target = await newSeason();

    await expect(
      copyTo(target, [
        { id: rowIds[0], copyQuotations: false },
        { id: rowIds[0], copyQuotations: true },
      ])
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await targetLayout(target)).toBeNull();
  });

  it('refuses an empty selection, and creates nothing', async () => {
    const target = await newSeason();

    await expect(copyTo(target, [])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await targetLayout(target)).toBeNull();
  });
});

describe('collectionLayout.copyFromSeason — into the target season', () => {
  /** A brand with a source season, its calendar and a planning group; each test copies into a fresh target season. */
  async function fixture() {
    const calendar = await createCalendarFixture(prisma, { prefix: 'CR' });
    const layout = await prisma.collectionLayout.create({
      data: { brandId: calendar.brandId, seasonId: calendar.seasonId, skuBudget: 40, hiddenColumns: ['notes'] },
    });
    const group = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'Borse', skuBudget: 12 } });
    return { ...calendar, layoutId: layout.id, groupId: group.id };
  }
  const parameterSet = (brandId: string, seasonId: string, name: string, purchaseCurrency: string) =>
    prisma.pricingParameterSet.create({
      data: {
        brandId, seasonId, name, purchaseCurrency, sellingCurrency: 'EUR', countryCode: 'CN',
        qualityControlPercent: 0, transportInsuranceCost: 0, duty: 0, exchangeRate: 1,
        italyAccessoryCosts: 0, tools: 0, retailMultiplier: 2, optimalMargin: 52,
      },
    });
  const rowData = (source: Awaited<ReturnType<typeof fixture>>, planningGroupId: string, line: string) => ({
    collectionLayoutId: source.layoutId, groupId: source.groupId, planningGroupId,
    gender: 'MAN', line, status: COLLECTION_STATUS[0], productCategory: 'TEST',
  });
  const copyAll = (source: Awaited<ReturnType<typeof fixture>>, toSeasonId: string) =>
    asAdmin.collectionLayout.copyFromSeason({
      fromBrandId: source.brandId, fromSeasonId: source.seasonId, toBrandId: source.brandId, toSeasonId,
    });

  it('maps planning groups and parameter sets by name, and keeps an amount only in its own currency', async () => {
    const source = await fixture();
    const target = await newSeason();
    const [spring, onlySource] = await Promise.all([
      prisma.planningGroup.create({ data: { calendarId: source.calendarId, name: 'Primavera' } }),
      prisma.planningGroup.create({ data: { calendarId: source.calendarId, name: 'Solo origine' } }),
    ]);
    const targetCalendar = await prisma.seasonCalendar.create({ data: { brandId: source.brandId, seasonId: target } });
    const targetSpring = await prisma.planningGroup.create({ data: { calendarId: targetCalendar.id, name: 'Primavera' } });
    const [pelle, tessuto] = await Promise.all([
      parameterSet(source.brandId, source.seasonId, 'Pelle', 'USD'),
      parameterSet(source.brandId, source.seasonId, 'Tessuto', 'USD'),
    ]);
    const [targetPelle, targetTessuto] = await Promise.all([
      parameterSet(source.brandId, target, 'Pelle', 'USD'),
      parameterSet(source.brandId, target, 'Tessuto', 'EUR'),
    ]);
    const tote = await prisma.collectionLayoutRow.create({ data: rowData(source, spring.id, 'Tote') });
    await prisma.collectionLayoutRow.create({ data: rowData(source, onlySource.id, 'Clutch') });
    await prisma.collectionRowQuotation.createMany({
      data: [
        { rowId: tote.id, order: 0, pricingParameterSetId: pelle.id, supplierQuotation: 100, retailPrice: 300 },
        { rowId: tote.id, order: 1, pricingParameterSetId: tessuto.id, supplierQuotation: 80, retailPrice: 250 },
      ],
    });

    const copy = await copyAll(source, target);

    const rows = await prisma.collectionLayoutRow.findMany({
      where: { collectionLayoutId: copy.id },
      select: { line: true, planningGroup: { select: { id: true, isDefault: true } } },
      orderBy: { line: 'asc' },
    });
    expect(rows).toEqual([
      { line: 'Clutch', planningGroup: { id: expect.any(String), isDefault: true } },
      { line: 'Tote', planningGroup: { id: targetSpring.id, isDefault: false } },
    ]);
    const quotations = await prisma.collectionRowQuotation.findMany({
      where: { row: { collectionLayoutId: copy.id } },
      select: { pricingParameterSetId: true, supplierQuotation: true, retailPrice: true },
      orderBy: { order: 'asc' },
    });
    expect(quotations).toEqual([
      { pricingParameterSetId: targetPelle.id, supplierQuotation: 100, retailPrice: 300 },
      { pricingParameterSetId: targetTessuto.id, supplierQuotation: null, retailPrice: 250 },
    ]);
  });

  it('maps the default group to the default group, never by name (#128)', async () => {
    const source = await fixture();
    const target = await newSeason();
    const sourceDefault = await resolveDefaultPlanningGroupId(source.brandId, source.seasonId, prisma);
    const sourceNamed = await prisma.planningGroup.create({ data: { calendarId: source.calendarId, name: 'Predefinito' } });
    const targetCalendar = await prisma.seasonCalendar.create({ data: { brandId: source.brandId, seasonId: target } });
    const targetNamed = await prisma.planningGroup.create({ data: { calendarId: targetCalendar.id, name: 'Predefinito' } });
    await prisma.collectionLayoutRow.createMany({
      data: [rowData(source, sourceDefault, 'Clutch'), rowData(source, sourceNamed.id, 'Tote')],
    });

    const copy = await copyAll(source, target);

    const rows = await prisma.collectionLayoutRow.findMany({
      where: { collectionLayoutId: copy.id },
      select: { line: true, planningGroup: { select: { id: true, isDefault: true } } },
      orderBy: { line: 'asc' },
    });
    expect(rows).toEqual([
      { line: 'Clutch', planningGroup: { id: expect.any(String), isDefault: true } },
      { line: 'Tote', planningGroup: { id: targetNamed.id, isDefault: false } },
    ]);
  });

  it('starts rows neither completed nor revised; hidden columns come along, budgets do not', async () => {
    const source = await fixture();
    await prisma.collectionLayoutRow.create({
      data: { ...rowData(source, source.planningGroupId, 'Tote'), completedAt: new Date(), lastRevisedAt: new Date() },
    });

    const copy = await copyAll(source, await newSeason());

    expect(copy).toMatchObject({ skuBudget: null, hiddenColumns: ['notes'] });
    expect(copy.groups).toEqual([expect.objectContaining({ name: 'Borse', skuBudget: null })]);
    expect(copy.groups[0].rows[0]).toMatchObject({ completedAt: null, lastRevisedAt: null, phaseId: null, pictureKey: null });
  });

  it('answers CONFLICT, through the unique constraint, when the target layout already exists', async () => {
    const source = await fixture();
    await prisma.collectionLayoutRow.create({ data: rowData(source, source.planningGroupId, 'Tote') });
    const target = await newSeason();
    const existing = await prisma.collectionLayout.create({ data: { brandId: source.brandId, seasonId: target } });

    await expect(copyAll(source, target)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await prisma.collectionGroup.count({ where: { collectionLayoutId: existing.id } })).toBe(0);
  });

  it('answers NOT_FOUND for a target season that does not exist', async () => {
    const source = await fixture();
    await prisma.collectionLayoutRow.create({ data: rowData(source, source.planningGroupId, 'Tote') });

    await expect(copyAll(source, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('copies 1000 rows with two quotations each', async () => {
    const source = await fixture();
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    await prisma.collectionLayoutRow.createMany({ data: ids.map((id, i) => ({ ...rowData(source, source.planningGroupId, `L${i}`), id, order: i })) });
    await prisma.collectionRowQuotation.createMany({
      data: ids.flatMap(rowId => [0, 1].map(order => ({ rowId, order, supplierQuotation: 10, retailPrice: 30 }))),
    });

    const copy = await copyAll(source, await newSeason());

    expect(await prisma.collectionLayoutRow.count({ where: { collectionLayoutId: copy.id } })).toBe(1000);
    expect(await prisma.collectionRowQuotation.count({ where: { row: { collectionLayoutId: copy.id } } })).toBe(2000);
  });
});

describe('resolveDefaultPlanningGroupId', () => {
  it('gives two first concurrent calls, each in its own transaction, the same single default group', async () => {
    const { brandId, seasonId } = await createCalendarFixture(prisma, { prefix: 'DG' });

    // In transactions, where a caught error would not help: the loser's statement must not fail.
    const [a, b] = await Promise.all([
      prisma.$transaction(tx => resolveDefaultPlanningGroupId(brandId, seasonId, tx)),
      prisma.$transaction(tx => resolveDefaultPlanningGroupId(brandId, seasonId, tx)),
    ]);

    expect(a).toBe(b);
    expect(await prisma.planningGroup.count({ where: { calendar: { brandId, seasonId }, isDefault: true } })).toBe(1);
  });

  // #128: the default group stores no name, so a user group may take the name it is displayed with.
  it('creates the default group beside a group of the user\'s named like it', async () => {
    const { brandId, seasonId, calendarId } = await createCalendarFixture(prisma, { prefix: 'DN' });
    const named = await prisma.planningGroup.create({ data: { calendarId, name: 'Predefinito' } });

    await getOrCreateCalendar(brandId, seasonId, prisma);
    const defaultId = await resolveDefaultPlanningGroupId(brandId, seasonId, prisma);

    expect(await prisma.planningGroup.findUniqueOrThrow({ where: { id: defaultId } })).toMatchObject({ name: null, isDefault: true });
    expect(await prisma.planningGroup.findUniqueOrThrow({ where: { id: named.id } })).toMatchObject({ name: 'Predefinito', isDefault: false });
    // Every picker reads the displayed name; `isDefault` tells the two apart.
    const listed = await asAdmin.planningGroup.list({ brandId, seasonId });
    expect(listed.filter(g => g.name === 'Predefinito').map(g => ({ id: g.id, isDefault: g.isDefault })))
      .toEqual([{ id: defaultId, isDefault: true }, { id: named.id, isDefault: false }]);
  });
});
