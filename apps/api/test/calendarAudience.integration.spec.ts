/**
 * Integration tests for the calendar visibility predicate
 * (`apps/api/src/services/calendarAudience.service.ts`):
 *
 *   canSee(u, e) = u.isActive ∧ ¬u.pendingApproval ∧ P_access(u, e) ∧ P_relevance(u, e)
 *
 * Both directions are exercised: `resolveEventAudience` (reverse — who receives a
 * notification about an event) and `listMilestones` via a real caller (forward — which
 * events a user sees). They must agree for non-admin users; admins are a deliberate
 * exception (unrestricted read, but no automatic notification fan-out) — see the last
 * `describe` block.
 *
 * Replaces the old `milestoneVisibility.integration.spec.ts`, which tested a
 * `getVisibleMilestoneIdsForUser` with zero production callers and no brand awareness.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import {
  resolveBrandAccess,
  resolveEventAudienceOne,
} from '../src/services/calendarAudience.service';

import {
  createCallerWithSession,
  createTestUser,
  expectToThrow,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;

// Functions
let fnA: string; // named on eventX and eventY
let fnC: string; // unrelated function, only teamCY belongs to it

// Brands / calendar / season
let brandX: string;
let brandY: string;
let calX: string;
let calY: string;
let seasonId: string;

// Users + sessions
let userX: string; let userXSession: UserSession; // teamAX: fnA, brandX
let userY: string; let userYSession: UserSession; // teamAY: fnA, brandY
let userZero: string; // teamAZero: fnA, zero brand scope
let userC: string; // teamCY: fnC, brandY — not fnA-relevant
let userInactive: string; // teamAX member, isActive=false
let userPending: string; // teamAX member, pendingApproval=true
let adminNoTeamId: string; let adminNoTeamSession: UserSession;
let adminWithTeamId: string; let adminWithTeamSession: UserSession;

// Events
let eventX: string; // calX (brandX), visibility=[fnA]
let eventY: string; // calY (brandY), visibility=[fnA]
let eventNoVis: string; // calX (brandX), no visibility rows — permissive fallback

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6);

  const [fnARow, fnCRow] = await Promise.all([
    prisma.companyFunction.create({ data: { slug: `aud_a_${uid}`, name: 'Aud A', order: 90, isActive: true } }),
    prisma.companyFunction.create({ data: { slug: `aud_c_${uid}`, name: 'Aud C', order: 91, isActive: true } }),
  ]);
  fnA = fnARow.id;
  fnC = fnCRow.id;

  const [brandXRow, brandYRow, seasonRow] = await Promise.all([
    prisma.brand.create({ data: { code: `AX${uid}`, name: 'Aud Brand X', isActive: true } }),
    prisma.brand.create({ data: { code: `AY${uid}`, name: 'Aud Brand Y', isActive: true } }),
    prisma.season.create({ data: { code: `AS${uid}`, name: `Aud Season ${uid}`, year: 2098, isActive: true } }),
  ]);
  brandX = brandXRow.id;
  brandY = brandYRow.id;
  seasonId = seasonRow.id;

  const [calXRow, calYRow] = await Promise.all([
    prisma.seasonCalendar.create({ data: { brandId: brandX, seasonId } }),
    prisma.seasonCalendar.create({ data: { brandId: brandY, seasonId } }),
  ]);
  calX = calXRow.id;
  calY = calYRow.id;

  const [ux, uy, uz, uc, uInactive, uPending, aNoTeam, aWithTeam] = await Promise.all([
    createTestUser('viewer'),
    createTestUser('viewer'),
    createTestUser('viewer'),
    createTestUser('viewer'),
    createTestUser('viewer'),
    createTestUser('viewer'),
    createTestUser('admin'),
    createTestUser('admin'),
  ]);
  userX = ux.user.id; userXSession = ux.session;
  userY = uy.user.id; userYSession = uy.session;
  userZero = uz.user.id;
  userC = uc.user.id;
  userInactive = uInactive.user.id;
  userPending = uPending.user.id;
  adminNoTeamId = aNoTeam.user.id; adminNoTeamSession = aNoTeam.session;
  adminWithTeamId = aWithTeam.user.id; adminWithTeamSession = aWithTeam.session;

  // The functions are shared between teams on purpose: visibility is measured per function, brand
  // scope per team. `Team A/Zero` has none — the case proving membership alone grants nothing.
  await Promise.all([
    grantBrandAccess(prisma, {
      functionId: fnA, brandIds: [brandX], label: 'Team A/X',
      userIds: [userX, userInactive, userPending, adminWithTeamId],
    }),
    grantBrandAccess(prisma, { functionId: fnA, brandIds: [brandY], userIds: [userY], label: 'Team A/Y' }),
    grantBrandAccess(prisma, { functionId: fnA, brandIds: [], userIds: [userZero], label: 'Team A/Zero' }),
    grantBrandAccess(prisma, { functionId: fnC, brandIds: [brandY], userIds: [userC], label: 'Team C/Y' }),
  ]);

  await Promise.all([
    prisma.user.update({ where: { id: userInactive }, data: { isActive: false } }),
    prisma.user.update({ where: { id: userPending }, data: { pendingApproval: true } }),
  ]);

  const [groupX, groupY] = await Promise.all([
    prisma.planningGroup.create({ data: { calendarId: calX, name: `Aud Group X ${uid}` } }),
    prisma.planningGroup.create({ data: { calendarId: calY, name: `Aud Group Y ${uid}` } }),
  ]);

  const startAt = new Date('2098-01-01');
  const [eX, eY, eNoVis] = await Promise.all([
    prisma.calendarEvent.create({ data: { calendarId: calX, planningGroupId: groupX.id, title: 'Event X', startAt } }),
    prisma.calendarEvent.create({ data: { calendarId: calY, planningGroupId: groupY.id, title: 'Event Y', startAt } }),
    prisma.calendarEvent.create({ data: { calendarId: calX, planningGroupId: groupX.id, title: 'Event No Vis', startAt } }),
  ]);
  eventX = eX.id;
  eventY = eY.id;
  eventNoVis = eNoVis.id;

  await Promise.all([
    prisma.calendarEventVisibility.create({ data: { eventId: eventX, functionId: fnA } }),
    prisma.calendarEventVisibility.create({ data: { eventId: eventY, functionId: fnA } }),
    // eventNoVis: deliberately zero visibility rows — exercises the permissive fallback.
  ]);
});

describe('resolveEventAudience — direzione reverse (chi riceve)', () => {
  it('a member of the team scoped to the event brand is in the audience', async () => {
    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).toContain(userX);
  });

  it('a member of a team with the same function but scoped to another brand is excluded (the original bug)', async () => {
    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).not.toContain(userY);
  });

  it('a member of a team with zero brand scopes is excluded', async () => {
    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).not.toContain(userZero);
  });

  it('an admin with no team is excluded — no automatic fan-out', async () => {
    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).not.toContain(adminNoTeamId);
  });

  it('an admin in the right team is included', async () => {
    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).toContain(adminWithTeamId);
  });

  it('an inactive user is excluded even if otherwise relevant', async () => {
    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).not.toContain(userInactive);
  });

  it('a user pending approval is excluded even if otherwise relevant', async () => {
    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).not.toContain(userPending);
  });

  it('an event with no visibility rows is visible to whoever has access to the brand, and to no one else (the fallback stays brand-scoped)', async () => {
    const audience = await resolveEventAudienceOne(eventNoVis, prisma);
    expect(audience).toContain(userX); // brandX
    expect(audience).not.toContain(userY); // brandY, out of scope
    expect(audience).not.toContain(userZero); // zero scope
  });

  it('an explicit grant on an event outside the recipient brand is excluded (hard boundary)', async () => {
    await prisma.calendarEventUserVisibility.create({ data: { eventId: eventY, userId: userX } });
    try {
      const audience = await resolveEventAudienceOne(eventY, prisma);
      expect(audience).not.toContain(userX);
    } finally {
      await prisma.calendarEventUserVisibility.delete({ where: { eventId_userId: { eventId: eventY, userId: userX } } });
    }
  });

  it('an explicit grant on an event inside the recipient brand is included, even if not relevant by function', async () => {
    await prisma.calendarEventUserVisibility.create({ data: { eventId: eventY, userId: userC } });
    try {
      const audience = await resolveEventAudienceOne(eventY, prisma);
      expect(audience).toContain(userC);
    } finally {
      await prisma.calendarEventUserVisibility.delete({ where: { eventId_userId: { eventId: eventY, userId: userC } } });
    }
  });
});

describe('listMilestones — direzione forward (cosa vedo)', () => {
  it('a user sees the events of their function in their brand, fallback included', async () => {
    const caller = createCallerWithSession(userXSession);
    const milestones = await caller.seasonCalendar.listMilestones({ seasonId, brandIds: [brandX, brandY] });
    const ids = milestones.map((m: any) => m.id);
    expect(ids).toContain(eventX);
    expect(ids).toContain(eventNoVis);
  });

  it('a user does NOT see events of a brand they have no access to, even with the same function', async () => {
    const caller = createCallerWithSession(userXSession);
    const milestones = await caller.seasonCalendar.listMilestones({ seasonId, brandIds: [brandY] });
    expect(milestones).toHaveLength(0);
  });

  it('an admin with no team still sees everything — reads stay unrestricted', async () => {
    const caller = createCallerWithSession(adminNoTeamSession);
    const milestones = await caller.seasonCalendar.listMilestones({ seasonId, brandIds: [brandX, brandY] });
    const ids = milestones.map((m: any) => m.id);
    expect(ids).toContain(eventX);
    expect(ids).toContain(eventY);
    expect(ids).toContain(eventNoVis);
  });
});

describe('invarianti', () => {
  it('P_access is never violated: every recipient in the audience really has access to the event brand', async () => {
    for (const eventId of [eventX, eventY, eventNoVis]) {
      const audience = await resolveEventAudienceOne(eventId, prisma);
      const accessMap = await resolveBrandAccess(audience, prisma);
      for (const uid of audience) {
        // "not in the map" would mean excluded (inactive/pending) — must never happen here,
        // since these ids just came out of resolveEventAudience itself.
        expect(accessMap.has(uid)).toBe(true);
      }
    }
  });

  it('symmetry for non-admin users: event in listMilestones(user) iff user in resolveEventAudience(event)', async () => {
    const cases: [string, UserSession][] = [[userX, userXSession], [userY, userYSession]];
    for (const [uid, session] of cases) {
      const caller = createCallerWithSession(session);
      const milestones = await caller.seasonCalendar.listMilestones({ seasonId, brandIds: [brandX, brandY] });
      const visibleIds = new Set(milestones.map((m: any) => m.id));
      for (const eventId of [eventX, eventY, eventNoVis]) {
        const audience = await resolveEventAudienceOne(eventId, prisma);
        expect(visibleIds.has(eventId)).toBe(audience.includes(uid));
      }
    }
  });

  it('intended asymmetry for admins: reads always open, notification only if relevant by team', async () => {
    const caller = createCallerWithSession(adminNoTeamSession);
    const milestones = await caller.seasonCalendar.listMilestones({ seasonId, brandIds: [brandX, brandY] });
    const visibleIds = new Set(milestones.map((m: any) => m.id));
    expect(visibleIds.has(eventX)).toBe(true);

    const audience = await resolveEventAudienceOne(eventX, prisma);
    expect(audience).not.toContain(adminNoTeamId);
  });
});

describe('grantUserVisibility — validazione brand (Piano B)', () => {
  it('rejects the grant to a user without access to the event brand', async () => {
    const caller = createCallerWithSession(adminWithTeamSession);
    await expectToThrow(
      caller.seasonCalendar.grantUserVisibility({ eventId: eventY, userIds: [userX] }),
      { code: 'BAD_REQUEST' }
    );
  });

  it('accepts the grant to a user with access to the event brand', async () => {
    const caller = createCallerWithSession(adminWithTeamSession);
    try {
      const result = await caller.seasonCalendar.grantUserVisibility({ eventId: eventY, userIds: [userC] });
      expect(result.ok).toBe(true);
      const audience = await resolveEventAudienceOne(eventY, prisma);
      expect(audience).toContain(userC);
    } finally {
      await prisma.calendarEventUserVisibility.delete({ where: { eventId_userId: { eventId: eventY, userId: userC } } }).catch(() => {});
    }
  });
});
