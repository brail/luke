/**
 * A permanent delete of a brand or season is refused while anything still references it, and the
 * refusal says what. The pre-check used to count only layouts and parameter sets, so a calendar or
 * a merchandising plan reached the foreign key and answered 500. A reference or a NAV link that
 * arrives between the check and the delete gets the same answer as the check.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { REFERENCE_KEYS } from '../src/services/catalogDelete.service';

import { createCallerAs, setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

async function pair() {
  const uid = randomUUID().slice(0, 6);
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `HB${uid}`, name: `Brand ${uid}` } }),
    prisma.season.create({ data: { code: `HS${uid}`, name: `Season ${uid}` } }),
  ]);
  return { brandId: brand.id, seasonId: season.id };
}

const REFERENCES = {
  'collection layout': (ids: { brandId: string; seasonId: string }) => prisma.collectionLayout.create({ data: ids }),
  'set di pricing': (ids: { brandId: string; seasonId: string }) =>
    prisma.pricingParameterSet.create({
      data: {
        ...ids, name: 'Set', purchaseCurrency: 'USD', sellingCurrency: 'EUR', countryCode: 'CN',
        qualityControlPercent: 0, transportInsuranceCost: 0, duty: 0, exchangeRate: 1,
        italyAccessoryCosts: 0, tools: 0, retailMultiplier: 2, optimalMargin: 52,
      },
    }),
  calendari: (ids: { brandId: string; seasonId: string }) => prisma.seasonCalendar.create({ data: ids }),
  'piani merchandising': (ids: { brandId: string; seasonId: string }) => prisma.merchandisingPlan.create({ data: ids }),
};

const hardDelete = async (kind: 'brand' | 'season', id: string) => {
  const caller = await createCallerAs('admin');
  return caller[kind].hardDelete({ id, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE });
};

it('counts every foreign key that restricts deleting a brand or season', async () => {
  const keys = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE contype = 'f' AND confdeltype IN ('r', 'a') AND confrelid IN ('brands'::regclass, 'seasons'::regclass)
  `;

  expect(keys.map(k => k.conname).sort()).toEqual([...REFERENCE_KEYS].sort());
});

describe.each(['brand', 'season'] as const)('%s.hardDelete', kind => {
  const idOf = (ids: { brandId: string; seasonId: string }) => (kind === 'brand' ? ids.brandId : ids.seasonId);
  const remaining = (id: string) =>
    kind === 'brand' ? prisma.brand.count({ where: { id } }) : prisma.season.count({ where: { id } });

  it.each(Object.keys(REFERENCES) as (keyof typeof REFERENCES)[])('refuses while %s reference it, with the count', async label => {
    const ids = await pair();
    await REFERENCES[label](ids);

    await expect(hardDelete(kind, idOf(ids))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining(`${label} (1)`),
    });
    expect(await remaining(idOf(ids))).toBe(1);
  });

  it('answers with the counts for a reference created between the check and the delete', async () => {
    const ids = await pair();

    const outcome = await whileHeld(
      holder => holder.query(
        `INSERT INTO season_calendars (id, "brandId", "seasonId", "updatedAt") VALUES ($1, $2, $3, now())`,
        [randomUUID(), ids.brandId, ids.seasonId]
      ),
      () => hardDelete(kind, idOf(ids))
    );

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: { code: 'PRECONDITION_FAILED', message: expect.stringContaining("calendari (1)") },
    });
    expect(await remaining(idOf(ids))).toBe(1);
  });

  it('refuses when a NAV link arrives between the check and the delete', async () => {
    const ids = await pair();
    const navCode = `N${randomUUID().slice(0, 8)}`;
    const linkSql = kind === 'brand'
      ? 'UPDATE brands SET "navBrandId" = $1 WHERE id = $2'
      : 'UPDATE seasons SET "navSeasonId" = $1 WHERE id = $2';
    if (kind === 'brand') await prisma.navBrand.create({ data: { navCode, syncedAt: new Date() } });
    else await prisma.navSeason.create({ data: { navCode, syncedAt: new Date() } });

    const outcome = await whileHeld(
      holder => holder.query(linkSql, [navCode, idOf(ids)]),
      () => hardDelete(kind, idOf(ids))
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'BAD_REQUEST' } });
    expect(await remaining(idOf(ids))).toBe(1);
  });
});
