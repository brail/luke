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

import { buildDigestTasks, type DigestDateRange } from '../src/lib/calendarDigestScheduler';

import {
  createCallerWithSession,
  createSilentLogger,
  createTestUser,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

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
function nowRange(): DigestDateRange {
  return { start: new Date(Date.now() - 60_000), end: new Date(Date.now() + 60_000) };
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

describe('buildDigestTasks — evento creato', () => {
  it('destinatari brand-scoped: solo il team del brand giusto, nessun fan-out admin', async () => {
    const caller = createCallerWithSession(userDXSession);
    const created = await caller.seasonCalendar.createMilestone({
      planningGroupId: planningGroupDX,
      title: `Created Event ${randomUUID().slice(0, 6)}`,
      startAt: new Date().toISOString(),
      allDay: true,
      publishExternally: false,
      visibilityFunctionIds: [fnD],
    });

    const { tasks } = await buildDigestTasks(prisma, log, nowRange());
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

  it("run manuale (onlyUserId) manda comunque all'admin senza team — bypassa P_relevance, non P_access", async () => {
    const caller = createCallerWithSession(userDXSession);
    const created = await caller.seasonCalendar.createMilestone({
      planningGroupId: planningGroupDX,
      title: `Manual Bypass Event ${randomUUID().slice(0, 6)}`,
      startAt: new Date().toISOString(),
      allDay: true,
      publishExternally: false,
      visibilityFunctionIds: [fnD],
    });

    const { tasks } = await buildDigestTasks(prisma, log, nowRange(), adminNoTeamId);
    expect(tasks.map(t => t.email)).toContain(adminNoTeamEmail);

    await prisma.calendarEvent.delete({ where: { id: created.id } });
  });
});

describe('buildDigestTasks — snapshot di delete troppo largo (audit pre-fix)', () => {
  it('ri-filtra lo snapshot per brand: il destinatario fuori brand viene scartato', async () => {
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
      const { tasks } = await buildDigestTasks(prisma, log, nowRange());
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

describe('buildDigestTasks — preferenze di notifica', () => {
  it('un mute event-level (chiave non di categoria) NON sopprime il digest — era il bug secondario', async () => {
    await prisma.notificationPreference.create({
      data: { userId: userDXId, category: 'CALENDAR', eventKey: 'CALENDAR_CREATE', enabled: false },
    });
    try {
      const caller = createCallerWithSession(userDXSession);
      const created = await caller.seasonCalendar.createMilestone({
        planningGroupId: planningGroupDX,
        title: `Muted-Event-Key Event ${randomUUID().slice(0, 6)}`,
        startAt: new Date().toISOString(),
        allDay: true,
        publishExternally: false,
        visibilityFunctionIds: [fnD],
      });

      const { tasks } = await buildDigestTasks(prisma, log, nowRange());
      expect(tasks.map(t => t.email)).toContain(userDXEmail);

      await prisma.calendarEvent.delete({ where: { id: created.id } });
    } finally {
      await prisma.notificationPreference.deleteMany({ where: { userId: userDXId, eventKey: 'CALENDAR_CREATE' } });
    }
  });

  it('un mute a livello di categoria sopprime il digest per quell\'utente', async () => {
    await prisma.notificationPreference.create({
      data: { userId: userDXId, category: 'CALENDAR', eventKey: CATEGORY_LEVEL_EVENT_KEY, enabled: false },
    });
    try {
      const caller = createCallerWithSession(userDXSession);
      const created = await caller.seasonCalendar.createMilestone({
        planningGroupId: planningGroupDX,
        title: `Muted-Category Event ${randomUUID().slice(0, 6)}`,
        startAt: new Date().toISOString(),
        allDay: true,
        publishExternally: false,
        visibilityFunctionIds: [fnD],
      });

      const { tasks } = await buildDigestTasks(prisma, log, nowRange());
      expect(tasks.map(t => t.email)).not.toContain(userDXEmail);

      await prisma.calendarEvent.delete({ where: { id: created.id } });
    } finally {
      await prisma.notificationPreference.deleteMany({ where: { userId: userDXId, eventKey: CATEGORY_LEVEL_EVENT_KEY } });
    }
  });
});
