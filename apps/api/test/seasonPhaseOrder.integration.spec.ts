/**
 * `phaseAlert.seasonPhaseOrder` (#159): a layout's phases in season order — the phases its calendar
 * plans, each by its earliest deadline in any planning group, then the other active phases by
 * label. A cancelled event plans nothing; a layout outside the caller's brands is refused.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let admin: UserSession;
let outsider: UserSession;
let layoutId: string;
const phaseIds: Record<string, string> = {};

beforeAll(async () => {
  prisma = await setupTestDb();
  [admin, outsider] = (await Promise.all([createTestUser('admin'), createTestUser('editor')])).map(u => u.session);
  const fixture = await createCalendarFixture(prisma, { prefix: 'SPO' });
  const other = await prisma.planningGroup.create({ data: { calendarId: fixture.calendarId, name: `SPO other ${fixture.uid}` } });
  const uid = randomUUID().substring(0, 6);
  for (const label of ['Disegno', 'Prototipo', 'Campioni', 'Mai pianificata']) {
    phaseIds[label] = (await prisma.phase.create({ data: { value: `SPO_${label}_${uid}`, label, isActive: true } })).id;
  }

  const event = (planningGroupId: string, label: string, day: string, cancelledAt: Date | null = null) => ({
    calendarId: fixture.calendarId, planningGroupId, phaseId: phaseIds[label], title: label, startAt: new Date(day), allDay: true, cancelledAt,
  });
  await prisma.calendarEvent.createMany({
    data: [
      // Prototipo comes first in the season: its earliest deadline, in the other group, is in January.
      event(fixture.planningGroupId, 'Disegno', '2031-02-01'),
      event(fixture.planningGroupId, 'Prototipo', '2031-03-01'),
      event(other.id, 'Prototipo', '2031-01-15'),
      event(other.id, 'Campioni', '2031-04-01'),
      // A cancelled event places nothing.
      event(fixture.planningGroupId, 'Mai pianificata', '2030-12-01', new Date()),
    ],
  });
  layoutId = (await prisma.collectionLayout.create({ data: { brandId: fixture.brandId, seasonId: fixture.seasonId } })).id;
});

describe('phaseAlert.seasonPhaseOrder', () => {
  it('lists the planned phases by their earliest deadline in any group, then the others', async () => {
    const order = await createCallerWithSession(admin).phaseAlert.seasonPhaseOrder({ collectionLayoutId: layoutId });

    expect(order.slice(0, 3)).toEqual([phaseIds['Prototipo'], phaseIds['Disegno'], phaseIds['Campioni']]);
    // Only cancelled events carried it: it follows, with the rest of the catalog.
    expect(order.indexOf(phaseIds['Mai pianificata'])).toBeGreaterThan(2);
  });

  it('refuses a layout outside the caller\'s brands', async () => {
    await expect(createCallerWithSession(outsider).phaseAlert.seasonPhaseOrder({ collectionLayoutId: layoutId }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
