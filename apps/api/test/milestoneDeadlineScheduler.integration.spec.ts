/**
 * `checkDeadlines` against the database — what the pure rules (`milestoneDeadlineScheduler.spec.ts`)
 * cannot show: a calendar notifies until it is archived; the rows late on a phase come as one notice
 * per event; a user who muted a kind stays out of the dedup ledger, so unmuting it brings the
 * occurrence still running; each overdue stage is sent once, then nothing.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { checkDeadlines } from '../src/lib/milestoneDeadlineScheduler';

import { createCalendarFixture, createSilentLogger, createTestUser, grantBrandAccess, setupTestDb, type CalendarFixture } from './helpers';

const log = createSilentLogger();
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const uid = randomUUID().substring(0, 6);

let prisma: PrismaClient;
let live: CalendarFixture;
let userId: string;
let mutedId: string;
let eventId: string;

/** The notices `id` received, oldest first. */
async function noticesOf(id: string) {
  return prisma.notification.findMany({ where: { userId: id }, orderBy: { createdAt: 'asc' }, select: { title: true, message: true } });
}

beforeAll(async () => {
  prisma = await setupTestDb();
  // `live` stays DRAFT, the status every calendar has in practice.
  let archived: CalendarFixture;
  [live, archived] = await Promise.all([createCalendarFixture(prisma, { prefix: 'MDL' }), createCalendarFixture(prisma, { prefix: 'MDX' })]);
  await prisma.seasonCalendar.update({ where: { id: archived.calendarId }, data: { status: 'ARCHIVED' } });

  const [user, muted] = await Promise.all([createTestUser('editor'), createTestUser('editor')]);
  userId = user.user.id;
  mutedId = muted.user.id;
  await grantBrandAccess(prisma, { brandIds: [live.brandId, archived.brandId], userIds: [userId, mutedId], label: 'Deadline' });
  await prisma.notificationPreference.create({
    data: { userId: mutedId, category: 'CALENDAR', eventKey: 'CALENDAR_DEADLINE_OVERDUE', enabled: false },
  });

  // Timed deadlines an hour ago: reached today (yesterday just after midnight), stage 0 either way.
  const passedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
  const phase = await prisma.phase.create({ data: { value: `MDP_${uid}`, label: 'Sviluppo', order: 300, isActive: true } });
  const [event] = await Promise.all([
    prisma.calendarEvent.create({
      data: { calendarId: live.calendarId, planningGroupId: live.planningGroupId, title: `Sviluppo ${uid}`, startAt: passedAt, allDay: false, phaseId: phase.id },
    }),
    prisma.calendarEvent.create({
      data: { calendarId: archived.calendarId, planningGroupId: archived.planningGroupId, title: `Archiviato ${uid}`, startAt: passedAt, allDay: false },
    }),
  ]);
  eventId = event.id;

  const layout = await prisma.collectionLayout.create({ data: { brandId: live.brandId, seasonId: live.seasonId } });
  const group = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'Gruppo' } });
  const row = (line: string, completedAt: Date | null = null) => ({
    collectionLayoutId: layout.id, groupId: group.id, planningGroupId: live.planningGroupId,
    gender: 'MAN', line, status: 'TEST', productCategory: 'TEST', phaseId: phase.id, completedAt,
  });
  await prisma.collectionLayoutRow.createMany({ data: [row('Linea B'), row('Linea A'), row('Chiusa', NOW)] });

  await checkDeadlines(prisma, log, NOW);
});

describe('checkDeadlines', () => {
  it('notifies from a calendar until it is archived, with the rows late on a phase in one notice', async () => {
    const context = `MDL Brand ${live.uid} · MDL Season ${live.uid}`;
    expect(await noticesOf(userId)).toEqual(expect.arrayContaining([
      { title: 'Milestone scaduta', message: `"Sviluppo ${uid}" è scaduta senza essere completata · ${context}` },
      { title: 'Fase scaduta', message: `2 righe non hanno completato "Sviluppo ${uid}" entro la scadenza · ${context}: Linea A, Linea B` },
    ]));
    expect(await noticesOf(userId)).toHaveLength(2);
  });

  it('leaves a muted user out of the ledger, so unmuting brings the running occurrence', async () => {
    expect((await noticesOf(mutedId)).map(n => n.title)).toEqual(['Fase scaduta']);
    expect(await prisma.notificationDedupKey.count({ where: { key: { startsWith: `milestone:${mutedId}:${eventId}:overdue:` } } })).toBe(0);

    await prisma.notificationPreference.deleteMany({ where: { userId: mutedId } });
    await checkDeadlines(prisma, log, NOW);
    expect((await noticesOf(mutedId)).map(n => n.title).sort()).toEqual(['Fase scaduta', 'Milestone scaduta']);
  });

  it('sends each overdue stage once, then nothing', async () => {
    await checkDeadlines(prisma, log, NOW);
    expect(await noticesOf(userId)).toHaveLength(2);

    await checkDeadlines(prisma, log, new Date(NOW.getTime() + 3 * DAY_MS));
    expect((await noticesOf(userId)).map(n => n.title).sort()).toEqual(['Fase scaduta', 'Fase scaduta', 'Milestone scaduta', 'Milestone scaduta']);

    await checkDeadlines(prisma, log, new Date(NOW.getTime() + 6 * DAY_MS));
    expect(await noticesOf(userId)).toHaveLength(4);
  });
});
