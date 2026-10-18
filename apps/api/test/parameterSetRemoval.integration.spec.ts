/**
 * `pricing.parameterSets.remove` refuses a set that is still in use (#77).
 *
 * Both foreign keys onto a parameter set — collection quotations and merchandising rows — are
 * `onDelete: SetNull`, so a delete that went through silently unlinked every row using the set,
 * and those rows lost their purchase price and margin. `removeParameterSet` now locks the set row
 * `FOR UPDATE` before counting its uses, which serialises it with any write that links a row to
 * the set (that write's foreign-key check takes `FOR KEY SHARE` on the same row).
 *
 * The concurrent cases prove both orders against a real transaction held open on a separate
 * connection, and observe the other side actually waiting on it (`pg_blocking_pids`) before
 * letting go — the same technique as `specsheetImageLock.integration.spec.ts`. A pending promise
 * alone would not prove it: it could be waiting on the connection pool.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerAs, setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';

import type { Client } from 'pg';

let prisma: PrismaClient;
let admin: Awaited<ReturnType<typeof createCallerAs>>;
let brandId: string;
let seasonId: string;
let setId: string;
let rowId: string;

beforeEach(async () => {
  prisma = await setupTestDb();
  admin = await createCallerAs('admin');
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [brand, season] = await Promise.all([
    prisma.brand.create({
      data: { code: `PX${uid}`, name: `Removal ${uid}`, isActive: true },
    }),
    prisma.season.create({
      data: {
        code: `X${uid}`,
        name: `Season ${uid}`,
        year: 2035,
        isActive: true,
      },
    }),
  ]);
  brandId = brand.id;
  seasonId = season.id;

  const set = await prisma.pricingParameterSet.create({
    data: {
      brandId,
      seasonId,
      name: `PS ${uid}`,
      countryCode: 'CN',
      qualityControlPercent: 0,
      transportInsuranceCost: 0,
      duty: 0,
      exchangeRate: 1,
      italyAccessoryCosts: 0,
      tools: 0,
      retailMultiplier: 2,
      optimalMargin: 52,
    },
  });
  setId = set.id;

  const layout = await admin.collectionLayout.getOrCreate({
    brandId,
    seasonId,
    availableGenders: ['MAN'],
  });
  const group = await admin.collectionLayout.groups.create({
    collectionLayoutId: layout.id,
    data: { name: 'Gruppo', order: 0 },
  });
  const row = await admin.collectionLayout.rows.create({
    groupId: group.id,
    gender: 'MAN',
    line: 'Row',
    status: COLLECTION_STATUS[0],
    productCategory: 'TEST',
    skuForecast: null,
    qtyForecast: null,
  });
  rowId = row.id;
});

const remove = () =>
  admin.pricing.parameterSets.remove({ id: setId, brandId, seasonId });
const linkedQuotations = () =>
  prisma.collectionRowQuotation.count({
    where: { pricingParameterSetId: setId },
  });
const setExists = async () =>
  (await prisma.pricingParameterSet.count({ where: { id: setId } })) === 1;

describe('removing a parameter set in use', () => {
  it('a set used by a quotation is refused, and the quotation stays linked', async () => {
    await admin.collectionLayout.quotations.create({
      rowId,
      pricingParameterSetId: setId,
    });

    await expect(remove()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('1 quotazione'),
    });
    expect(await setExists()).toBe(true);
    expect(await linkedQuotations()).toBe(1);
  });

  it('a set used by a merchandising row is refused, and the row stays linked', async () => {
    const plan = await admin.merchandisingPlan.getOrCreate({
      brandId,
      seasonId,
    });
    await admin.merchandisingPlan.createRow({
      planId: plan.id,
      articleCode: 'ART-1',
      styleDescription: 'Style',
      colorCode: 'C1',
      colorDescription: 'Black',
      gender: 'MAN',
      productCategory: 'SNEAKER',
      pricingParameterSetId: setId,
    });

    await expect(remove()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('1 riga di merchandising'),
    });
    expect(await setExists()).toBe(true);
    expect(
      await prisma.merchandisingPlanRow.count({
        where: { pricingParameterSetId: setId },
      })
    ).toBe(1);
  });
});

describe('removing a parameter set while a quotation links to it', () => {
  it('link first: the removal waits on the lock, then sees the committed quotation and refuses', async () => {
    const outcome = await whileHeld(
      holder =>
        holder.query(
          `INSERT INTO collection_row_quotations (id, "rowId", "order", "pricingParameterSetId", "updatedAt")
         VALUES ($1, $2, 0, $3, now())`,
          [randomUUID(), rowId, setId]
        ),
      remove
    );

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: { code: 'CONFLICT' },
    });
    expect(await setExists()).toBe(true);
    expect(await linkedQuotations()).toBe(1);
  });

  // The removal's side, held by the test: lock the set and delete it, as `removeParameterSet`
  // does once it has counted no use.
  const deleteSet = async (holder: Client) => {
    await holder.query(
      'SELECT id FROM pricing_parameter_sets WHERE id = $1 FOR UPDATE',
      [setId]
    );
    await holder.query('DELETE FROM pricing_parameter_sets WHERE id = $1', [
      setId,
    ]);
  };

  it('delete first: a quotation write waits on the foreign key, then gets the check answer', async () => {
    const outcome = await whileHeld(deleteSet, () =>
      admin.collectionLayout.quotations.create({
        rowId,
        pricingParameterSetId: setId,
      })
    );

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: { code: 'BAD_REQUEST' },
    });
    expect(
      await prisma.collectionRowQuotation.count({ where: { rowId } })
    ).toBe(0);
  });

  it('delete first: the row drawer save waits, gets the check answer, and rolls back whole', async () => {
    const outcome = await whileHeld(deleteSet, () =>
      admin.collectionLayout.rows.update({
        rowId,
        data: {
          line: 'Renamed',
          quotations: [{ pricingParameterSetId: setId, retailPrice: 100 }],
        },
      })
    );

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: { code: 'BAD_REQUEST' },
    });
    expect(
      await prisma.collectionRowQuotation.count({ where: { rowId } })
    ).toBe(0);
    expect(
      (
        await prisma.collectionLayoutRow.findUniqueOrThrow({
          where: { id: rowId },
        })
      ).line
    ).toBe('Row');
  });

  it('delete first: duplicating a row waits, answers CONFLICT, and creates no copy', async () => {
    await admin.collectionLayout.quotations.create({
      rowId,
      pricingParameterSetId: setId,
    });
    const rowsBefore = await prisma.collectionLayoutRow.count();

    const outcome = await whileHeld(deleteSet, () =>
      admin.collectionLayout.rows.duplicate({ rowId })
    );

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: { code: 'CONFLICT' },
    });
    expect(await prisma.collectionLayoutRow.count()).toBe(rowsBefore);
  });
});
