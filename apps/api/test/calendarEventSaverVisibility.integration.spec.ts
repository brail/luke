/**
 * `createMilestone` and `updateMilestone` refuse, with PRECONDITION_REQUIRED, a save after which the
 * saver could no longer see the event — visible only to functions they are not in, not shared with
 * them — unless the request confirms it (`confirmHidesFromCaller`, #199); so does
 * `revokeUserVisibility` when the caller revokes their own last way to the event. The refusal
 * leaves nothing behind; admins, who see every event, are never asked.
 */

import { randomUUID } from 'crypto';

import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { sseStore } from '../src/lib/sseStore';

import {
  createCalendarFixture,
  createCallerWithSession,
  createTestUser,
  expectedOf,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { TRPCError } from '@trpc/server';

let prisma: PrismaClient;
let adminSession: UserSession;
let editorSession: UserSession;
let viewerSession: UserSession;
let editorId: string;
let adminId: string;

let planningGroupId: string;
let calendarId: string;
let otherBrandGroupId: string;
/** The function the editor is in. */
let editorFunctionId: string;
/** A function the editor is not in (the viewer is). */
let otherFunctionId: string;

const asAdmin = () => createCallerWithSession(adminSession);
const asEditor = () => createCallerWithSession(editorSession);
const asViewer = () => createCallerWithSession(viewerSession);

const START = new Date('2099-06-01T09:00:00.000Z');

function newTitle(): string {
  return `Saver ${randomUUID().slice(0, 8)}`;
}

function createInput(title: string, functionIds: string[], confirmHidesFromCaller?: boolean) {
  return { planningGroupId, title, startAt: START.toISOString(), visibilityFunctionIds: functionIds, confirmHidesFromCaller };
}

/** An event visible to `functionIds`, shared personally with `sharedWith`. */
async function createEvent(functionIds: string[], sharedWith: string[] = []) {
  return prisma.calendarEvent.create({
    data: {
      calendarId,
      planningGroupId,
      title: newTitle(),
      startAt: START,
      visibilities: { create: functionIds.map(functionId => ({ functionId })) },
      userVisibilities: { create: sharedWith.map(userId => ({ userId })) },
    },
  });
}

async function visibleFunctionIds(eventId: string): Promise<string[]> {
  const rows = await prisma.calendarEventVisibility.findMany({ where: { eventId }, select: { functionId: true } });
  return rows.map(r => r.functionId);
}

async function auditMetadata(action: string, targetId: string) {
  return (await prisma.auditLog.findFirstOrThrow({ where: { action, targetId } })).metadata;
}

function auditRows(action: string, title: string) {
  return prisma.auditLog.count({ where: { action, metadata: { path: ['title'], equals: title } } });
}

beforeAll(async () => {
  prisma = await setupTestDb();

  const [admin, editor, viewer] = await Promise.all([
    createTestUser('admin'),
    createTestUser('editor'),
    createTestUser('viewer'),
  ]);
  adminSession = admin.session;
  editorSession = editor.session;
  viewerSession = viewer.session;
  editorId = editor.user.id;
  adminId = admin.user.id;

  const fixture = await createCalendarFixture(prisma, { prefix: 'SAV', groupName: 'Main group' });
  planningGroupId = fixture.planningGroupId;
  calendarId = fixture.calendarId;
  otherBrandGroupId = (await createCalendarFixture(prisma, { prefix: 'SVX', groupName: 'Other brand' })).planningGroupId;

  editorFunctionId = (await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [editor.user.id], label: 'Saver editor' })).functionId;
  otherFunctionId = (await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [viewer.user.id], label: 'Saver other' })).functionId;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The SSE push spied below stands for what the router does once the service returns: the push,
// then the notification and the Google sync. Those two are module functions the router imported
// before this file could mock them (`test/setup.procedureUsage.ts` loads `appRouter`); the push, a
// method on a shared object, is what a spy can count.

describe('createMilestone — an event the saver could not see', () => {
  it('is refused with PRECONDITION_REQUIRED (428), leaving no event, audit row or push behind', async () => {
    const push = vi.spyOn(sseStore, 'pushToAll');
    const title = newTitle();

    const error = await asEditor().seasonCalendar.createMilestone(createInput(title, [otherFunctionId])).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'PRECONDITION_REQUIRED', message: expect.stringContaining('non comparirà nel tuo calendario') });
    // The caller only rejects with a TRPCError; the type is not narrowed by the matcher above.
    expect(getHTTPStatusCodeFromError(error as TRPCError)).toBe(428);
    expect(await prisma.calendarEvent.count({ where: { title } })).toBe(0);
    expect(await auditRows('CALENDAR_EVENT_CREATE', title)).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('is created once confirmed, with one audit row and one push', async () => {
    const push = vi.spyOn(sseStore, 'pushToAll');
    const title = newTitle();

    const event = await asEditor().seasonCalendar.createMilestone(createInput(title, [otherFunctionId], true));

    expect(await visibleFunctionIds(event.id)).toEqual([otherFunctionId]);
    expect(await auditRows('CALENDAR_EVENT_CREATE', title)).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    // The row says the saver confirmed (#202).
    expect(await auditMetadata('CALENDAR_EVENT_CREATE', event.id)).toMatchObject({ confirmedHidesFromCaller: true });
  });

  it('needs no confirmation when the saver is in one of its functions', async () => {
    const event = await asEditor().seasonCalendar.createMilestone(createInput(newTitle(), [editorFunctionId, otherFunctionId]));

    expect((await visibleFunctionIds(event.id)).sort()).toEqual([editorFunctionId, otherFunctionId].sort());
  });

  it('needs no confirmation from an admin, who sees every event', async () => {
    const event = await asAdmin().seasonCalendar.createMilestone(createInput(newTitle(), [otherFunctionId]));

    expect(await visibleFunctionIds(event.id)).toEqual([otherFunctionId]);
  });

  it('confirmed or not, still refused to a viewer and outside the caller\'s brands', async () => {
    await expect(
      asViewer().seasonCalendar.createMilestone(createInput(newTitle(), [otherFunctionId], true))
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      asEditor().seasonCalendar.createMilestone({ ...createInput(newTitle(), [otherFunctionId], true), planningGroupId: otherBrandGroupId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('updateMilestone — new functions that would hide the event from the saver', () => {
  it('are refused, leaving the event as it was', async () => {
    const push = vi.spyOn(sseStore, 'pushToAll');
    const event = await createEvent([editorFunctionId]);

    await expect(
      asEditor().seasonCalendar.updateMilestone({
        id: event.id, data: { title: 'Nascosto', visibilityFunctionIds: [otherFunctionId] }, expected: await expectedOf(prisma, event.id),
      })
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED' });

    expect(await visibleFunctionIds(event.id)).toEqual([editorFunctionId]);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).title).toBe(event.title);
    expect(await prisma.auditLog.count({ where: { action: 'CALENDAR_EVENT_UPDATE', targetId: event.id } })).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('are saved once confirmed, with one audit row and one push', async () => {
    const push = vi.spyOn(sseStore, 'pushToAll');
    const event = await createEvent([editorFunctionId]);

    await asEditor().seasonCalendar.updateMilestone({
      id: event.id, data: { visibilityFunctionIds: [otherFunctionId] }, expected: await expectedOf(prisma, event.id), confirmHidesFromCaller: true,
    });

    expect(await visibleFunctionIds(event.id)).toEqual([otherFunctionId]);
    expect(await prisma.auditLog.count({ where: { action: 'CALENDAR_EVENT_UPDATE', targetId: event.id } })).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(await auditMetadata('CALENDAR_EVENT_UPDATE', event.id)).toMatchObject({ confirmedHidesFromCaller: true });
  });

  it('need no confirmation when the event is shared with the saver personally', async () => {
    const event = await createEvent([editorFunctionId], [editorId]);

    await asEditor().seasonCalendar.updateMilestone({
      id: event.id, data: { visibilityFunctionIds: [otherFunctionId] }, expected: await expectedOf(prisma, event.id),
    });

    expect(await visibleFunctionIds(event.id)).toEqual([otherFunctionId]);
  });

  it('confirmed after someone else moved the event, answer CONFLICT and overwrite nothing', async () => {
    const event = await createEvent([editorFunctionId]);
    const expected = await expectedOf(prisma, event.id);
    const save = { id: event.id, data: { visibilityFunctionIds: [otherFunctionId] }, expected };

    await expect(asEditor().seasonCalendar.updateMilestone(save)).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED' });
    await prisma.calendarEvent.update({ where: { id: event.id }, data: { startAt: new Date('2099-06-05T09:00:00.000Z') } });

    await expect(
      asEditor().seasonCalendar.updateMilestone({ ...save, confirmHidesFromCaller: true })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await visibleFunctionIds(event.id)).toEqual([editorFunctionId]);
  });
});

describe('revokeUserVisibility — the caller revoking their own last way to the event', () => {
  function revokedRows(eventId: string, userId: string) {
    return prisma.auditLog.count({ where: { action: 'CALENDAR_EVENT_USER_VISIBILITY_REVOKED', targetId: `${eventId}:${userId}` } });
  }

  async function grantOf(eventId: string, userId: string) {
    return prisma.calendarEventUserVisibility.count({ where: { eventId, userId } });
  }

  it('is refused with PRECONDITION_REQUIRED, keeping the grant and writing no audit row', async () => {
    const event = await createEvent([otherFunctionId], [editorId]);

    await expect(
      asEditor().seasonCalendar.revokeUserVisibility({ eventId: event.id, userIds: [editorId] })
    ).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', message: expect.stringContaining('non comparirà nel tuo calendario') });

    expect(await grantOf(event.id, editorId)).toBe(1);
    expect(await revokedRows(event.id, editorId)).toBe(0);
  });

  it('is revoked once confirmed, the confirmation marked on the caller\'s row only', async () => {
    const event = await createEvent([otherFunctionId], [editorId, adminId]);

    await asEditor().seasonCalendar.revokeUserVisibility({ eventId: event.id, userIds: [editorId, adminId], confirmHidesFromCaller: true });

    expect(await grantOf(event.id, editorId)).toBe(0);
    expect(await revokedRows(event.id, editorId)).toBe(1);
    expect(await auditMetadata('CALENDAR_EVENT_USER_VISIBILITY_REVOKED', `${event.id}:${editorId}`)).toMatchObject({ confirmedHidesFromCaller: true });
    expect(await auditMetadata('CALENDAR_EVENT_USER_VISIBILITY_REVOKED', `${event.id}:${adminId}`)).not.toHaveProperty('confirmedHidesFromCaller');
  });

  it('needs no confirmation when the caller still sees the event through a function', async () => {
    const event = await createEvent([editorFunctionId], [editorId]);

    await asEditor().seasonCalendar.revokeUserVisibility({ eventId: event.id, userIds: [editorId] });

    expect(await grantOf(event.id, editorId)).toBe(0);
  });

  it('needs no confirmation to revoke someone else\'s grant', async () => {
    const event = await createEvent([otherFunctionId], [editorId, adminId]);

    await asEditor().seasonCalendar.revokeUserVisibility({ eventId: event.id, userIds: [adminId] });

    expect(await grantOf(event.id, adminId)).toBe(0);
    expect(await grantOf(event.id, editorId)).toBe(1);
  });

  it('needs no confirmation from an admin, who sees every event', async () => {
    const event = await createEvent([otherFunctionId], [adminId]);

    await asAdmin().seasonCalendar.revokeUserVisibility({ eventId: event.id, userIds: [adminId] });

    expect(await grantOf(event.id, adminId)).toBe(0);
  });
});
