/**
 * Each brand+season has exactly one default parameter set while it has any. Creating, setting the
 * default and deleting each take one lock per brand+season, so concurrent changes cannot leave two
 * defaults or none (#192).
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createParameterSet, removeParameterSet, setAsDefault } from '../src/services/pricing.service';

import { setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await setupTestDb();
});

async function pair() {
  const uid = randomUUID().slice(0, 6);
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `DB${uid}`, name: `Default ${uid}` } }),
    prisma.season.create({ data: { code: `DS${uid}`, name: `Default ${uid}` } }),
  ]);
  return { brandId: brand.id, seasonId: season.id };
}

const input = (name: string) => ({
  name, countryCode: 'CN', purchaseCurrency: 'USD' as const, sellingCurrency: 'EUR' as const,
  qualityControlPercent: 0, transportInsuranceCost: 0, duty: 0, exchangeRate: 1,
  italyAccessoryCosts: 0, tools: 0, retailMultiplier: 2, optimalMargin: 52,
});

const create = (ids: { brandId: string; seasonId: string }, name: string) =>
  createParameterSet(ids.brandId, ids.seasonId, input(name), prisma);

const defaults = (ids: { brandId: string; seasonId: string }) =>
  prisma.pricingParameterSet.count({ where: { ...ids, isDefault: true } });

const lockKey = (ids: { brandId: string; seasonId: string }) => `pricing-default-set:${ids.brandId}:${ids.seasonId}`;

describe('the default parameter set', () => {
  it('stays one when the first sets are created at the same time', async () => {
    const ids = await pair();

    const created = await Promise.all(Array.from({ length: 5 }, (_, i) => create(ids, `Set ${i}`)));

    expect(await defaults(ids)).toBe(1);
    expect(created.map(s => s.orderIndex).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('stays one when two sets are made default at the same time', async () => {
    const ids = await pair();
    await create(ids, 'A');
    const [b, c] = [await create(ids, 'B'), await create(ids, 'C')];

    for (let i = 0; i < 5; i++) {
      await Promise.all([setAsDefault(b.id, ids.brandId, ids.seasonId, prisma), setAsDefault(c.id, ids.brandId, ids.seasonId, prisma)]);
      const defaultIds = await prisma.pricingParameterSet.findMany({ where: { ...ids, isDefault: true }, select: { id: true } });
      expect(defaultIds).toHaveLength(1);
      expect([b.id, c.id]).toContain(defaultIds[0]!.id);
    }
  });

  it('stays one when the default is deleted while another is made default', async () => {
    const ids = await pair();
    const a = await create(ids, 'A');
    await create(ids, 'B');
    const c = await create(ids, 'C');

    await Promise.all([
      removeParameterSet(a.id, ids.brandId, ids.seasonId, prisma),
      setAsDefault(c.id, ids.brandId, ids.seasonId, prisma),
    ]);

    expect(await defaults(ids)).toBe(1);
  });

  it.each<[string, (ids: { brandId: string; seasonId: string }) => Promise<unknown>]>([
    ['creates', ids => create(ids, 'Waiting')],
    ['sets the default', async ids => {
      const set = await prisma.pricingParameterSet.findFirstOrThrow({ where: { ...ids, isDefault: false } });
      return setAsDefault(set.id, ids.brandId, ids.seasonId, prisma);
    }],
    ['deletes', async ids => {
      const set = await prisma.pricingParameterSet.findFirstOrThrow({ where: { ...ids, isDefault: true } });
      return removeParameterSet(set.id, ids.brandId, ids.seasonId, prisma);
    }],
  ])('waits on the brand+season lock when it %s', async (_what, write) => {
    const ids = await pair();
    await create(ids, 'First');
    await create(ids, 'Second');

    const outcome = await whileHeld(
      holder => holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(ids)]),
      () => write(ids)
    );

    expect(outcome.status).toBe('fulfilled');
    expect(await defaults(ids)).toBe(1);
  });

  it('answers NOT_FOUND for a brand or season that does not exist', async () => {
    const ids = await pair();

    await expect(create({ ...ids, brandId: randomUUID() }, 'X')).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Brand non trovato' });
    await expect(create({ ...ids, seasonId: randomUUID() }, 'X')).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Stagione non trovata' });
  });

  it('numbers a new set after the last one, also after a delete', async () => {
    const ids = await pair();
    const first = await create(ids, 'First');
    await create(ids, 'Second');
    await removeParameterSet(first.id, ids.brandId, ids.seasonId, prisma);

    expect((await create(ids, 'Third')).orderIndex).toBe(2);
  });

  it('answers CONFLICT for a name taken between the check and the insert', async () => {
    const ids = await pair();
    await create(ids, 'First');

    const outcome = await whileHeld(
      holder => holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(ids)]),
      () => create(ids, 'Taken'),
      holder => holder.query(
        `INSERT INTO pricing_parameter_sets (id, "brandId", "seasonId", name, "countryCode", "purchaseCurrency",
           "sellingCurrency", "qualityControlPercent", "transportInsuranceCost", duty, "exchangeRate",
           "italyAccessoryCosts", tools, "retailMultiplier", "optimalMargin", "orderIndex", "updatedAt")
         VALUES ($1, $2, $3, 'Taken', 'CN', 'USD', 'EUR', 0, 0, 0, 1, 0, 0, 2, 52, 9, now())`,
        [randomUUID(), ids.brandId, ids.seasonId]
      )
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
  });
});
