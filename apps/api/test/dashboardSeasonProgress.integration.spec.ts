/**
 * The home's season progress measures the forecast against the sum of the group budgets, as the
 * collection layout's totals bar does (#216): no screen writes the layout-level `skuBudget`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

/**
 * A layout whose groups carry `budgets`, one row of 4 forecast SKU in each. The layout-level column
 * holds a value the result must ignore.
 */
async function layoutWithGroupBudgets(budgets: (number | null)[]) {
  const fixture = await createCalendarFixture(prisma, { prefix: 'DSP' });
  const layout = await prisma.collectionLayout.create({
    data: { brandId: fixture.brandId, seasonId: fixture.seasonId, skuBudget: 999 },
  });
  for (const [index, skuBudget] of budgets.entries()) {
    const group = await prisma.collectionGroup.create({
      data: { collectionLayoutId: layout.id, name: `Gruppo ${index}`, skuBudget },
    });
    await prisma.collectionLayoutRow.create({
      data: {
        collectionLayoutId: layout.id, groupId: group.id, planningGroupId: fixture.planningGroupId,
        gender: 'MAN', line: 'Line', status: 'TEST', productCategory: 'TEST', skuForecast: 4,
      },
    });
  }
  return { brandId: fixture.brandId, seasonId: fixture.seasonId };
}

describe('dashboard.getSeasonProgress', () => {
  it('reports the sum of the group budgets', async () => {
    const input = await layoutWithGroupBudgets([10, null, 5]);

    const progress = await (await createCallerAs('admin')).dashboard.getSeasonProgress(input);

    expect(progress).toMatchObject({ skuBudget: 15, skuForecast: 12, groupCount: 3 });
  });

  it('reports no budget when no group has one', async () => {
    const input = await layoutWithGroupBudgets([null, null]);

    const progress = await (await createCallerAs('admin')).dashboard.getSeasonProgress(input);

    expect(progress).toMatchObject({ skuBudget: null, skuForecast: 8 });
  });
});
