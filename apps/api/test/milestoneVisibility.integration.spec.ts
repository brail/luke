
import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { appRouter } from '../src/routers/index';
import { getVisibleMilestoneIdsForUser } from '../src/services/milestoneVisibility.service';

import { setupTestDb } from './helpers/database';
import { createSilentLogger } from './helpers/logger';

import type { UserSession } from '../src/lib/auth';
import type { Context } from '../src/lib/trpc';
import type { PrismaClient } from '@prisma/client';

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
    logger: createSilentLogger(),
    req: { headers: {}, ip: '127.0.0.1', log: createSilentLogger() } as any,
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
  // `setupTestDb()` garantisce lo schema e tronca: l'ordine dei file non è
  // alfabetico né stabile, quindi nessuna suite può assumere che un'altra
  // abbia già creato le tabelle.
  prisma = await setupTestDb();

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
    prisma.companyTeam.create({ data: { functionId: salesFunctionId, name: 'Sales Main', isActive: true } }),
    prisma.companyTeam.create({ data: { functionId: productFunctionId, name: 'Product Main', isActive: true } }),
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

  // Eventi di calendario.
  // `CalendarMilestone` è stato rinominato `CalendarEvent` (commit fbaa00f), e con
  // esso `MilestoneVisibility`→`CalendarEventVisibility` e
  // `MilestoneUserVisibility`→`CalendarEventUserVisibility`. L'appartenenza non è
  // più `ownerFunctionId` ma `planningGroupId`, obbligatorio.
  const group = await prisma.planningGroup.create({
    data: { calendarId, name: `Vis Group ${uid}` },
  });

  const startAt = new Date('2099-01-01');
  const [mSales, mProduct] = await Promise.all([
    prisma.calendarEvent.create({
      data: { calendarId, planningGroupId: group.id, title: 'Sales Milestone', startAt },
    }),
    prisma.calendarEvent.create({
      data: { calendarId, planningGroupId: group.id, title: 'Product Milestone', startAt },
    }),
  ]);
  milestoneSalesId = mSales.id;
  milestoneProductId = mProduct.id;

  // Visibilities
  await Promise.all([
    prisma.calendarEventVisibility.create({ data: { eventId: milestoneSalesId, functionId: salesFunctionId } }),
    prisma.calendarEventVisibility.create({ data: { eventId: milestoneProductId, functionId: productFunctionId } }),
  ]);
});

afterAll(async () => {
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

  it('utente Sales con CalendarEventUserVisibility su Product → vede Product (override)', async () => {
    await prisma.calendarEventUserVisibility.create({ data: { eventId: milestoneProductId, userId: salesUserId } });

    const visible = await getVisibleMilestoneIdsForUser(salesUserId, [milestoneSalesId, milestoneProductId], prisma);
    expect(visible.has(milestoneProductId)).toBe(true);

    // Cleanup
    await prisma.calendarEventUserVisibility.delete({ where: { eventId_userId: { eventId: milestoneProductId, userId: salesUserId } } });
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
