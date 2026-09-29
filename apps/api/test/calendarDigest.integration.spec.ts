/**
 * Integration tests for `buildDigestTasks` (apps/api/src/lib/calendarDigestScheduler.ts) —
 * the recipient-building half of the calendar digest, extracted from the SMTP-sending half
 * specifically so it can be tested without mocking nodemailer.
 *
 * Covers what the original bug report and the redesign both targeted:
 *  - recipients are brand-scoped (the actual bug: a same-function, different-brand teammate
 *    used to receive every calendar's recap)
 *  - no automatic admin fan-out
 *  - the actor gets an email only because they're legitimately in the audience, not via a
 *    special case
 *  - deleted-event snapshots (`AuditLog.metadata.visibleUserIds`), which may be wider than the
 *    current audience on old rows, get re-filtered by brand at read time
 *  - the opt-out query only honors a category-level mute, not an unrelated event-level one
 *    (the secondary bug found alongside the main one)
 *  - the manual "send to me" trigger bypasses P_relevance but not P_access
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { CATEGORY_LEVEL_EVENT_KEY } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { buildDigestTasks, type DigestBuildOptions } from '../src/lib/calendarDigestScheduler';

import {
  createCallerWithSession,
  createSilentLogger,
  createTestUser,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
const log = createSilentLogger();

let fnD: string;
let brandDX: string;
let brandDY: string;
let calDX: string;
let planningGroupDX: string;

let userDXId: string; let userDXEmail: string; let userDXSession: UserSession;
let userDYId: string; let userDYEmail: string;
let adminNoTeamId: string; let adminNoTeamEmail: string;

/** Covers "just now" — every scenario below writes its AuditLog rows synchronously before use. */
function justNow(): DigestBuildOptions {
  return { range: { start: new Date(Date.now() - 60_000), end: new Date(Date.now() + 60_000) }, timeZone: 'Europe/Rome' };
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6);

  const fnRow = await prisma.companyFunction.create({
    data: { slug: `dig_d_${uid}`, name: 'Digest D', order: 92, isActive: true },
  });
  fnD = fnRow.id;

  const [brandDXRow, brandDYRow, seasonRow] = await Promise.all([
    prisma.brand.create({ data: { code: `DX${uid}`, name: 'Digest Brand X', isActive: true } }),
    prisma.brand.create({ data: { code: `DY${uid}`, name: 'Digest Brand Y', isActive: true } }),
    prisma.season.create({ data: { code: `DS${uid}`, name: `Digest Season ${uid}`, year: 2097, isActive: true } }),
  ]);
  brandDX = brandDXRow.id;
  brandDY = brandDYRow.id;

  const calDXRow = await prisma.seasonCalendar.create({ data: { brandId: brandDX, seasonId: seasonRow.id } });
  calDX = calDXRow.id;
  planningGroupDX = (await prisma.planningGroup.create({ data: { calendarId: calDX, name: `Digest Group ${uid}` } })).id;

  const [dx, dy, aNoTeam] = await Promise.all([
    createTestUser('editor'),
    createTestUser('editor'),
    createTestUser('admin'),
  ]);
  userDXId = dx.user.id; userDXEmail = dx.user.email; userDXSession = dx.session;
  userDYId = dy.user.id; userDYEmail = dy.user.email;
  adminNoTeamId = aNoTeam.user.id; adminNoTeamEmail = aNoTeam.user.email;

  // Both teams hang off `fnD`: the two users share an audience but not a brand, which is the whole
  // point of the fan-out assertions below.
  await Promise.all([
    grantBrandAccess(prisma, { brandIds: [brandDX], userIds: [userDXId], functionId: fnD, label: 'Digest X' }),
    grantBrandAccess(prisma, { brandIds: [brandDY], userIds: [userDYId], functionId: fnD, label: 'Digest Y' }),
  ]);
});

/** Today as an all-day value: the UTC midnight of today's date, the only form one is stored in. */
function todayAllDay(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

describe('buildDigestTasks — event created', () => {
  it('brand-scoped recipients: only the right brand team, no admin fan-out', async () => {
    const caller = createCallerWithSession(userDXSession);
    const created = await caller.seasonCalendar.createMilestone({
      planningGroupId: planningGroupDX,
      title: `Created Event ${randomUUID().slice(0, 6)}`,
      startAt: todayAllDay(),
      allDay: true,
      publishExternally: false,
      visibilityFunctionIds: [fnD],
    });

    const { tasks } = await buildDigestTasks(prisma, log, justNow());
    const emails = tasks.map(t => t.email);

    // The actor (userDX) is here because they're legitimately in the audience (their own team,
    // right brand) — not via a special "always include the actor" case, which was removed.
    expect(emails).toContain(userDXEmail);
    // Same function, wrong brand — the bug this whole redesign started from.
    expect(emails).not.toContain(userDYEmail);
    // No automatic admin fan-out.
    expect(emails).not.toContain(adminNoTeamEmail);

    await prisma.calendarEvent.delete({ where: { id: created.id } });
  });

  it('writes user-entered text into the email as text, never as markup', async () => {
    const caller = createCallerWithSession(userDXSession);
    // Created in the window: listed as new, with its title.
    const created = await caller.seasonCalendar.createMilestone({
      planningGroupId: planningGroupDX, title: `<a href="https://evil.example">Clicca ${randomUUID().slice(0, 6)}</a>`,
      startAt: todayAllDay(), allDay: true, publishExternally: false, visibilityFunctionIds: [fnD],
    });
    // Created before the window (no audit row) and cancelled in it: listed as changed, with its reason.
    const earlier = await prisma.calendarEvent.create({
      data: {
        calendarId: calDX, planningGroupId: planningGroupDX, title: `Esistente ${randomUUID().slice(0, 6)}`,
        startAt: new Date(todayAllDay()), allDay: true, visibilities: { create: [{ functionId: fnD }] },
      },
    });
    await caller.seasonCalendar.cancelMilestone({ id: earlier.id, reason: '<b>motivo</b> & "altro"' });

    const { tasks } = await buildDigestTasks(prisma, log, justNow());
    const html = tasks.find(t => t.email === userDXEmail)?.html ?? '';
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).toContain('&lt;b&gt;motivo&lt;/b&gt; &amp; &quot;altro&quot;');
    expect(html).not.toContain('<b>motivo</b>');

    await prisma.calendarEvent.deleteMany({ where: { id: { in: [created.id, earlier.id] } } });
  });

  it('lists a motivated reschedule as a date change, with its reason', async () => {
    const caller = createCallerWithSession(userDXSession);
    const event = await prisma.calendarEvent.create({
      data: {
        calendarId: calDX, planningGroupId: planningGroupDX, title: `Spostato ${randomUUID().slice(0, 6)}`,
        startAt: new Date('2099-10-10T00:00:00.000Z'), allDay: true, visibilities: { create: [{ functionId: fnD }] },
      },
    });
    await caller.seasonCalendar.rescheduleMilestone({ id: event.id, startAt: '2099-10-12T00:00:00.000Z', reason: 'Ritardo fornitore' });

    const { tasks } = await buildDigestTasks(prisma, log, justNow());
    const html = tasks.find(t => t.email === userDXEmail)?.html ?? '';
    expect(html).toContain(event.title);
    expect(html).toMatch(/Posticipato: [^<]*10[^<]*→[^<]*12[^<]*Ritardo fornitore/);

    await prisma.calendarEvent.delete({ where: { id: event.id } });
  });

  it('reads the old kind of a reschedule that turned a timed event all-day from its own record', async () => {
    const caller = createCallerWithSession(userDXSession);
    const event = await prisma.calendarEvent.create({
      data: {
        calendarId: calDX, planningGroupId: planningGroupDX, title: `Giornata ${randomUUID().slice(0, 6)}`,
        // 23:30 UTC on the 10th is the 11th in Rome, the recipient's zone: read as all-day it would be the 10th.
        startAt: new Date('2099-10-10T23:30:00.000Z'), allDay: false, visibilities: { create: [{ functionId: fnD }] },
      },
    });
    await caller.seasonCalendar.rescheduleMilestone({ id: event.id, startAt: '2099-10-12T00:00:00.000Z', allDay: true, reason: 'Tutto il giorno' });

    const { tasks } = await buildDigestTasks(prisma, log, justNow());
    const html = tasks.find(t => t.email === userDXEmail)?.html ?? '';
    expect(html).toMatch(/Posticipato: [^<]*11[^<]*→[^<]*12/);

    await prisma.calendarEvent.delete({ where: { id: event.id } });
  });

  it('a date outside 1900–9999 in an audit row degrades that entry, not the whole digest', async () => {
    const event = await prisma.calendarEvent.create({
      data: {
        calendarId: calDX, planningGroupId: planningGroupDX, title: `Anno 26 ${randomUUID().slice(0, 6)}`,
        startAt: new Date('2099-10-10T00:00:00.000Z'), allDay: true, visibilities: { create: [{ functionId: fnD }] },
      },
    });
    // An update that repaired a year typed as "26": its record keeps the old value.
    await prisma.auditLog.create({
      data: {
        actorId: userDXId, action: 'CALENDAR_EVENT_UPDATE', targetType: 'CalendarEvent', targetId: event.id, result: 'SUCCESS',
        metadata: { title: event.title, calendarId: calDX, oldStartAt: '0026-10-10T00:00:00.000Z', allDay: true, changedFields: ['Titolo'] },
      },
    });

    const { tasks } = await buildDigestTasks(prisma, log, justNow());
    expect(tasks.find(t => t.email === userDXEmail)?.html).toContain(event.title);

    await prisma.calendarEvent.delete({ where: { id: event.id } });
  });

  it('an update that changes the kind records the old one, and the digest reads the move from it', async () => {
    const caller = createCallerWithSession(userDXSession);
    const event = await prisma.calendarEvent.create({
      data: {
        calendarId: calDX, planningGroupId: planningGroupDX, title: `Tipo ${randomUUID().slice(0, 6)}`,
        // 23:30 UTC on the 10th is the 11th in Rome: read as all-day it would be the 10th.
        startAt: new Date('2099-10-10T23:30:00.000Z'), allDay: false, visibilities: { create: [{ functionId: fnD }] },
      },
    });
    await caller.seasonCalendar.updateMilestone({ id: event.id, data: { allDay: true, startAt: '2099-10-12T00:00:00.000Z' } });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: event.id, action: 'CALENDAR_EVENT_UPDATE' } });
    expect(audit.metadata).toMatchObject({ oldAllDay: false, allDay: true });
    const { tasks } = await buildDigestTasks(prisma, log, justNow());
    expect(tasks.find(t => t.email === userDXEmail)?.html).toMatch(/Posticipato: [^<]*11[^<]*→[^<]*12/);

    await prisma.calendarEvent.delete({ where: { id: event.id } });
  });

  it("a manual run (onlyUserId) still sends to the admin with no team — it bypasses P_relevance, not P_access", async () => {
    const caller = createCallerWithSession(userDXSession);
    const created = await caller.seasonCalendar.createMilestone({
      planningGroupId: planningGroupDX,
      title: `Manual Bypass Event ${randomUUID().slice(0, 6)}`,
      startAt: todayAllDay(),
      allDay: true,
      publishExternally: false,
      visibilityFunctionIds: [fnD],
    });

    const { tasks } = await buildDigestTasks(prisma, log, { ...justNow(), onlyUserId: adminNoTeamId });
    expect(tasks.map(t => t.email)).toContain(adminNoTeamEmail);

    await prisma.calendarEvent.delete({ where: { id: created.id } });
  });
});

describe('buildDigestTasks — delete snapshot too wide (pre-fix audit)', () => {
  it('re-filters the snapshot by brand: the out-of-brand recipient is dropped', async () => {
    // Simulates an AuditLog row written by the pre-fix resolver: `visibleUserIds` includes
    // userDY, who has no access to brandDX. The event itself no longer exists — only the audit
    // row does — so this exercises resolveBrandAccess's re-filter, not resolveEventAudience.
    const phantomEventId = randomUUID();
    const auditRow = await prisma.auditLog.create({
      data: {
        actorId: userDXId,
        action: 'CALENDAR_MILESTONE_DELETE',
        targetType: 'CalendarMilestone',
        targetId: phantomEventId,
        result: 'SUCCESS',
        metadata: {
          title: 'Phantom deleted event',
          calendarId: calDX,
          visibleUserIds: [userDXId, userDYId],
          startAt: new Date().toISOString(),
          endAt: null,
          allDay: true,
        },
      },
    });

    try {
      const { tasks } = await buildDigestTasks(prisma, log, justNow());
      const emails = tasks.map(t => t.email);
      expect(emails).toContain(userDXEmail);
      expect(emails).not.toContain(userDYEmail);
    } finally {
      // Otherwise this row's own recipient (userDX) would aggregate into their digest task in
      // every later test in this file, masking a regression in the notification-preference tests.
      await prisma.auditLog.delete({ where: { id: auditRow.id } });
    }
  });
});

describe('buildDigestTasks — notification preferences', () => {
  it('an event-level mute (a non-category key) does NOT suppress the digest — that was the secondary bug', async () => {
    await prisma.notificationPreference.create({
      data: { userId: userDXId, category: 'CALENDAR', eventKey: 'CALENDAR_CREATE', enabled: false },
    });
    try {
      const caller = createCallerWithSession(userDXSession);
      const created = await caller.seasonCalendar.createMilestone({
        planningGroupId: planningGroupDX,
        title: `Muted-Event-Key Event ${randomUUID().slice(0, 6)}`,
        startAt: todayAllDay(),
        allDay: true,
        publishExternally: false,
        visibilityFunctionIds: [fnD],
      });

      const { tasks } = await buildDigestTasks(prisma, log, justNow());
      expect(tasks.map(t => t.email)).toContain(userDXEmail);

      await prisma.calendarEvent.delete({ where: { id: created.id } });
    } finally {
      await prisma.notificationPreference.deleteMany({ where: { userId: userDXId, eventKey: 'CALENDAR_CREATE' } });
    }
  });

  it('a category-level mute suppresses the digest for that user', async () => {
    await prisma.notificationPreference.create({
      data: { userId: userDXId, category: 'CALENDAR', eventKey: CATEGORY_LEVEL_EVENT_KEY, enabled: false },
    });
    try {
      const caller = createCallerWithSession(userDXSession);
      const created = await caller.seasonCalendar.createMilestone({
        planningGroupId: planningGroupDX,
        title: `Muted-Category Event ${randomUUID().slice(0, 6)}`,
        startAt: todayAllDay(),
        allDay: true,
        publishExternally: false,
        visibilityFunctionIds: [fnD],
      });

      const { tasks } = await buildDigestTasks(prisma, log, justNow());
      expect(tasks.map(t => t.email)).not.toContain(userDXEmail);

      await prisma.calendarEvent.delete({ where: { id: created.id } });
    } finally {
      await prisma.notificationPreference.deleteMany({ where: { userId: userDXId, eventKey: CATEGORY_LEVEL_EVENT_KEY } });
    }
  });
});
