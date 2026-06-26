import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { getUserAllowedBrandIds } from '../src/services/context.service';

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

async function createTeam(opts: { isMain?: boolean; isActive?: boolean } = {}) {
  const id = randomUUID().substring(0, 8);
  return prisma.companyTeam.create({
    data: {
      functionId,
      name: `team-${id}`,
      isMain: opts.isMain ?? false,
      isActive: opts.isActive ?? true,
    },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();

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

afterAll(async () => {
  await prisma.$disconnect();
});

describe('getUserAllowedBrandIds', () => {
  it('utente senza team → []', async () => {
    const userId = await createUser();
    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual([]);
  });

  it('utente in team con brandScopes=[] → null (tutti i brand)', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toBeNull();
  });

  it('utente in team con brandScopes=[brandA] → [brandA.id]', async () => {
    const userId = await createUser();
    const team = await createTeam();
    await prisma.companyTeamBrandScope.create({ data: { teamId: team.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: team.id, userId } });

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual(expect.arrayContaining([brandAId]));
    expect(result).toHaveLength(1);
  });

  it('utente in più team con scope diversi → union', async () => {
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

  it('utente in più team, almeno uno con brandScopes=[] → null', async () => {
    const userId = await createUser();
    const teamScoped = await createTeam();
    const teamUnscoped = await createTeam();
    await prisma.companyTeamBrandScope.create({ data: { teamId: teamScoped.id, brandId: brandAId } });
    await Promise.all([
      prisma.companyTeamMembership.create({ data: { teamId: teamScoped.id, userId } }),
      prisma.companyTeamMembership.create({ data: { teamId: teamUnscoped.id, userId } }),
    ]);

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toBeNull();
  });

  it('utente in team isActive=false → [] (team inattivo non conta)', async () => {
    const userId = await createUser();
    const inactiveTeam = await createTeam({ isActive: false });
    await prisma.companyTeamBrandScope.create({ data: { teamId: inactiveTeam.id, brandId: brandAId } });
    await prisma.companyTeamMembership.create({ data: { teamId: inactiveTeam.id, userId } });

    const result = await getUserAllowedBrandIds(userId, prisma);
    expect(result).toEqual([]);
  });
});
