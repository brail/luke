/**
 * What a calendar event's audit rows record besides its dates (#202): the functions it starts with
 * and those an update changes, before and after; a change of phase, days relevance or title with the
 * previous value. The mark of a write confirmed past the #199 prompt is checked with those writes,
 * in `calendarEventSaverVisibility.integration.spec.ts`.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import {
  createCalendarFixture,
  createCallerWithSession,
  createTestUser,
  expectedOf,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let editorSession: UserSession;
let planningGroupId: string;
let calendarId: string;
let phaseId: string;
/** The function the editor is in. */
let editorFunctionId: string;
/** A function the editor is not in. */
let otherFunctionId: string;

const asEditor = () => createCallerWithSession(editorSession);

function newTitle(): string {
  return `Audit ${randomUUID().slice(0, 8)}`;
}

/** An event visible to `functionIds`. */
async function createEvent(functionIds: string[]) {
  return prisma.calendarEvent.create({
    data: {
      calendarId,
      planningGroupId,
      title: newTitle(),
      startAt: new Date('2099-06-01T09:00:00.000Z'),
      visibilities: { create: functionIds.map(functionId => ({ functionId })) },
    },
  });
}

async function auditRow(action: string, targetId: string) {
  return (await prisma.auditLog.findFirstOrThrow({ where: { action, targetId } })).metadata;
}

async function updateRow(eventId: string, data: Record<string, unknown>, confirmHidesFromCaller?: boolean) {
  await asEditor().seasonCalendar.updateMilestone({ id: eventId, data, expected: await expectedOf(prisma, eventId), confirmHidesFromCaller });
  return auditRow('CALENDAR_EVENT_UPDATE', eventId);
}

beforeAll(async () => {
  prisma = await setupTestDb();

  const editor = await createTestUser('editor');
  editorSession = editor.session;

  const fixture = await createCalendarFixture(prisma, { prefix: 'AUD', groupName: 'Main group' });
  planningGroupId = fixture.planningGroupId;
  calendarId = fixture.calendarId;

  editorFunctionId = (await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [editor.user.id], label: 'Audit editor' })).functionId;
  otherFunctionId = (await prisma.companyFunction.create({
    data: { slug: `audit_other_${fixture.uid}`, name: 'Audit other', order: 94, isActive: true },
  })).id;
  phaseId = (await prisma.phase.create({ data: { value: `AUD_${fixture.uid}`, label: 'Fase audit', isActive: true } })).id;
});

describe('CALENDAR_EVENT_CREATE', () => {
  it('records the functions the event starts with', async () => {
    const event = await asEditor().seasonCalendar.createMilestone({
      planningGroupId, title: newTitle(), startAt: '2099-06-01T09:00:00.000Z', visibilityFunctionIds: [editorFunctionId],
    });

    const metadata = await auditRow('CALENDAR_EVENT_CREATE', event.id);
    expect(metadata).toMatchObject({ visibilityFunctionIds: [editorFunctionId] });
    expect(metadata).not.toHaveProperty('confirmedHidesFromCaller');
  });

});

describe('CALENDAR_EVENT_UPDATE', () => {
  it('records a change of functions with the functions before and after', async () => {
    const event = await createEvent([editorFunctionId]);

    const metadata = await updateRow(event.id, { visibilityFunctionIds: [otherFunctionId, editorFunctionId] });

    expect(metadata).toMatchObject({
      oldVisibilityFunctionIds: [editorFunctionId],
      newVisibilityFunctionIds: [editorFunctionId, otherFunctionId].sort(),
      changedFields: ['Visibilità'],
    });
  });

  it('records nothing about functions sent again unchanged, in another order', async () => {
    // Created in this order, sent back in the other.
    const event = await createEvent([editorFunctionId, otherFunctionId]);

    const metadata = await updateRow(event.id, { description: 'Nota', visibilityFunctionIds: [otherFunctionId, editorFunctionId] });

    expect(metadata).not.toHaveProperty('oldVisibilityFunctionIds');
    expect(metadata).toMatchObject({ changedFields: ['Descrizione'] });
  });

  it('does not mark a confirmed save that sent no functions', async () => {
    const event = await createEvent([editorFunctionId]);

    expect(await updateRow(event.id, { description: 'Solo descrizione' }, true)).not.toHaveProperty('confirmedHidesFromCaller');
  });

  it('records a change of title, phase and days relevance with the previous values', async () => {
    const event = await createEvent([editorFunctionId]);

    const metadata = await updateRow(event.id, { title: 'Nuovo titolo', phaseId, calendarDaysRelevance: 'COMPANY' });

    expect(metadata).toMatchObject({
      title: 'Nuovo titolo',
      oldTitle: event.title,
      oldPhaseId: null,
      newPhaseId: phaseId,
      oldCalendarDaysRelevance: null,
      newCalendarDaysRelevance: 'COMPANY',
      changedFields: ['Titolo', 'Fase', 'Giorni lavorativi'],
    });
  });
});
