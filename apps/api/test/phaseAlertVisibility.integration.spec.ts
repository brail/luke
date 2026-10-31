/**
 * The alert surfaces show what the calendar shows: a user outside an event's functions learns the
 * band of a row measured against it, never which event it is, when it falls or how far away it is.
 * The engine stays viewer-independent, so the band is the same for everyone.
 */

import { randomUUID } from 'crypto';

import ExcelJS from 'exceljs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerWithSession, createTestUser, grantBrandAccess, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminCaller: ReturnType<typeof createCallerWithSession>;
let memberCaller: ReturnType<typeof createCallerWithSession>; // functions: open and restricted
let outsiderCaller: ReturnType<typeof createCallerWithSession>; // functions: open only
let adminUserId: string;
let openFn: string;
let restrictedFn: string;
let layoutId: string;
let collectionGroupId: string;
let planningGroupId: string;
let firstEvent: string;
let secondEvent: string;
const phaseIds: string[] = [];

/** Who sees each event: `restricted` limits it to the function the outsider is not in. */
async function setVisibility(eventId: string, audience: 'restricted' | 'open') {
  await prisma.calendarEventVisibility.deleteMany({ where: { eventId } });
  await prisma.calendarEventVisibility.create({
    data: { eventId, functionId: audience === 'restricted' ? restrictedFn : openFn },
  });
}

async function createRow(line: string, data: { phaseId?: string; completedAt?: Date } = {}) {
  const row = await prisma.collectionLayoutRow.create({
    data: {
      collectionLayoutId: layoutId, groupId: collectionGroupId, planningGroupId,
      gender: 'MAN', line, status: 'TEST', productCategory: 'TEST', ...data,
    },
  });
  return row.id;
}

const HIDDEN = { eventId: null, eventTitle: null, deadlineDay: null, daysMode: 'calendar', relevantCountryCodes: [] };
const HIDDEN_ACTIVE = { ...HIDDEN, eventStartDay: null, daysToDeadline: null };
const HIDDEN_NEXT = { ...HIDDEN, daysUntil: null };

beforeAll(async () => {
  prisma = await setupTestDb();
  const fixture = await createCalendarFixture(prisma, { prefix: 'PAV' });
  planningGroupId = fixture.planningGroupId;
  const uid = randomUUID().substring(0, 6);

  const [admin, member, outsider] = await Promise.all([createTestUser('admin'), createTestUser('editor'), createTestUser('editor')]);
  adminUserId = admin.user.id;
  adminCaller = createCallerWithSession(admin.session as UserSession);
  memberCaller = createCallerWithSession(member.session as UserSession);
  outsiderCaller = createCallerWithSession(outsider.session as UserSession);

  const open = await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [member.user.id, outsider.user.id], label: 'PAV open' });
  const restricted = await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [member.user.id], label: 'PAV restricted' });
  openFn = open.functionId;
  restrictedFn = restricted.functionId;

  for (const label of ['Primo', 'Secondo']) {
    phaseIds.push((await prisma.phase.create({ data: { value: `PAV_${label}_${uid}`, label, isActive: true } })).id);
  }
  const event = (title: string, phaseId: string, day: string) =>
    prisma.calendarEvent.create({
      data: { calendarId: fixture.calendarId, planningGroupId, phaseId, title, startAt: new Date(day), allDay: true },
    });
  firstEvent = (await event('First secret', phaseIds[0], '2099-02-01')).id;
  secondEvent = (await event('Second secret', phaseIds[1], '2099-03-01')).id;

  layoutId = (await prisma.collectionLayout.create({ data: { brandId: fixture.brandId, seasonId: fixture.seasonId } })).id;
  collectionGroupId = (await prisma.collectionGroup.create({ data: { collectionLayoutId: layoutId, name: 'Gruppo' } })).id;
});

beforeEach(async () => {
  await prisma.collectionLayoutRow.deleteMany({ where: { collectionLayoutId: layoutId } });
  await Promise.all([setVisibility(firstEvent, 'open'), setVisibility(secondEvent, 'open')]);
});

describe('phaseAlert.criticalityForRow', () => {
  it('hides the active event from a user outside it, with the same band', async () => {
    await setVisibility(firstEvent, 'restricted');
    const rowId = await createRow('hidden active');

    const seen = await outsiderCaller.phaseAlert.criticalityForRow({ rowId });
    const full = await adminCaller.phaseAlert.criticalityForRow({ rowId });

    // The whole answer, not a list of fields: anything the engine adds later has to be decided here.
    expect(seen).toEqual({
      state: 'active',
      rowId,
      phaseId: phaseIds[0],
      reached: false,
      band: full?.band,
      nextPhase: full?.state === 'active' ? full.nextPhase : null,
      ...HIDDEN_ACTIVE,
    });
    expect(seen?.state === 'active' && seen.nextPhase).toMatchObject({ eventId: secondEvent, eventTitle: 'Second secret' });
  });

  it('hides the next event alone when only that one is out of reach', async () => {
    await setVisibility(secondEvent, 'restricted');
    const rowId = await createRow('hidden next');

    const seen = await outsiderCaller.phaseAlert.criticalityForRow({ rowId });

    expect(seen).toMatchObject({ eventId: firstEvent, eventTitle: 'First secret' });
    expect(seen?.state === 'active' && seen.nextPhase).toEqual({ ...HIDDEN_NEXT, phaseId: phaseIds[1], reached: false });
  });

  it.each([['a member of its functions', () => memberCaller], ['an admin', () => adminCaller]])('shows everything to %s', async (_who, caller) => {
    await Promise.all([setVisibility(firstEvent, 'restricted'), setVisibility(secondEvent, 'restricted')]);
    const rowId = await createRow('full');

    const seen = await caller().phaseAlert.criticalityForRow({ rowId });

    expect(seen).toMatchObject({ eventId: firstEvent, eventTitle: 'First secret', nextPhase: { eventId: secondEvent, eventTitle: 'Second secret' } });
    expect(seen?.state === 'active' && seen.daysToDeadline).toEqual(expect.any(Number));
  });

  it('hides the milestone a concluded row is measured against, saying it is hidden', async () => {
    await setVisibility(secondEvent, 'restricted');
    const rowId = await createRow('hidden completion', { completedAt: new Date('2099-01-15T12:00:00Z') });

    const seen = await outsiderCaller.phaseAlert.criticalityForRow({ rowId });
    const full = await adminCaller.phaseAlert.criticalityForRow({ rowId });

    expect(seen).toEqual({
      state: 'completed',
      rowId,
      completedDay: '2099-01-15',
      eventHidden: true,
      late: false,
      band: full?.band,
      daysVsDeadline: null,
      ...HIDDEN,
    });
    expect(full).toMatchObject({ eventHidden: false, eventId: secondEvent });
  });
});

describe('phaseAlert.criticalityForLayout', () => {
  it('hides each row by what that user can see', async () => {
    await setVisibility(firstEvent, 'restricted');
    const atFirst = await createRow('at first');
    const atSecond = await createRow('at second', { phaseId: phaseIds[1] });

    const seen = await outsiderCaller.phaseAlert.criticalityForLayout({ collectionLayoutId: layoutId });
    const full = await memberCaller.phaseAlert.criticalityForLayout({ collectionLayoutId: layoutId });

    expect(seen.find(r => r.rowId === atFirst)).toMatchObject({ ...HIDDEN_ACTIVE, productCategory: 'TEST' });
    expect(seen.find(r => r.rowId === atSecond)).toMatchObject({ eventId: secondEvent, eventTitle: 'Second secret' });
    expect(full.find(r => r.rowId === atFirst)).toMatchObject({ eventId: firstEvent });
    expect(JSON.stringify(seen)).not.toContain('First secret');
  });

  it('checks next phases and completion milestones as well as active events', async () => {
    await setVisibility(secondEvent, 'restricted');
    const open = await createRow('next hidden');
    const concluded = await createRow('completion hidden', { completedAt: new Date('2099-01-15T12:00:00Z') });

    const seen = await outsiderCaller.phaseAlert.criticalityForLayout({ collectionLayoutId: layoutId });
    const full = await memberCaller.phaseAlert.criticalityForLayout({ collectionLayoutId: layoutId });

    expect(seen.find(r => r.rowId === open)).toMatchObject({ eventId: firstEvent, nextPhase: HIDDEN_NEXT });
    expect(seen.find(r => r.rowId === concluded)).toMatchObject({ eventHidden: true, ...HIDDEN });
    expect(full.find(r => r.rowId === open)).toMatchObject({ nextPhase: { eventId: secondEvent } });
    expect(full.find(r => r.rowId === concluded)).toMatchObject({ eventHidden: false, eventId: secondEvent });
  });
});

describe('phaseAlert.bottleneckByEvent', () => {
  it('merges the hidden events into one bucket, last, with no count or order of them', async () => {
    await Promise.all([setVisibility(firstEvent, 'restricted'), setVisibility(secondEvent, 'restricted')]);
    await createRow('at first');
    await createRow('at second', { phaseId: phaseIds[1] });

    const seen = await outsiderCaller.phaseAlert.bottleneckByEvent({ collectionLayoutId: layoutId });
    const full = await adminCaller.phaseAlert.bottleneckByEvent({ collectionLayoutId: layoutId });

    expect(full).toHaveLength(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ eventId: null, eventTitle: null, eventStartDay: null });
    const total = (entries: typeof seen) => entries.flatMap(e => e.bands).reduce((sum, b) => sum + b.count, 0);
    expect(total(seen)).toBe(total(full));
    expect(JSON.stringify(seen)).not.toContain('secret');
  });

  it('keeps a visible event by name and puts the hidden bucket after it', async () => {
    await setVisibility(firstEvent, 'restricted');
    await createRow('at first');
    await createRow('at second', { phaseId: phaseIds[1] });

    const seen = await outsiderCaller.phaseAlert.bottleneckByEvent({ collectionLayoutId: layoutId });

    expect(seen.map(e => e.eventId)).toEqual([secondEvent, null]);
  });

  it('adds no bucket when nothing is hidden', async () => {
    await createRow('at first');

    const seen = await outsiderCaller.phaseAlert.bottleneckByEvent({ collectionLayoutId: layoutId });

    expect(seen.map(e => e.eventId)).toEqual([firstEvent]);
  });
});

describe('collectionLayoutRevision', () => {
  const NOTE = 'Evento raggiunto: "First secret" — Gruppo: "G"';
  const RESERVED = 'Evento riservato';
  let revisionNumber = 0;

  async function milestoneRevision(milestoneId: string) {
    revisionNumber += 1;
    return prisma.collectionLayoutRevision.create({
      data: {
        collectionLayoutId: layoutId, revisionNumber, revisionTypeValue: `TEST_${revisionNumber}`,
        cause: 'MILESTONE', milestoneId, notes: NOTE, createdByUserId: adminUserId,
      },
    });
  }

  const listed = async (caller: typeof adminCaller, id: string) =>
    (await caller.collectionLayoutRevision.list({ collectionLayoutId: layoutId })).find(r => r.id === id);

  /** The note an export prints, read back from its XLSX. */
  async function exportedNote(caller: typeof adminCaller, revisionId: string) {
    const { data } = await caller.collectionLayoutRevision.export.xlsx({ revisionId });
    const workbook = new ExcelJS.Workbook();
    // ExcelJS types its input as its own `Buffer extends ArrayBuffer`: hand it a plain ArrayBuffer.
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(data, 'base64')).buffer);
    const rows: string[] = [];
    workbook.getWorksheet('Nota revisione')?.eachRow(row => rows.push(row.values?.toString() ?? ''));
    return rows.join('\n');
  }

  it('masks the note and the event reference of a revision on a hidden event, everywhere it is read', async () => {
    await setVisibility(firstEvent, 'restricted');
    const { id } = await milestoneRevision(firstEvent);

    expect(await listed(outsiderCaller, id)).toMatchObject({ cause: 'MILESTONE', milestoneId: null, notes: RESERVED });
    expect(await outsiderCaller.collectionLayoutRevision.getDetail({ revisionId: id }))
      .toMatchObject({ milestoneId: null, notes: RESERVED });
    const asOf = await outsiderCaller.collectionLayoutRevision.getLayoutAsOf({ collectionLayoutId: layoutId, revisionId: id });
    expect(asOf.revision).toMatchObject({ milestoneId: null, notes: RESERVED });
    expect(await exportedNote(outsiderCaller, id)).toContain(RESERVED);
    expect(await exportedNote(outsiderCaller, id)).not.toContain('First secret');
  });

  it('shows them to a member of its functions and to an admin', async () => {
    await setVisibility(firstEvent, 'restricted');
    const { id } = await milestoneRevision(firstEvent);

    for (const caller of [memberCaller, adminCaller]) {
      expect(await listed(caller, id)).toMatchObject({ milestoneId: firstEvent, notes: NOTE });
      expect(await caller.collectionLayoutRevision.getDetail({ revisionId: id })).toMatchObject({ milestoneId: firstEvent, notes: NOTE });
      expect((await caller.collectionLayoutRevision.getLayoutAsOf({ collectionLayoutId: layoutId, revisionId: id })).revision)
        .toMatchObject({ milestoneId: firstEvent, notes: NOTE });
      expect(await exportedNote(caller, id)).toContain('First secret');
    }
  });

  it('masks them when the event no longer exists, except for an admin', async () => {
    const { id } = await milestoneRevision(randomUUID());

    expect(await listed(memberCaller, id)).toMatchObject({ milestoneId: null, notes: RESERVED });
    expect(await listed(adminCaller, id)).toMatchObject({ notes: NOTE });
  });

  it('leaves the free-text note of a manual revision alone', async () => {
    revisionNumber += 1;
    const { id } = await prisma.collectionLayoutRevision.create({
      data: {
        collectionLayoutId: layoutId, revisionNumber, revisionTypeValue: `TEST_${revisionNumber}`,
        cause: 'MANUAL', notes: 'Prezzi aggiornati', createdByUserId: adminUserId,
      },
    });

    expect(await listed(outsiderCaller, id)).toMatchObject({ milestoneId: null, notes: 'Prezzi aggiornati' });
  });
});
