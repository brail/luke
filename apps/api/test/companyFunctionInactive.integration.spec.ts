/**
 * An inactive company function gets no new association to an active calendar event or to a template
 * item (#237, Addendum 2). Every writer refuses one, naming it, and rolls back whole; an event saved
 * before the rule may keep one. `function.delete` refuses while either exists, and the two sides hold
 * each other's check through the function row: a writer holds it `FOR SHARE`
 * (`lockActiveFunctions`), delete `FOR NO KEY UPDATE`.
 *
 * Races: each writer is run against a held delete (the function row locked, then deactivated): it
 * must wait, which proves that real path takes the lock, then refuse. Delete is run against a held
 * writer lock, then the writer's row: it must wait, then refuse.
 */

import { randomUUID } from 'crypto';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { sseStore } from '../src/lib/sseStore';

import {
  createCalendarFixture,
  createCallerWithSession,
  createTestUser,
  expectedOf,
  setupTestDb,
  type CalendarFixture,
} from './helpers';
import { whileHeld } from './helpers/heldTransaction';

import type { UserSession } from '../src/lib/auth';
import type { TRPCError } from '@trpc/server';
import type { Client } from 'pg';

let prisma: PrismaClient;
let adminSession: UserSession;
let source: CalendarFixture;
let target: CalendarFixture;

const asAdmin = () => createCallerWithSession(adminSession);
const START = new Date('2099-06-01T09:00:00.000Z');
const uid = () => randomUUID().slice(0, 8);

async function newFunction(isActive = true) {
  const id = uid();
  return prisma.companyFunction.create({ data: { slug: `inact_${id}`, name: `Fn ${id}`, order: 90, isActive } });
}

/** An event in the source calendar's group, visible to `functionIds`; cancelled when asked. */
async function newEvent(functionIds: string[], cancelled = false, groupId = source.planningGroupId) {
  return prisma.calendarEvent.create({
    data: {
      calendarId: source.calendarId, planningGroupId: groupId, title: `Ev ${uid()}`, startAt: START,
      cancelledAt: cancelled ? new Date() : null, cancelReason: cancelled ? 'test' : null,
      visibilities: { create: functionIds.map(functionId => ({ functionId })) },
    },
  });
}

async function newTemplate(items: { title: string; functionIds: string[] }[]) {
  return prisma.milestoneTemplate.create({
    data: {
      name: `Tpl ${uid()}`,
      items: {
        create: items.map(({ title, functionIds }) => ({
          title, offsetDays: 0, visibilities: { create: functionIds.map(functionId => ({ functionId })) },
        })),
      },
    },
    include: { items: true },
  });
}

async function newGroup() {
  return (await prisma.planningGroup.create({ data: { calendarId: source.calendarId, name: `G ${uid()}` } })).id;
}

const deactivate = (id: string) => prisma.companyFunction.update({ where: { id }, data: { isActive: false } });
const rejectionOf = (outcome: PromiseSettledResult<unknown>) => outcome.status === 'rejected' ? (outcome.reason as TRPCError) : undefined;

beforeAll(async () => {
  prisma = await setupTestDb();
  adminSession = (await createTestUser('admin')).session;
  source = await createCalendarFixture(prisma, { prefix: 'FIS' });
  target = await createCalendarFixture(prisma, { prefix: 'FIT' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('writers refuse an inactive function, naming it', () => {
  it('createMilestone, and nothing is created', async () => {
    const [on, off] = await Promise.all([newFunction(), newFunction(false)]);
    const title = `Create ${uid()}`;

    await expect(asAdmin().seasonCalendar.createMilestone({
      planningGroupId: source.planningGroupId, title, startAt: START.toISOString(), visibilityFunctionIds: [on.id, off.id],
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`«${off.name}»`) });
    expect(await prisma.calendarEvent.count({ where: { title } })).toBe(0);
  });

  it('updateMilestone refuses one added, and keeps one the event already had', async () => {
    const [on, off] = await Promise.all([newFunction(), newFunction(false)]);
    const plain = await newEvent([on.id]);
    await expect(asAdmin().seasonCalendar.updateMilestone({
      id: plain.id, data: { visibilityFunctionIds: [on.id, off.id] }, expected: await expectedOf(prisma, plain.id),
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`«${off.name}»`) });

    // Saved before #237: the inactive function may stay while the rest of the event changes.
    const legacy = await newEvent([off.id]);
    await asAdmin().seasonCalendar.updateMilestone({
      id: legacy.id, data: { title: 'Renamed', visibilityFunctionIds: [off.id, on.id] }, expected: await expectedOf(prisma, legacy.id),
    });
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: legacy.id } })).title).toBe('Renamed');
  });

  it('applyTemplate, naming the items, and applies nothing', async () => {
    const [on, off] = await Promise.all([newFunction(), newFunction(false)]);
    const template = await newTemplate([{ title: 'Fine', functionIds: [on.id] }, { title: 'Stale', functionIds: [off.id] }]);
    const groupId = await newGroup();

    await expect(asAdmin().seasonCalendar.applyTemplate({ planningGroupId: groupId, templateId: template.id, anchorDate: '2099-03-01' }))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`«${off.name}» (in «Stale»)`) });
    expect(await prisma.calendarEvent.count({ where: { planningGroupId: groupId } })).toBe(0);
  });

  it('cloneFromBrandSeason, naming the events, and copies nothing — a cancelled source too', async () => {
    const [on, off] = await Promise.all([newFunction(), newFunction(false)]);
    const groupId = await newGroup();
    await newEvent([on.id], false, groupId);
    const stale = await newEvent([off.id], true, groupId);

    await expect(asAdmin().seasonCalendar.cloneFromBrandSeason({
      sourceBrandId: source.brandId, sourceSeasonId: source.seasonId, targetBrandId: target.brandId, targetSeasonId: target.seasonId,
      sourcePlanningGroupIds: [groupId], dateShiftDays: 0, includeCancelled: true,
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`(in «${stale.title}»)`) });
    expect(await prisma.calendarEvent.count({ where: { calendarId: target.calendarId } })).toBe(0);
  });

  it('uncancelMilestone, with no audit row, push or notification', async () => {
    const off = await newFunction(false);
    const event = await newEvent([off.id], true);
    const push = vi.spyOn(sseStore, 'pushToAll');

    await expect(asAdmin().seasonCalendar.uncancelMilestone({ id: event.id }))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`«${off.name}»`) });
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).cancelledAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'CALENDAR_EVENT_UNCANCEL', targetId: event.id } })).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('createTemplateItem', async () => {
    const off = await newFunction(false);
    const template = await newTemplate([]);

    await expect(asAdmin().seasonCalendar.createTemplateItem({ templateId: template.id, title: 'New', offsetDays: 0, visibilityFunctionIds: [off.id] }))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`«${off.name}»`) });
    expect(await prisma.milestoneTemplateItem.count({ where: { templateId: template.id } })).toBe(0);
  });

  it('updateTemplateItem refuses any save of an item carrying one, and saves once it is removed', async () => {
    const [on, off] = await Promise.all([newFunction(), newFunction(false)]);
    const [item] = (await newTemplate([{ title: 'Legacy', functionIds: [off.id] }])).items;

    await expect(asAdmin().seasonCalendar.updateTemplateItem({ id: item!.id, title: 'Only the title' }))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`«${off.name}»`) });
    await asAdmin().seasonCalendar.updateTemplateItem({ id: item!.id, title: 'Fixed', visibilityFunctionIds: [on.id] });

    expect((await prisma.milestoneTemplateItem.findUniqueOrThrow({ where: { id: item!.id }, include: { visibilities: true } })))
      .toMatchObject({ title: 'Fixed', visibilities: [{ functionId: on.id }] });
  });
});

describe('a function that does not exist', () => {
  it('answers NOT_FOUND, not a foreign-key 500', async () => {
    await expect(asAdmin().seasonCalendar.createMilestone({
      planningGroupId: source.planningGroupId, title: `Ghost ${uid()}`, startAt: START.toISOString(), visibilityFunctionIds: [randomUUID()],
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('function.delete', () => {
  it('is refused while a template item uses the function', async () => {
    const fn = await newFunction();
    const template = await newTemplate([{ title: 'Uses it', functionIds: [fn.id] }]);

    await expect(asAdmin().company.function.delete({ id: fn.id }))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringContaining(`«${template.name}» › «Uses it»`) });
    expect((await prisma.companyFunction.findUniqueOrThrow({ where: { id: fn.id } })).isActive).toBe(true);
  });

  it('of an inactive function answers BAD_REQUEST and writes no second audit row', async () => {
    const fn = await newFunction();
    await asAdmin().company.function.delete({ id: fn.id });

    await expect(asAdmin().company.function.delete({ id: fn.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await prisma.auditLog.count({ where: { action: 'COMPANY_FUNCTION_DEACTIVATED', targetId: fn.id } })).toBe(1);
  });

  it('concurrent with another delete, the second answers BAD_REQUEST', async () => {
    const fn = await newFunction();

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR NO KEY UPDATE', [fn.id]),
      () => asAdmin().company.function.delete({ id: fn.id }),
      holder => holder.query('UPDATE company_functions SET "isActive" = false WHERE id = $1', [fn.id])
    );

    expect(rejectionOf(outcome)?.code).toBe('BAD_REQUEST');
    expect(await prisma.auditLog.count({ where: { action: 'COMPANY_FUNCTION_DEACTIVATED', targetId: fn.id } })).toBe(0);
  });

  it.each([
    ['an event made visible to it', async (fnId: string, holder: Client) => {
      const eventId = randomUUID();
      await holder.query(
        `INSERT INTO calendar_events (id, "calendarId", "planningGroupId", title, "startAt", "updatedAt")
         VALUES ($1, $2, $3, 'Held', now(), now())`,
        [eventId, source.calendarId, source.planningGroupId]
      );
      await holder.query('INSERT INTO calendar_event_visibilities ("eventId", "functionId") VALUES ($1, $2)', [eventId, fnId]);
    }],
    ['a template item using it', async (fnId: string, holder: Client) => {
      const template = await newTemplate([]);
      const itemId = randomUUID();
      await holder.query(
        `INSERT INTO milestone_template_items (id, "templateId", title, "offsetDays", "updatedAt") VALUES ($1, $2, 'Held', 0, now())`,
        [itemId, template.id]
      );
      await holder.query('INSERT INTO milestone_template_item_visibilities ("templateItemId", "functionId") VALUES ($1, $2)', [itemId, fnId]);
    }],
  ])('waits for a writer holding the function, then refuses: %s', async (_case, write) => {
    const fn = await newFunction();

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR SHARE', [fn.id]),
      () => asAdmin().company.function.delete({ id: fn.id }),
      holder => write(fn.id, holder)
    );

    expect(rejectionOf(outcome)?.code).toBe('PRECONDITION_FAILED');
    expect((await prisma.companyFunction.findUniqueOrThrow({ where: { id: fn.id } })).isActive).toBe(true);
  });
});

describe('a writer racing a delete waits for it, then refuses', () => {
  const cases: [string, (fnId: string) => Promise<() => Promise<unknown>>][] = [
    ['createMilestone', async fnId => () => asAdmin().seasonCalendar.createMilestone({
      planningGroupId: source.planningGroupId, title: `Race ${uid()}`, startAt: START.toISOString(), visibilityFunctionIds: [fnId],
    })],
    ['updateMilestone adding it', async fnId => {
      const event = await newEvent([(await newFunction()).id]);
      const expected = await expectedOf(prisma, event.id);
      return () => asAdmin().seasonCalendar.updateMilestone({ id: event.id, data: { visibilityFunctionIds: [fnId] }, expected });
    }],
    ['applyTemplate', async fnId => {
      const template = await newTemplate([{ title: 'Race', functionIds: [fnId] }]);
      const groupId = await newGroup();
      return () => asAdmin().seasonCalendar.applyTemplate({ planningGroupId: groupId, templateId: template.id, anchorDate: '2099-03-01' });
    }],
    ['cloneFromBrandSeason', async fnId => {
      const groupId = await newGroup();
      await newEvent([fnId], false, groupId);
      return () => asAdmin().seasonCalendar.cloneFromBrandSeason({
        sourceBrandId: source.brandId, sourceSeasonId: source.seasonId, targetBrandId: target.brandId, targetSeasonId: target.seasonId,
        sourcePlanningGroupIds: [groupId], dateShiftDays: 0, includeCancelled: false,
      });
    }],
    ['uncancelMilestone', async fnId => {
      const event = await newEvent([fnId], true);
      return () => asAdmin().seasonCalendar.uncancelMilestone({ id: event.id });
    }],
    ['createTemplateItem', async fnId => {
      const template = await newTemplate([]);
      return () => asAdmin().seasonCalendar.createTemplateItem({ templateId: template.id, title: 'Race', offsetDays: 0, visibilityFunctionIds: [fnId] });
    }],
    ['updateTemplateItem, title only', async fnId => {
      const [item] = (await newTemplate([{ title: 'Race', functionIds: [fnId] }])).items;
      return () => asAdmin().seasonCalendar.updateTemplateItem({ id: item!.id, title: 'Renamed' });
    }],
  ];

  it.each(cases)('%s', async (_name, prepare) => {
    const fn = await newFunction();
    const run = await prepare(fn.id);

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR NO KEY UPDATE', [fn.id]),
      run,
      holder => holder.query('UPDATE company_functions SET "isActive" = false WHERE id = $1', [fn.id])
    );

    expect(rejectionOf(outcome)?.code).toBe('PRECONDITION_FAILED');
  });
});

describe('ordering', () => {
  it('updateMilestone reads the event\'s functions under its lock: one kept by a concurrent save is not "added"', async () => {
    const [on, off] = await Promise.all([newFunction(), newFunction()]);
    const event = await newEvent([on.id]);
    const expected = await expectedOf(prisma, event.id);
    await deactivate(off.id);

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM calendar_events WHERE id = $1 FOR NO KEY UPDATE', [event.id]),
      () => asAdmin().seasonCalendar.updateMilestone({ id: event.id, data: { visibilityFunctionIds: [on.id, off.id] }, expected }),
      // A save that committed before #237's rule held: the inactive function is already on the event.
      holder => holder.query('INSERT INTO calendar_event_visibilities ("eventId", "functionId") VALUES ($1, $2)', [event.id, off.id])
    );

    expect(outcome.status).toBe('fulfilled');
  });

  it('function.reorder locks its rows in id order, as writers do', async () => {
    const [a, b] = await Promise.all([newFunction(), newFunction()]);
    const [low, high] = [a.id, b.id].sort();
    let lowLocked: string | undefined;

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR SHARE', [high]),
      // Input order high first: a reorder locking in input order would wait on `high` holding nothing.
      () => asAdmin().company.function.reorder({ orderedIds: [high!, low!] }),
      async holder => {
        await holder.query('SAVEPOINT probe');
        await holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR SHARE NOWAIT', [low])
          .catch((err: { code?: string }) => { lowLocked = err.code; });
        await holder.query('ROLLBACK TO SAVEPOINT probe');
      }
    );

    expect(lowLocked).toBe('55P03'); // lock_not_available: the reorder already held `low`
    expect(outcome.status).toBe('fulfilled');
  });

  it('uncancelMilestone answers CONFLICT when another event takes its phase slot after the check', async () => {
    const fn = await newFunction();
    const phase = await prisma.phase.create({ data: { value: `FIP_${uid()}`, label: 'Slot', isActive: true } });
    const event = await prisma.calendarEvent.create({
      data: {
        calendarId: source.calendarId, planningGroupId: source.planningGroupId, phaseId: phase.id, title: `Slot ${uid()}`,
        startAt: START, cancelledAt: new Date(), cancelReason: 'test', visibilities: { create: [{ functionId: fn.id }] },
      },
    });

    const outcome = await whileHeld(
      // Holds the uncancel past its phase check, at the function lock.
      holder => holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR NO KEY UPDATE', [fn.id]),
      () => asAdmin().seasonCalendar.uncancelMilestone({ id: event.id }),
      holder => holder.query(
        `INSERT INTO calendar_events (id, "calendarId", "planningGroupId", "phaseId", title, "startAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'Taker', now(), now())`,
        [randomUUID(), source.calendarId, source.planningGroupId, phase.id]
      )
    );

    expect(rejectionOf(outcome)?.code).toBe('CONFLICT');
  });
});
