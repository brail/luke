import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { UserSession } from '../src/lib/auth';
import type { Context } from '../src/lib/trpc';
import { appRouter } from '../src/routers/index';
import { getVisibleMilestoneIdsForUser } from '../src/services/milestoneVisibility.service';

let prisma: PrismaClient;

let salesFunctionId: string;
let productFunctionId: string;
let salesTeamId: string;
let salesUserId: string;
let adminUserId: string;
let milestoneSalesId: string;
let milestoneProductId: string;
let calendarId: string;
let brandId: string;
let seasonId: string;

function makeSession(userId: string, role: 'admin' | 'editor' | 'viewer'): UserSession {
  return {
    user: { id: userId, email: `${role}-${userId.substring(0, 4)}@test.com`, username: `${role}-${userId.substring(0, 4)}`, role, tokenVersion: 0 },
  };
}

function createContext(session: UserSession): Context {
  return {
    prisma,
    session,
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    req: { headers: {}, ip: '127.0.0.1', log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } } as any,
    res: {} as any,
    traceId: randomUUID(),
  };
}

async function createUser(role: 'admin' | 'editor' | 'viewer') {
  const uid = randomUUID().substring(0, 8);
  return prisma.user.create({
    data: { email: `vis-${role}-${uid}@test.com`, username: `vis-${role}-${uid}`, firstName: role, lastName: 'Vis', role, isActive: true },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const uid = randomUUID().substring(0, 6);

  // Functions
  const [salesFn, productFn] = await Promise.all([
    prisma.companyFunction.create({ data: { slug: `vis_sales_${uid}`, name: 'Sales Vis', order: 90, isActive: true } }),
    prisma.companyFunction.create({ data: { slug: `vis_prod_${uid}`, name: 'Product Vis', order: 91, isActive: true } }),
  ]);
  salesFunctionId = salesFn.id;
  productFunctionId = productFn.id;

  // Main teams
  const [salesTeam] = await Promise.all([
    prisma.companyTeam.create({ data: { functionId: salesFunctionId, name: 'Sales Main', isMain: true, isActive: true } }),
    prisma.companyTeam.create({ data: { functionId: productFunctionId, name: 'Product Main', isMain: true, isActive: true } }),
  ]);
  salesTeamId = salesTeam.id;

  // Users
  const [salesUser, , adminUser] = await Promise.all([
    createUser('viewer'),
    createUser('viewer'),
    createUser('admin'),
  ]);
  salesUserId = salesUser.id;
  adminUserId = adminUser.id;

  // Memberships
  const [, brand, season] = await Promise.all([
    prisma.companyTeamMembership.create({ data: { teamId: salesTeamId, userId: salesUserId } }),
    prisma.brand.create({ data: { code: `VIS${uid}`, name: 'Vis Brand', isActive: true } }),
    prisma.season.create({ data: { code: `VS${uid}`, name: `Vis Season ${uid}`, year: 2099, isActive: true } }),
  ]);
  brandId = brand.id;
  seasonId = season.id;
  const calendar = await prisma.seasonCalendar.create({ data: { brandId, seasonId } });
  calendarId = calendar.id;

  // Milestones
  const startAt = new Date('2099-01-01');
  const [mSales, mProduct] = await Promise.all([
    prisma.calendarMilestone.create({
      data: { calendarId, ownerFunctionId: salesFunctionId, type: 'MILESTONE', title: 'Sales Milestone', startAt },
    }),
    prisma.calendarMilestone.create({
      data: { calendarId, ownerFunctionId: productFunctionId, type: 'MILESTONE', title: 'Product Milestone', startAt },
    }),
  ]);
  milestoneSalesId = mSales.id;
  milestoneProductId = mProduct.id;

  // Visibilities
  await Promise.all([
    prisma.milestoneVisibility.create({ data: { milestoneId: milestoneSalesId, functionId: salesFunctionId } }),
    prisma.milestoneVisibility.create({ data: { milestoneId: milestoneProductId, functionId: productFunctionId } }),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('getVisibleMilestoneIdsForUser', () => {
  it('utente Sales vede milestone Sales', async () => {
    const visible = await getVisibleMilestoneIdsForUser(salesUserId, [milestoneSalesId, milestoneProductId], prisma);
    expect(visible.has(milestoneSalesId)).toBe(true);
  });

  it('utente Sales NON vede milestone Product', async () => {
    const visible = await getVisibleMilestoneIdsForUser(salesUserId, [milestoneSalesId, milestoneProductId], prisma);
    expect(visible.has(milestoneProductId)).toBe(false);
  });

  it('utente Sales con MilestoneUserVisibility su Product → vede Product (override)', async () => {
    await prisma.milestoneUserVisibility.create({ data: { milestoneId: milestoneProductId, userId: salesUserId } });

    const visible = await getVisibleMilestoneIdsForUser(salesUserId, [milestoneSalesId, milestoneProductId], prisma);
    expect(visible.has(milestoneProductId)).toBe(true);

    // Cleanup
    await prisma.milestoneUserVisibility.delete({ where: { milestoneId_userId: { milestoneId: milestoneProductId, userId: salesUserId } } });
  });
});

describe('admin vede tutte le milestone via router', () => {
  it('admin senza team membership vede tutte le milestone del calendario', async () => {
    const caller = appRouter.createCaller(createContext(makeSession(adminUserId, 'admin')));
    const milestones = await caller.seasonCalendar.listMilestones({ seasonId, brandIds: [brandId] });
    const ids = milestones.map((m: any) => m.id);
    expect(ids).toContain(milestoneSalesId);
    expect(ids).toContain(milestoneProductId);
  });
});
