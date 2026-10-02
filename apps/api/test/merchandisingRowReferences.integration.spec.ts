/**
 * What a merchandising plan row may point at.
 *
 * `createRow`/`updateRow` stored any `pricingParameterSetId` and `assignedUserId` they were given:
 * a parameter set of another brand or season (whose name `listRows` then showed), and an assignee
 * set without `assignUser`'s notification or any check that they can open the row. The parameter
 * set must now be one of the plan's own, and a row is assigned only through `assignUser`, which
 * refuses a user with no access to the plan's brand.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as brandScope from '../src/services/brandScope.service';

import { createCallerAs, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let brandId: string;
let seasonId: string;

const rowInput = {
  articleCode: 'ART-1',
  styleDescription: 'Style',
  colorCode: 'C1',
  colorDescription: 'Black',
  gender: 'MAN' as const,
  productCategory: 'SNEAKER',
};

async function parameterSet(brand: string, season: string) {
  return prisma.pricingParameterSet.create({
    data: {
      brandId: brand, seasonId: season, name: `PS ${randomUUID().slice(0, 6)}`, countryCode: 'CN',
      qualityControlPercent: 0, transportInsuranceCost: 0, duty: 0, exchangeRate: 1,
      italyAccessoryCosts: 0, tools: 0, retailMultiplier: 2, optimalMargin: 52,
    },
  });
}

beforeEach(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `RR${uid}`, name: `Refs ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `F${uid}`, name: `Season ${uid}`, year: 2034, isActive: true } }),
  ]);
  brandId = brand.id;
  seasonId = season.id;
});

async function planAndRow() {
  const admin = await createCallerAs('admin');
  const plan = await admin.merchandisingPlan.getOrCreate({ brandId, seasonId });
  const row = await admin.merchandisingPlan.createRow({ ...rowInput, planId: plan.id });
  return { admin, plan, row };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a parameter set deleted between the check and the write', () => {
  // A parameter set never changes brand or season, so deletion is the only way the check can go
  // stale; the foreign key refuses the write then. The check's read is made to still see the set,
  // as it would have a moment before the delete committed.
  async function staleSet() {
    const gone = await parameterSet(brandId, seasonId);
    await prisma.pricingParameterSet.delete({ where: { id: gone.id } });
    const findFirst = prisma.pricingParameterSet.findFirst.bind(prisma.pricingParameterSet);
    vi.spyOn(prisma.pricingParameterSet, 'findFirst').mockImplementation(
      // The spy keeps the delegate's own signature; only the stale id is answered by hand.
      ((args: { where?: { id?: string } }) =>
        args?.where?.id === gone.id ? Promise.resolve({ id: gone.id }) : findFirst(args as never)) as never
    );
    return gone.id;
  }

  it('answers the check\'s BAD_REQUEST on create and on update, not a 500', async () => {
    const { admin, plan, row } = await planAndRow();
    const goneId = await staleSet();

    await expect(
      admin.merchandisingPlan.createRow({ ...rowInput, planId: plan.id, pricingParameterSetId: goneId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      admin.merchandisingPlan.updateRow({ id: row.id, data: { pricingParameterSetId: goneId } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('still answers 500 for a foreign key it does not own', async () => {
    const { admin, plan } = await planAndRow();
    const missingPlanId = randomUUID();
    // The plan passes its access check and is gone at write time: a different constraint.
    vi.spyOn(brandScope, 'resolveMerchPlanBrandAccess').mockResolvedValue({ ...plan, id: missingPlanId } as never);

    await expect(
      admin.merchandisingPlan.createRow({ ...rowInput, planId: missingPlanId }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});

describe('the parameter set of a row', () => {
  it('must belong to the plan’s brand and season, on create and on update', async () => {
    const { admin, plan, row } = await planAndRow();
    const otherSeason = await prisma.season.create({
      data: { code: `O${randomUUID().slice(0, 6)}`, name: 'Other', year: 2035, isActive: true },
    });
    const foreign = await parameterSet(brandId, otherSeason.id);
    const own = await parameterSet(brandId, seasonId);

    await expect(
      admin.merchandisingPlan.createRow({ ...rowInput, planId: plan.id, pricingParameterSetId: foreign.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      admin.merchandisingPlan.updateRow({ id: row.id, data: { pricingParameterSetId: foreign.id } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const updated = await admin.merchandisingPlan.updateRow({ id: row.id, data: { pricingParameterSetId: own.id } });
    expect(updated.pricingParameterSetId).toBe(own.id);
  });
});

describe('assigning a row', () => {
  it('is not possible through createRow: an assignee there is ignored', async () => {
    const { admin, plan } = await planAndRow();
    const { user } = await createTestUser('editor');

    const row = await admin.merchandisingPlan.createRow({
      ...rowInput,
      planId: plan.id,
      // @ts-expect-error — no longer part of the input; the parser strips it
      assignedUserId: user.id,
    });

    expect(row.assignedUserId).toBeNull();
  });

  it('refuses a user who cannot open the plan’s brand, and an unknown one', async () => {
    const { admin, row } = await planAndRow();
    // An editor in no team is scoped to no brand at all.
    const { user } = await createTestUser('editor');

    await expect(
      admin.merchandisingPlan.assignUser({ rowId: row.id, userId: user.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      admin.merchandisingPlan.assignUser({ rowId: row.id, userId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('assigns a user who can open the brand', async () => {
    const { admin, row } = await planAndRow();
    const { user } = await createTestUser('admin');

    const assigned = await admin.merchandisingPlan.assignUser({ rowId: row.id, userId: user.id });

    expect(assigned.assignedUserId).toBe(user.id);
  });
});
