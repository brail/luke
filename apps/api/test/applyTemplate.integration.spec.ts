/**
 * Applying a milestone template took its anchor as an instant, so a client's local midnight east of
 * UTC would have anchored on the day before; it wrote timed items at UTC midnight, a different day
 * for readers on either side of UTC; and an offset past the year 9999 failed as a RangeError (500).
 * The anchor is now a calendar day, a timed item covers its days in the business zone — the
 * default, Europe/Rome, here — from the start of the first to the start of the day after the last
 * (ADR-035), and a result out of the supported range is refused.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let caller: ReturnType<typeof createCallerWithSession>;
let calendarId: string;

beforeAll(async () => {
  prisma = await setupTestDb();
  const admin = await createTestUser('admin');
  caller = createCallerWithSession(admin.session);
  ({ calendarId } = await createCalendarFixture(prisma, { prefix: 'TPL' }));
});

interface Item { offsetDays: number; durationDays?: number; allDay?: boolean }

/**
 * `items` applied to a planning group of their own, at `anchorDate` or, without one, at the
 * group's stored `groupAnchor`; the events' dates by item index.
 */
async function apply(items: Item[], anchorDate?: string, groupAnchor?: Date) {
  const uid = randomUUID().slice(0, 8);
  const [group, template] = await Promise.all([
    prisma.planningGroup.create({ data: { calendarId, name: `Template ${uid}`, anchorDate: groupAnchor } }),
    prisma.milestoneTemplate.create({
      data: { name: `Template ${uid}`, items: { create: items.map((item, i) => ({ title: `Item ${i}`, ...item })) } },
    }),
  ]);
  const events = await caller.seasonCalendar.applyTemplate({ planningGroupId: group.id, templateId: template.id, anchorDate });
  const iso = (d?: Date | null) => d?.toISOString() ?? null;
  return {
    groupId: group.id,
    dates: items.map((_, i) => {
      const event = events.find(e => e.title === `Item ${i}`);
      return [iso(event?.startAt), iso(event?.endAt)];
    }),
  };
}

describe('seasonCalendar.applyTemplate — dates', () => {
  it('counts all-day items from the anchor day and records the anchor', async () => {
    const { groupId, dates } = await apply([{ offsetDays: 2, durationDays: 3 }], '2026-03-10');

    expect(dates).toEqual([['2026-03-12T00:00:00.000Z', '2026-03-14T00:00:00.000Z']]);
    const group = await prisma.planningGroup.findUniqueOrThrow({ where: { id: groupId } });
    expect(group.anchorDate?.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('spans a timed item over its days in the business zone, across a DST change', async () => {
    // 12 March is CET (UTC+1); Rome moves to CEST (UTC+2) on 29 March 2026. The group's stored anchor.
    const items = [{ offsetDays: 2, allDay: false }, { offsetDays: 18, durationDays: 2, allDay: false }];
    const { dates } = await apply(items, undefined, new Date('2026-03-10T00:00:00.000Z'));

    expect(dates).toEqual([
      ['2026-03-11T23:00:00.000Z', '2026-03-12T23:00:00.000Z'],
      ['2026-03-27T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
    ]);
  });

  it('refuses an item that falls past the supported years', async () => {
    await expect(apply([{ offsetDays: 60 }], undefined, new Date('9999-12-01T00:00:00.000Z'))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
