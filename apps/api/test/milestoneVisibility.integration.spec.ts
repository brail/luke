
import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { getVisibleMilestoneIdsForUser } from '../src/services/milestoneVisibility.service';

import {
  createCallerWithSession,
  createTestUser,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

let salesFunctionId: string;
let productFunctionId: string;
let salesTeamId: string;
let salesUserId: string;
let adminSession: UserSession;
let milestoneSalesId: string;
let milestoneProductId: string;
let calendarId: string;
let brandId: string;
let seasonId: string;

beforeAll(async () => {
  // `setupTestDb()` guarantees the schema and truncates: file order isn't
  // alphabetical or stable, so no suite can assume another one has already
  // created the tables.
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
    createTestUser('viewer'),
    createTestUser('viewer'),
    createTestUser('admin'),
  ]);
  salesUserId = salesUser.user.id;
  adminSession = adminUser.session;

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

  // Calendar events.
  // `CalendarMilestone` was renamed to `CalendarEvent` (commit fbaa00f), and with
  // it `MilestoneVisibility`→`CalendarEventVisibility` and
  // `MilestoneUserVisibility`→`CalendarEventUserVisibility`. Membership is no
  // longer `ownerFunctionId` but `planningGroupId`, mandatory.
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
    const caller = createCallerWithSession(adminSession);
    const milestones = await caller.seasonCalendar.listMilestones({ seasonId, brandIds: [brandId] });
    const ids = milestones.map((m: any) => m.id);
    expect(ids).toContain(milestoneSalesId);
    expect(ids).toContain(milestoneProductId);
  });
});
