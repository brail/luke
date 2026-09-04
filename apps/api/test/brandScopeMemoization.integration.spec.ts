/**
 * Query-sharing regression test for `brandScope.service.ts`'s per-request memoization.
 *
 * `assertBrandAccess`/`filterAllowedBrandIds` (brand) and the newer `getAllowedFunctionIds`
 * (function) both derive from the same `ctx._allowedTeamAccessPromise`, populated once by
 * `getUserAllowedIds`. The point of that sharing is concrete: `seasonCalendar.listMilestones` is
 * commonly batched in the same tRPC request as `seasonCalendar.getOrCreate` (both fire on the
 * calendar page's initial load) — `getOrCreate` calls `assertBrandAccess`, `listMilestones` calls
 * both `filterAllowedBrandIds` and `getAllowedFunctionIds`. Without sharing, that's 2-3 separate
 * `companyTeamMembership` queries per page load instead of 1.
 *
 * This asserts the mechanism directly rather than trusting code review: two guards of different
 * kinds (brand, then function) on the *same* `ctx` object must hit the database once, not twice.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { assertBrandAccess, getAllowedFunctionIds, type BrandScopeCtx } from '../src/services/brandScope.service';

import { setupTestDb } from './helpers/database';


let prisma: PrismaClient;
let userId: string;
let brandId: string;

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 8);

  const [user, brand, fn] = await Promise.all([
    prisma.user.create({
      data: {
        email: `memo-${uid}@test.com`, username: `memo-${uid}`,
        firstName: 'Memo', lastName: 'Test', role: 'viewer', isActive: true,
      },
    }),
    prisma.brand.create({ data: { code: `MEM-${uid}`, name: `Memo Brand ${uid}`, isActive: true } }),
    prisma.companyFunction.create({ data: { slug: `memo_fn_${uid}`, name: `Memo Fn ${uid}`, order: 97, isActive: true } }),
  ]);
  userId = user.id;
  brandId = brand.id;

  const team = await prisma.companyTeam.create({ data: { functionId: fn.id, name: `Memo Team ${uid}`, isActive: true } });
  await Promise.all([
    prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId } }),
    prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } }),
  ]);
});

describe('brandScope.service.ts — condivisione della query per-richiesta', () => {
  it('assertBrandAccess seguito da getAllowedFunctionIds sullo stesso ctx: una sola query companyTeamMembership', async () => {
    const ctx: BrandScopeCtx = { prisma, session: { user: { id: userId, role: 'viewer' } } };
    const spy = vi.spyOn(prisma.companyTeamMembership, 'findMany');

    await assertBrandAccess(ctx, brandId);
    await getAllowedFunctionIds(ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('due ctx distinti non condividono nulla: due query, una per ciascuno', async () => {
    const ctxA: BrandScopeCtx = { prisma, session: { user: { id: userId, role: 'viewer' } } };
    const ctxB: BrandScopeCtx = { prisma, session: { user: { id: userId, role: 'viewer' } } };
    const spy = vi.spyOn(prisma.companyTeamMembership, 'findMany');

    await assertBrandAccess(ctxA, brandId);
    await assertBrandAccess(ctxB, brandId);

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
