/**
 * `getUserAllowedIds` — the combined brand + function resolver
 * (apps/api/src/services/context.service.ts), one `companyTeamMembership` query for both halves:
 * the brands a user may open (union of their teams' scopes) and the function → brands pairs their
 * teams grant (ADR-041: a pair only from one team).
 *
 * Same policy and fixture shape as `companyAccess.integration.spec.ts`
 * (`getUserAllowedBrandIds`'s own suite) — strict opt-in, `null` reserved for admin. A team with no
 * brand scope grants its function on nothing, so it contributes to neither half.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getUserAllowedIds } from '../src/services/context.service';

import { setupTestDb } from './helpers/database';



let prisma: PrismaClient;

let brandAId: string;
let brandBId: string;
let functionId: string;

async function createUser() {
  const id = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: {
      timezone: 'Europe/Rome',
      email: `allowed-ids-${id}@test.com`,
      username: `allowed-ids-${id}`,
      firstName: 'Allowed',
      lastName: 'Ids',
      role: 'viewer',
      isActive: true,
    },
  });
  return user.id;
}

async function createTeam(opts: { isActive?: boolean; functionId?: string } = {}) {
  const id = randomUUID().substring(0, 8);
  return prisma.companyTeam.create({
    data: {
      functionId: opts.functionId ?? functionId,
      name: `allowed-ids-team-${id}`,
      isActive: opts.isActive ?? true,
    },
  });
}

beforeAll(async () => {
  prisma = await setupTestDb();

  const [brandA, brandB] = await Promise.all([
    prisma.brand.create({ data: { code: `AIA-${randomUUID().substring(0, 6)}`, name: 'Allowed Ids Brand A', isActive: true } }),
    prisma.brand.create({ data: { code: `AIB-${randomUUID().substring(0, 6)}`, name: 'Allowed Ids Brand B', isActive: true } }),
  ]);
  brandAId = brandA.id;
  brandBId = brandB.id;

  const fn = await prisma.companyFunction.create({
    data: { slug: `allowed_ids_fn_${randomUUID().substring(0, 6)}`, name: 'Allowed Ids Fn', order: 98, isActive: true },
  });
  functionId = fn.id;
});

describe('getUserAllowedIds', () => {
  it('user with no team → nothing', async () => {
    const userId = await createUser();
    const result = await getUserAllowedIds(userId, prisma);
    expect(result).toEqual({ brandIds: [], functionBrands: new Map() });
  });

  it('admin → { brandIds: null, functionBrands: null }, the only case with null', async () => {
    const userId = await createUser();
    const result = await getUserAllowedIds(userId, prisma, 'admin');
    expect(result).toEqual({ brandIds: null, functionBrands: null });
  });

  it('team without brandScopes → grants its function on nothing', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedIds(userId, prisma);
    expect(result.brandIds).toEqual([]);
    expect(result.functionBrands).toEqual(new Map());
  });

  it('team with brandScopes=[brandA] → brandIds=[brandA], fn on [brandA]', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedIds(userId, prisma);
    expect(result.brandIds).toEqual([brandAId]);
    expect(result.functionBrands).toEqual(new Map([[functionId, new Set([brandAId])]]));
  });

  it("several teams with different scopes → brands unioned, each function on its own team's brands", async () => {
    const userId = await createUser();
    const fn2 = await prisma.companyFunction.create({
      data: { slug: `allowed_ids_fn2_${randomUUID().substring(0, 6)}`, name: 'Allowed Ids Fn 2', order: 99, isActive: true },
    });
    const teamA = await createTeam();
    const teamB = await createTeam({ functionId: fn2.id });
    await prisma.companyTeamBrandScope.create({ data: { teamId: teamA.id, brandId: brandAId } });
    await prisma.companyTeamBrandScope.create({ data: { teamId: teamB.id, brandId: brandBId } });
    await Promise.all([
      prisma.companyTeamMembership.create({ data: { teamId: teamA.id, userId } }),
      prisma.companyTeamMembership.create({ data: { teamId: teamB.id, userId } }),
    ]);

    const result = await getUserAllowedIds(userId, prisma);
    expect(result.brandIds).toEqual(expect.arrayContaining([brandAId, brandBId]));
    expect(result.brandIds).toHaveLength(2);
    expect(result.functionBrands).toEqual(new Map([[functionId, new Set([brandAId])], [fn2.id, new Set([brandBId])]]));
  });

  it('a team with no scope widens neither the brands nor the functions', async () => {
    const userId = await createUser();
    const fn2 = await prisma.companyFunction.create({
      data: { slug: `allowed_ids_fn3_${randomUUID().substring(0, 6)}`, name: 'Allowed Ids Fn 3', order: 100, isActive: true },
    });
    const teamScoped = await createTeam();
    const teamUnscoped = await createTeam({ functionId: fn2.id });
    await prisma.companyTeamBrandScope.create({ data: { teamId: teamScoped.id, brandId: brandAId } });
    await Promise.all([
      prisma.companyTeamMembership.create({ data: { teamId: teamScoped.id, userId } }),
      prisma.companyTeamMembership.create({ data: { teamId: teamUnscoped.id, userId } }),
    ]);

    const result = await getUserAllowedIds(userId, prisma);
    expect(result.brandIds).toEqual([brandAId]);
    expect(result.functionBrands).toEqual(new Map([[functionId, new Set([brandAId])]]));
  });

  it('team with isActive=false → nothing, an inactive team does not count', async () => {
    const userId = await createUser();
    const inactiveTeam = await createTeam({ isActive: false });
    await prisma.companyTeamBrandScope.create({ data: { teamId: inactiveTeam.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: inactiveTeam.id, userId } });

    const result = await getUserAllowedIds(userId, prisma);
    expect(result).toEqual({ brandIds: [], functionBrands: new Map() });
  });
});
