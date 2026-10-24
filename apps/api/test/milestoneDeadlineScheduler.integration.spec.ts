/**
 * `checkDeadlines` against the database — what the pure rules (`milestoneDeadlineScheduler.spec.ts`)
 * cannot show: a past event sends nothing of its own, only the rows late on its phase, as one notice
 * per event (#171); a calendar notifies until it is archived; a user who muted a kind stays out of
 * the dedup ledger, so unmuting it brings the occurrence still running; each overdue stage is sent
 * once, then nothing.
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

/** The notices `id` received that name the event titled `title`. */
async function noticesAbout(id: string, title: string) {
  return (await noticesOf(id)).filter(n => n.message.includes(`"${title}"`));
}

beforeAll(async () => {
  prisma = await setupTestDb();
  // `live` stays DRAFT, the status every calendar has in practice.
  let archived: CalendarFixture;
  [live, archived] = await Promise.all([createCalendarFixture(prisma, { prefix: 'MDL' }), createCalendarFixture(prisma, { prefix: 'MDX' })]);
  await prisma.seasonCalendar.update({ where: { id: archived.calendarId }, data: { status: 'ARCHIVED' } });
  const completedGroup = await prisma.planningGroup.create({ data: { calendarId: live.calendarId, name: `MDL Completed ${uid}` } });

  const [user, muted] = await Promise.all([createTestUser('editor'), createTestUser('editor')]);
  userId = user.user.id;
  mutedId = muted.user.id;
  await grantBrandAccess(prisma, { brandIds: [live.brandId, archived.brandId], userIds: [userId, mutedId], label: 'Deadline' });
  await prisma.notificationPreference.create({
    data: { userId: mutedId, category: 'CALENDAR', eventKey: 'CALENDAR_PHASE_OVERDUE', enabled: false },
  });

  // Timed deadlines an hour ago: reached today (yesterday just after midnight), stage 0 either way.
  const passedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
  const phase = await prisma.phase.create({ data: { value: `MDP_${uid}`, label: 'Sviluppo', isActive: true } });
  const [event] = await Promise.all([
    prisma.calendarEvent.create({
      data: { calendarId: live.calendarId, planningGroupId: live.planningGroupId, title: `Sviluppo ${uid}`, startAt: passedAt, allDay: false, phaseId: phase.id },
    }),
    // Past, with no phase: nothing can complete it, so nothing is sent once its date is gone.
    prisma.calendarEvent.create({
      data: { calendarId: live.calendarId, planningGroupId: live.planningGroupId, title: `Riunione ${uid}`, startAt: passedAt, allDay: false },
    }),
    // Past, on a phase every row of its group concluded.
    prisma.calendarEvent.create({
      data: { calendarId: live.calendarId, planningGroupId: completedGroup.id, title: `Completata ${uid}`, startAt: passedAt, allDay: false, phaseId: phase.id },
    }),
    // Coming due tomorrow: the one notice an event still sends of its own.
    prisma.calendarEvent.create({
      data: { calendarId: live.calendarId, planningGroupId: live.planningGroupId, title: `Consegna ${uid}`, startAt: new Date(NOW.getTime() + DAY_MS), allDay: false },
    }),
    // Coming due tomorrow on an archived calendar: notified anywhere else.
    prisma.calendarEvent.create({
      data: { calendarId: archived.calendarId, planningGroupId: archived.planningGroupId, title: `Archiviato ${uid}`, startAt: new Date(NOW.getTime() + DAY_MS), allDay: false },
    }),
  ]);
  eventId = event.id;

  const layout = await prisma.collectionLayout.create({ data: { brandId: live.brandId, seasonId: live.seasonId } });
  const group = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'Gruppo' } });
  const row = (line: string, planningGroupId: string, completedAt: Date | null = null) => ({
    collectionLayoutId: layout.id, groupId: group.id, planningGroupId,
    gender: 'MAN', line, status: 'TEST', productCategory: 'TEST', phaseId: phase.id, completedAt,
  });
  const onTime = new Date(passedAt.getTime() - DAY_MS);
  await prisma.collectionLayoutRow.createMany({
    data: [
      row('Linea B', live.planningGroupId), row('Linea A', live.planningGroupId), row('Chiusa', live.planningGroupId, NOW),
      row('Linea C', completedGroup.id, onTime), row('Linea D', completedGroup.id, onTime),
    ],
  });

  await checkDeadlines(prisma, log, NOW);
});

describe('checkDeadlines', () => {
  it('sends nothing for a past event with no phase', async () => {
    expect(await noticesAbout(userId, `Riunione ${uid}`)).toEqual([]);
  });

  it('sends nothing for a past phase event whose rows are all concluded', async () => {
    expect(await noticesAbout(userId, `Completata ${uid}`)).toEqual([]);
  });

  it('names the rows late on a past phase event in one notice, and sends nothing for the event itself', async () => {
    const context = `MDL Brand ${live.uid} · MDL Season ${live.uid}`;
    expect(await noticesAbout(userId, `Sviluppo ${uid}`)).toEqual([
      { title: 'Fase scaduta', message: `2 righe non hanno completato "Sviluppo ${uid}" entro la scadenza · ${context}: Linea A, Linea B` },
    ]);
  });

  it('still announces a deadline coming due, from a calendar until it is archived', async () => {
    // "domani", or "tra 2 giorni" when NOW + 24 h crosses the short day of a DST change: either is upcoming.
    expect((await noticesOf(userId)).filter(n => n.title === 'Milestone in scadenza')).toEqual([
      { title: 'Milestone in scadenza', message: expect.stringMatching(new RegExp(`^"Consegna ${uid}" scade `)) },
    ]);
  });

  it('leaves a muted user out of the ledger, so unmuting brings the running occurrence', async () => {
    expect(await noticesAbout(mutedId, `Sviluppo ${uid}`)).toEqual([]);
    expect(await prisma.notificationDedupKey.count({ where: { key: { startsWith: `milestone:${mutedId}:${eventId}:phase_overdue:` } } })).toBe(0);

    await prisma.notificationPreference.deleteMany({ where: { userId: mutedId } });
    await checkDeadlines(prisma, log, NOW);
    expect((await noticesAbout(mutedId, `Sviluppo ${uid}`)).map(n => n.title)).toEqual(['Fase scaduta']);
  });

  it('sends each overdue stage once, then nothing', async () => {
    const sent = async () => (await noticesAbout(userId, `Sviluppo ${uid}`)).map(n => n.title);
    await checkDeadlines(prisma, log, NOW);
    expect(await sent()).toEqual(['Fase scaduta']);

    await checkDeadlines(prisma, log, new Date(NOW.getTime() + 3 * DAY_MS));
    expect(await sent()).toEqual(['Fase scaduta', 'Fase scaduta']);

    await checkDeadlines(prisma, log, new Date(NOW.getTime() + 6 * DAY_MS));
    expect(await sent()).toEqual(['Fase scaduta', 'Fase scaduta']);
  });
});
