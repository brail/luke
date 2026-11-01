/**
 * The last change of an entity answers only what the entity itself would show the caller: one
 * outside its brand, or who cannot list its event, gets the same `null` as an entity with no audit
 * row or no entity at all, so the answer does not tell them apart. The sync status counts only
 * what the caller can list.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { AuditLogLastChangeTargetTypeSchema, type AuditLogLastChangeTargetType } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerWithSession, createTestUser, grantBrandAccess, setupTestDb } from './helpers';

let prisma: PrismaClient;
let adminCaller: ReturnType<typeof createCallerWithSession>;
let inScopeCaller: ReturnType<typeof createCallerWithSession>; // brand and restricted function
let otherFunctionCaller: ReturnType<typeof createCallerWithSession>; // brand, not the restricted function
let otherBrandCaller: ReturnType<typeof createCallerWithSession>;
let restrictedFn: string;
let calendarId: string;
let targets: Record<AuditLogLastChangeTargetType, string>;
let hiddenEvent: string;
let planningGroupId: string;
let otherFunctionUserId: string;

const OPEN_SYNCED = new Date('2099-05-01T00:00:00.000Z');
const HIDDEN_SYNCED = new Date('2099-06-01T00:00:00.000Z');

beforeAll(async () => {
  prisma = await setupTestDb();
  const fixture = await createCalendarFixture(prisma, { prefix: 'ALC' });
  const other = await createCalendarFixture(prisma, { prefix: 'ALO' });
  calendarId = fixture.calendarId;
  planningGroupId = fixture.planningGroupId;

  const [admin, inScope, otherFunction, otherBrand] = await Promise.all([
    createTestUser('admin'), createTestUser('editor'), createTestUser('editor'), createTestUser('editor'),
  ]);
  otherFunctionUserId = otherFunction.user.id;
  adminCaller = createCallerWithSession(admin.session);
  inScopeCaller = createCallerWithSession(inScope.session);
  otherFunctionCaller = createCallerWithSession(otherFunction.session);
  otherBrandCaller = createCallerWithSession(otherBrand.session);

  await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [otherFunction.user.id] });
  restrictedFn = (await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [inScope.user.id] })).functionId;
  await grantBrandAccess(prisma, { brandIds: [other.brandId], userIds: [otherBrand.user.id] });

  const event = (title: string) =>
    prisma.calendarEvent.create({
      data: { calendarId, planningGroupId: fixture.planningGroupId, title, startAt: new Date('2099-02-01'), allDay: true },
    });
  const layout = await prisma.collectionLayout.create({ data: { brandId: fixture.brandId, seasonId: fixture.seasonId } });
  const group = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'Gruppo' } });
  const row = await prisma.collectionLayoutRow.create({
    data: {
      collectionLayoutId: layout.id, groupId: group.id, planningGroupId: fixture.planningGroupId,
      gender: 'MAN', line: 'Line', status: 'TEST', productCategory: 'TEST',
    },
  });
  const set = await prisma.pricingParameterSet.create({
    data: {
      brandId: fixture.brandId, seasonId: fixture.seasonId, name: 'Set',
      countryCode: 'CN', qualityControlPercent: 0, transportInsuranceCost: 0, duty: 0,
      exchangeRate: 1, italyAccessoryCosts: 0, tools: 0, retailMultiplier: 2, optimalMargin: 52,
    },
  });
  const openEvent = await event('Open');
  const hidden = await event('Hidden');
  await prisma.calendarEventVisibility.create({ data: { eventId: hidden.id, functionId: restrictedFn } });
  hiddenEvent = hidden.id;

  targets = {
    CollectionLayoutRow: row.id,
    PlanningGroup: fixture.planningGroupId,
    CalendarEvent: openEvent.id,
    PricingParameterSet: set.id,
  };
  await prisma.auditLog.createMany({
    data: [...Object.entries(targets), ['CalendarEvent', hidden.id]].map(([targetType, targetId]) => (
      { action: 'TEST_CHANGE', targetType, targetId, result: 'SUCCESS', actorId: admin.user.id }
    )),
  });

  const mapping = (eventId: string, companyFunctionId: string, lastSyncedAt: Date) =>
    prisma.googleEventMapping.create({
      data: { eventId, companyFunctionId, googleEventId: randomUUID(), googleCalendarId: 'cal', contentHash: 'h', lastSyncedAt },
    });
  await mapping(openEvent.id, restrictedFn, OPEN_SYNCED);
  await mapping(hidden.id, restrictedFn, HIDDEN_SYNCED);
});

const types = AuditLogLastChangeTargetTypeSchema.options;
const lastChange = (caller: typeof adminCaller, targetType: AuditLogLastChangeTargetType, targetId: string) =>
  caller.auditLog.getLastChange({ targetType, targetId });

describe('auditLog.getLastChange', () => {
  it.each(types)('%s: answers null outside the brand', async type => {
    expect(await lastChange(otherBrandCaller, type, targets[type])).toBeNull();
  });

  it.each(types)('%s: answers the change within the brand', async type => {
    expect(await lastChange(inScopeCaller, type, targets[type])).toMatchObject({ action: 'TEST_CHANGE' });
  });

  it.each(types)('%s: answers the change to an admin', async type => {
    expect(await lastChange(adminCaller, type, targets[type])).toMatchObject({ action: 'TEST_CHANGE' });
  });

  it.each(types)('%s: answers null for an id that does not exist', async type => {
    expect(await lastChange(inScopeCaller, type, randomUUID())).toBeNull();
  });

  it('answers null for an event the caller cannot list, in its own brand', async () => {
    expect(await lastChange(otherFunctionCaller, 'CalendarEvent', hiddenEvent)).toBeNull();
    expect(await lastChange(inScopeCaller, 'CalendarEvent', hiddenEvent)).toMatchObject({ action: 'TEST_CHANGE' });
  });
});

describe('auditLog.getLastChange, within scope', () => {
  const newEvent = (title: string) =>
    prisma.calendarEvent.create({ data: { calendarId, planningGroupId, title, startAt: new Date('2099-02-02'), allDay: true } });

  it('answers null for a target with no successful change', async () => {
    const { id } = await newEvent('Failed only');
    await prisma.auditLog.create({ data: { action: 'TEST_CHANGE', targetType: 'CalendarEvent', targetId: id, result: 'FAILURE' } });

    expect(await lastChange(inScopeCaller, 'CalendarEvent', id)).toBeNull();
  });

  it('answers the change of an event shared with the caller by name', async () => {
    const { id } = await newEvent('Shared');
    await prisma.calendarEventVisibility.create({ data: { eventId: id, functionId: restrictedFn } });
    await prisma.auditLog.create({ data: { action: 'TEST_CHANGE', targetType: 'CalendarEvent', targetId: id, result: 'SUCCESS' } });
    expect(await lastChange(otherFunctionCaller, 'CalendarEvent', id)).toBeNull();

    await prisma.calendarEventUserVisibility.create({ data: { eventId: id, userId: otherFunctionUserId } });

    expect(await lastChange(otherFunctionCaller, 'CalendarEvent', id)).toMatchObject({ action: 'TEST_CHANGE' });
  });
});

describe('seasonCalendar.getSyncStatus', () => {
  it('counts and dates only the events the caller can list', async () => {
    const seen = await otherFunctionCaller.seasonCalendar.getSyncStatus({ calendarId });

    expect(seen).toMatchObject({
      totalSynced: 1,
      lastSyncedAt: OPEN_SYNCED,
      byFunction: { [restrictedFn]: { count: 1, lastSyncedAt: OPEN_SYNCED } },
    });
  });

  it('counts everything for a member of the functions and for an admin', async () => {
    for (const caller of [inScopeCaller, adminCaller]) {
      expect(await caller.seasonCalendar.getSyncStatus({ calendarId })).toMatchObject({ totalSynced: 2, lastSyncedAt: HIDDEN_SYNCED });
    }
  });
});
