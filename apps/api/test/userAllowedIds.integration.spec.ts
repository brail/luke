/**
 * `getUserAllowedIds` — the combined brand+function resolver
 * (apps/api/src/services/context.service.ts), introduced to collapse the two separate
 * `companyTeamMembership` queries `listMilestonesDb` used to issue (one via
 * `getUserAllowedBrandIds`, one via `getUserAllowedFunctionIds`) into one.
 *
 * Same policy and fixture shape as `companyAccess.integration.spec.ts`
 * (`getUserAllowedBrandIds`'s own suite) — strict opt-in, `null` reserved for admin — but with
 * the brand/function asymmetry made explicit: a team with no brand scopes still has a
 * `functionId`, so `brandIds` and `functionIds` don't always empty out together.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { getUserAllowedIds } from '../src/services/context.service';

import { setupTestDb } from './helpers/database';

import type { PrismaClient } from '@prisma/client';


let prisma: PrismaClient;

let brandAId: string;
let brandBId: string;
let functionId: string;

async function createUser() {
  const id = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: {
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
  it('utente senza team → { brandIds: [], functionIds: [] }', async () => {
    const userId = await createUser();
    const result = await getUserAllowedIds(userId, prisma);
    expect(result).toEqual({ brandIds: [], functionIds: [] });
  });

  it('admin → { brandIds: null, functionIds: null }, unico caso con null', async () => {
    const userId = await createUser();
    const result = await getUserAllowedIds(userId, prisma, 'admin');
    expect(result).toEqual({ brandIds: null, functionIds: null });
  });

  it('team senza brandScopes → brandIds vuoto ma functionIds valorizzato (l\'asimmetria)', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedIds(userId, prisma);
    expect(result.brandIds).toEqual([]);
    expect(result.functionIds).toEqual([functionId]);
  });

  it('team con brandScopes=[brandA] → brandIds=[brandA], functionIds=[fn]', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedIds(userId, prisma);
    expect(result.brandIds).toEqual([brandAId]);
    expect(result.functionIds).toEqual([functionId]);
  });

  it('più team con scope diversi → union sia sui brand sia sulle funzioni', async () => {
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
    expect(result.functionIds).toEqual(expect.arrayContaining([functionId, fn2.id]));
    expect(result.functionIds).toHaveLength(2);
  });

  it('un team senza scope non allarga i brand del sibling, ma la sua funzione conta comunque', async () => {
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
    expect(result.functionIds).toEqual(expect.arrayContaining([functionId, fn2.id]));
    expect(result.functionIds).toHaveLength(2);
  });

  it('team isActive=false → { brandIds: [], functionIds: [] }, team inattivo non conta', async () => {
    const userId = await createUser();
    const inactiveTeam = await createTeam({ isActive: false });
    await prisma.companyTeamBrandScope.create({ data: { teamId: inactiveTeam.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: inactiveTeam.id, userId } });

    const result = await getUserAllowedIds(userId, prisma);
    expect(result).toEqual({ brandIds: [], functionIds: [] });
  });
});
