/**
 * `pricing.parameterSets.remove` refuses a set that is still in use (#77, #130).
 *
 * Both foreign keys onto a parameter set — collection quotations and merchandising rows — are
 * `onDelete: Restrict`, so the database itself refuses the delete, by any path, and the rows keep
 * their purchase price and margin. The refusal gets the API's CONFLICT.
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

import { FOREIGN_KEYS, isForeignKeyViolation } from '../src/lib/error';

import { createCallerAs, grantEditor, setupTestDb } from './helpers';
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
  const directDelete = () =>
    prisma.pricingParameterSet.delete({ where: { id: setId } }).catch((e: unknown) => e);

  it('the database names the quotation key when the set is deleted', async () => {
    await admin.collectionLayout.quotations.create({
      rowId,
      pricingParameterSetId: setId,
    });

    expect(isForeignKeyViolation(await directDelete(), FOREIGN_KEYS.quotationParameterSet)).toBe(true);
  });

  it('the database names the merchandising key when the set is deleted', async () => {
    const plan = await admin.merchandisingPlan.getOrCreate({ brandId, seasonId });
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

    expect(isForeignKeyViolation(await directDelete(), FOREIGN_KEYS.merchRowParameterSet)).toBe(true);
  });

  it('pricing:update alone does not remove a set', async () => {
    grantEditor('pricing:update');
    const editor = await createCallerAs('editor');

    await expect(
      editor.pricing.parameterSets.remove({ id: setId, brandId, seasonId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await setExists()).toBe(true);
  });

  it('an unused set goes, and one of another brand or season is not found', async () => {
    await expect(
      admin.pricing.parameterSets.remove({ id: setId, brandId, seasonId: randomUUID() })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      admin.pricing.parameterSets.remove({ id: setId, brandId: randomUUID(), seasonId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await setExists()).toBe(true);

    await expect(remove()).resolves.toEqual({ success: true });
    expect(await setExists()).toBe(false);
  });

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
  it('link first: the removal waits on the quotation key, then refuses with its count', async () => {
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
      reason: { code: 'CONFLICT', message: expect.stringContaining('1 quotazione') },
    });
    expect(await setExists()).toBe(true);
    expect(await linkedQuotations()).toBe(1);
  });

  // The removal's side, held by the test: delete the set, as `removeParameterSet` does.
  const deleteSet = async (holder: Client) => {
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

  it('a set a row uses cannot go, so the row keeps its link and still duplicates', async () => {
    await admin.collectionLayout.quotations.create({
      rowId,
      pricingParameterSetId: setId,
    });

    await expect(
      prisma.$executeRaw`DELETE FROM pricing_parameter_sets WHERE id = ${setId}`
    ).rejects.toThrow(/collection_row_quotations_pricingParameterSetId_fkey/);

    const copy = await admin.collectionLayout.rows.duplicate({ rowId });
    expect(
      await prisma.collectionRowQuotation.count({
        where: { rowId: copy.id, pricingParameterSetId: setId },
      })
    ).toBe(1);
    expect(await linkedQuotations()).toBe(2);
  });
});
