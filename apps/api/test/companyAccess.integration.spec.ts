import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getUserAllowedBrandIds } from '../src/services/context.service';

import { setupTestDb } from './helpers/database';



let prisma: PrismaClient;

let brandAId: string;
let brandBId: string;
let functionId: string;

async function createUser() {
  const id = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `access-test-${id}@test.com`,
      username: `access-test-${id}`,
      firstName: 'Access',
      lastName: 'Test',
      role: 'viewer',
      isActive: true,
    },
  });
  return user.id;
}

async function createTeam(opts: { isActive?: boolean } = {}) {
  const id = randomUUID().substring(0, 8);
  return prisma.companyTeam.create({
    data: {
      functionId,
      name: `team-${id}`,
      isActive: opts.isActive ?? true,
    },
  });
}

beforeAll(async () => {
  // `setupTestDb()` guarantees the schema and truncates: file order isn't
  // alphabetical or stable, so no suite can assume that another suite
  // has already created the tables.
  prisma = await setupTestDb();

  const [brandA, brandB] = await Promise.all([
    prisma.brand.create({ data: { code: `ACCA-${randomUUID().substring(0, 6)}`, name: 'Brand A', isActive: true } }),
    prisma.brand.create({ data: { code: `ACCB-${randomUUID().substring(0, 6)}`, name: 'Brand B', isActive: true } }),
  ]);
  brandAId = brandA.id;
  brandBId = brandB.id;

  const fn = await prisma.companyFunction.create({
    data: { slug: `access_fn_${randomUUID().substring(0, 6)}`, name: 'Access Test Fn', order: 99, isActive: true },
  });
  functionId = fn.id;
});

/**
 * Current policy (commit 28b1873, "opt-in brand access via team scopes"):
 * brand access is **strict opt-in**. `null` means "no constraint" and is
 * reserved for the admin role; for everyone else access is exactly the union
 * of the brandScopes of the active teams the user belongs to. No team, or a team
 * with no scope, means no brands — not "all".
 *
 * The previous version of these tests asserted the opposite policy (a more
 * permissive union, `null` = all brands) and had fallen behind the migration.
 */
describe('getUserAllowedBrandIds', () => {
  it('user with no team → []', async () => {
    const userId = await createUser();
    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual([]);
  });

  it('admin → null (no restriction, the only case that returns null)', async () => {
    const userId = await createUser();
    const result = await getUserAllowedBrandIds(userId, prisma, 'admin');
    expect(result).toBeNull();
  });

  it('user in a team without brandScopes → [] (opt-in: no scope, no brand)', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual([]);
  });

  it('user in a team with brandScopes=[brandA] → [brandA.id]', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual(expect.arrayContaining([brandAId]));
    expect(result).toHaveLength(1);
  });

  it('user in several teams with different scopes → union', async () => {
    const userId = await createUser();
    const teamA = await createTeam();
    const teamB = await createTeam();
    await prisma.companyTeamBrandScope.create({ data: { teamId: teamA.id, brandId: brandAId } });
    await prisma.companyTeamBrandScope.create({ data: { teamId: teamB.id, brandId: brandBId } });
    await Promise.all([
      prisma.companyTeamMembership.create({ data: { teamId: teamA.id, userId } }),
      prisma.companyTeamMembership.create({ data: { teamId: teamB.id, userId } }),
    ]);

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual(expect.arrayContaining([brandAId, brandBId]));
    expect(result).toHaveLength(2);
  });

  it('a team with no scope does not widen the access of the other teams', async () => {
    const userId = await createUser();
    const teamScoped = await createTeam();
    const teamUnscoped = await createTeam();
    await prisma.companyTeamBrandScope.create({ data: { teamId: teamScoped.id, brandId: brandAId } });
    await Promise.all([
      prisma.companyTeamMembership.create({ data: { teamId: teamScoped.id, userId } }),
      prisma.companyTeamMembership.create({ data: { teamId: teamUnscoped.id, userId } }),
    ]);

    // Under the old policy the team with no scope would have promoted the user to
    // "all brands". With opt-in it adds nothing: only brandA remains.
    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual([brandAId]);
  });

  it('user in a team with isActive=false → [] (an inactive team does not count)', async () => {
    const userId = await createUser();
    const inactiveTeam = await createTeam({ isActive: false });
    await prisma.companyTeamBrandScope.create({ data: { teamId: inactiveTeam.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: inactiveTeam.id, userId } });

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual([]);
  });
});
