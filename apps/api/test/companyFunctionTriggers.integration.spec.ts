/**
 * The database's backstop for #237 (#242): four triggers refuse an inactive company function on an
 * active event or a template item, whoever writes, with SQLSTATE `LK001`
 * (`20261111120000_company_function_active_triggers`).
 *
 * - Shape: what Prisma raises for a refusal, and that `isInactiveFunctionRefusal` matches only it.
 * - Through the API: the application refuses first (`companyFunctionInactive`), so here its check is
 *   put out of the way through the transaction it runs in (a module mock comes too late: the
 *   procedure recorder's setup imports the router first), and the trigger's refusal must still read
 *   PRECONDITION_FAILED at each place that maps it.
 * - Races: each trigger against the one that changes what it reads, in both orders, on raw
 *   connections (the SQLSTATE as `pg` reports it).
 * - What stays allowed on rows saved before the rule (owner decision #12).
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '@luke/db';

import { isInactiveFunctionRefusal, refuseOnInactiveFunction } from '../src/lib/error';
import { sseStore } from '../src/lib/sseStore';

import {
  asLegacy,
  createCalendarFixture,
  createCallerWithSession,
  createTestEvent,
  createTestFunction,
  createTestTemplate,
  createTestUser,
  expectedOf,
  setupTestDb,
  type CalendarFixture,
} from './helpers';
import { whileHeld } from './helpers/heldTransaction';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let source: CalendarFixture;

const asAdmin = () => createCallerWithSession(adminSession);
const START = new Date('2099-06-01T09:00:00.000Z');
const uid = () => randomUUID().slice(0, 8);

const newFunction = (isActive = true) => createTestFunction(prisma, isActive, 'trig');
const newEvent = (functionIds: string[], cancelled = false, db: Prisma.TransactionClient = prisma) =>
  createTestEvent(db, source, functionIds, { startAt: START, cancelled });

async function newItem(functionIds: string[], db: Prisma.TransactionClient = prisma) {
  const template = await createTestTemplate(db, [{ title: 'Item', functionIds }]);
  return { template, item: template.items[0]! };
}

const legacyEvent = (functionIds: string[]) => asLegacy(prisma, tx => newEvent(functionIds, false, tx));
const legacyItem = (functionIds: string[]) => asLegacy(prisma, tx => newItem(functionIds, tx));

const rejectionOf = async (write: Promise<unknown>) => write.then(() => undefined, (err: unknown) => err);

/** `target` with the named members replaced; every other member as it is, bound to `target`. */
function withOverrides<T extends object>(target: T, overrides: Record<string, unknown>): T {
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      const value: unknown = Reflect.get(t, prop);
      return typeof value === 'function' ? value.bind(t) : value;
    },
  });
}

/**
 * Runs every interactive transaction the API opens on its `tx` with `overrides`: the application's
 * own check is put out of the way, the database write still happens, and only a trigger can refuse.
 */
function overrideTransactions(overrides: (tx: Prisma.TransactionClient) => Record<string, unknown>) {
  const realTransaction = prisma.$transaction.bind(prisma);
  vi.spyOn(prisma, '$transaction').mockImplementation(
    // The spy replaces an overloaded method: the batch form passes through untouched.
    ((run: unknown, options?: object) => typeof run === 'function'
      ? realTransaction(tx => (run as (tx: Prisma.TransactionClient) => Promise<unknown>)(withOverrides(tx, overrides(tx))), options)
      : realTransaction(run as Prisma.PrismaPromise<unknown>[], options)) as unknown as typeof prisma.$transaction
  );
}

/** The writers' function lock (`lockActiveFunctions`) still runs, but reads every function as active. */
const writersSeeAllActive = () => overrideTransactions(tx => ({
  $queryRaw: async (query: Prisma.Sql) =>
    (await tx.$queryRaw<Record<string, unknown>[]>(query)).map(row => 'isActive' in row ? { ...row, isActive: true } : row),
}));

/** A procedure's refusal that came from a trigger, mapped where the write happens. */
function expectTriggerRefusal(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected a TRPCError, got ${String(err)}`);
  expect(err.code).toBe('PRECONDITION_FAILED');
  expect(isInactiveFunctionRefusal(err.cause)).toBe(true);
}

beforeAll(async () => {
  prisma = await setupTestDb();
  adminSession = (await createTestUser('admin')).session;
  source = await createCalendarFixture(prisma, { prefix: 'FTR' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('the migration installs the four triggers, enabled', async () => {
  const rows = await prisma.$queryRaw<{ tgname: string; tgenabled: string }[]>`
    SELECT tgname, tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname = ANY(${[
      'calendar_event_visibility_function_active',
      'template_item_visibility_function_active',
      'calendar_event_restore_functions_active',
      'company_function_deactivation_visibility',
    ]}::text[]) ORDER BY tgname`;
  expect(rows).toEqual([
    { tgname: 'calendar_event_restore_functions_active', tgenabled: 'O' },
    { tgname: 'calendar_event_visibility_function_active', tgenabled: 'O' },
    { tgname: 'company_function_deactivation_visibility', tgenabled: 'O' },
    { tgname: 'template_item_visibility_function_active', tgenabled: 'O' },
  ]);
});

describe('the refusal as Prisma raises it', () => {
  it.each([
    ['a model insert on an active event', 'P2039', async (off: string) => {
      const event = await newEvent([]);
      return prisma.calendarEventVisibility.create({ data: { eventId: event.id, functionId: off } });
    }],
    ['a model insert on a template item', 'P2039', async (off: string) => {
      const { item } = await newItem([]);
      return prisma.milestoneTemplateItemVisibility.create({ data: { templateItemId: item.id, functionId: off } });
    }],
    ['a raw insert on an active event', 'P2010', async (off: string) => {
      const event = await newEvent([]);
      return prisma.$executeRaw`INSERT INTO calendar_event_visibilities ("eventId", "functionId") VALUES (${event.id}, ${off})`;
    }],
    ['a raw uncancel', 'P2010', async (off: string) => {
      const event = await newEvent([off], true);
      return prisma.$executeRaw`UPDATE calendar_events SET "cancelledAt" = NULL, "cancelReason" = NULL WHERE id = ${event.id}`;
    }],
  ])('%s: %s, recognised and mapped', async (_case, code, write) => {
    const off = await newFunction(false);

    const err = await rejectionOf(write(off.id));

    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err).toMatchObject({ code });
    expect(isInactiveFunctionRefusal(err)).toBe(true);
    const mapped = await rejectionOf(refuseOnInactiveFunction('refused', () => Promise.reject(err)));
    expect(mapped).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'refused', cause: err });
  });

  it('a raw deactivation of a function an active event is visible to: P2010', async () => {
    const fn = await newFunction();
    await newEvent([fn.id]);

    const err = await rejectionOf(prisma.$executeRaw`UPDATE company_functions SET "isActive" = false WHERE id = ${fn.id}`);

    expect(err).toMatchObject({ code: 'P2010' });
    expect(isInactiveFunctionRefusal(err)).toBe(true);
  });

  it('another CHECK violation is not recognised, and the mapping passes it on unchanged', async () => {
    const event = await newEvent([]);

    const err = await rejectionOf(prisma.$executeRaw`UPDATE calendar_events SET "startAt" = '1800-01-01' WHERE id = ${event.id}`);

    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(isInactiveFunctionRefusal(err)).toBe(false);
    expect(await rejectionOf(refuseOnInactiveFunction('refused', () => Promise.reject(err)))).toBe(err);
  });
});

/** A legacy event and template item, each holding an inactive function. */
interface Legacy { eventId: string; itemId: string }

describe('what each trigger refuses and allows', () => {
  it('T1: an inactive function on a cancelled event is allowed', async () => {
    const off = await newFunction(false);
    await expect(newEvent([off.id], true)).resolves.toBeDefined();
  });

  it('T1: moving a row from a cancelled event to an active one is refused', async () => {
    const off = await newFunction(false);
    const [cancelled, active] = await Promise.all([newEvent([off.id], true), newEvent([])]);

    const err = await rejectionOf(prisma.$executeRaw`
      UPDATE calendar_event_visibilities SET "eventId" = ${active.id} WHERE "eventId" = ${cancelled.id}`);
    expect(isInactiveFunctionRefusal(err)).toBe(true);
  });

  it('T2: moving a row to another template item is refused', async () => {
    const off = await newFunction(false);
    const [{ item: from }, { item: to }] = await Promise.all([legacyItem([off.id]), newItem([])]);

    const err = await rejectionOf(prisma.$executeRaw`
      UPDATE milestone_template_item_visibilities SET "templateItemId" = ${to.id} WHERE "templateItemId" = ${from.id}`);
    expect(isInactiveFunctionRefusal(err)).toBe(true);
  });

  it('T4: a deactivation is refused while a template item uses the function, allowed with only cancelled events', async () => {
    const [used, cancelledOnly] = await Promise.all([newFunction(), newFunction()]);
    await newItem([used.id]);
    await newEvent([cancelledOnly.id], true);

    expect(isInactiveFunctionRefusal(await rejectionOf(
      prisma.$executeRaw`UPDATE company_functions SET "isActive" = false WHERE id = ${used.id}`))).toBe(true);
    await prisma.$executeRaw`UPDATE company_functions SET "isActive" = false WHERE id = ${cancelledOnly.id}`;
  });

  it.each([
    ['cancelling the event', (ids: Legacy) => prisma.$executeRaw`
      UPDATE calendar_events SET "cancelledAt" = now(), "cancelReason" = 'test' WHERE id = ${ids.eventId}`],
    ['cancelledAt NULL to NULL, with another change', (ids: Legacy) => prisma.$executeRaw`
      UPDATE calendar_events SET "cancelledAt" = NULL, title = 'Renamed' WHERE id = ${ids.eventId}`],
    ['an unchanged update of the event row', (ids: Legacy) => prisma.$executeRaw`
      UPDATE calendar_event_visibilities SET "functionId" = "functionId", "eventId" = "eventId" WHERE "eventId" = ${ids.eventId}`],
    ['an unchanged update of the template item row', (ids: Legacy) => prisma.$executeRaw`
      UPDATE milestone_template_item_visibilities SET "functionId" = "functionId" WHERE "templateItemId" = ${ids.itemId}`],
    ['removing the rows', (ids: Legacy) => Promise.all([
      prisma.calendarEventVisibility.deleteMany({ where: { eventId: ids.eventId } }),
      prisma.milestoneTemplateItemVisibility.deleteMany({ where: { templateItemId: ids.itemId } }),
    ])],
    ['deleting the event', (ids: Legacy) => prisma.calendarEvent.delete({ where: { id: ids.eventId } })],
    ['deleting the template item, an event made from it set to null', async (ids: Legacy) => {
      await prisma.calendarEvent.update({ where: { id: ids.eventId }, data: { templateItemId: ids.itemId } });
      await prisma.milestoneTemplateItem.delete({ where: { id: ids.itemId } });
    }],
  ])('a legacy row allows %s', async (_case, write) => {
    const off = await newFunction(false);
    const [event, { item }] = await Promise.all([legacyEvent([off.id]), legacyItem([off.id])]);

    await expect(write({ eventId: event.id, itemId: item.id })).resolves.not.toThrow();
  });
});

describe('through the API, past the application check, each mapping place answers PRECONDITION_FAILED', () => {
  it.each([
    ['createMilestone', async (off: string) => {
      const title = `Create ${uid()}`;
      return {
        call: () => asAdmin().seasonCalendar.createMilestone({
          planningGroupId: source.planningGroupId, title, startAt: START.toISOString(), visibilityFunctionIds: [off],
        }),
        written: () => prisma.calendarEvent.count({ where: { title } }),
      };
    }],
    ['updateMilestone adding it', async (off: string) => {
      const event = await newEvent([]);
      const expected = await expectedOf(prisma, event.id);
      return {
        call: () => asAdmin().seasonCalendar.updateMilestone({ id: event.id, data: { visibilityFunctionIds: [off] }, expected }),
        written: () => prisma.calendarEventVisibility.count({ where: { eventId: event.id } }),
      };
    }],
    ['applyTemplate', async (off: string) => {
      const { template } = await legacyItem([off]);
      const group = await prisma.planningGroup.create({ data: { calendarId: source.calendarId, name: `G ${uid()}` } });
      return {
        call: () => asAdmin().seasonCalendar.applyTemplate({ planningGroupId: group.id, templateId: template.id, anchorDate: '2099-03-01' }),
        written: () => prisma.calendarEvent.count({ where: { planningGroupId: group.id } }),
      };
    }],
    ['createTemplateItem', async (off: string) => {
      const { template } = await newItem([]);
      return {
        call: () => asAdmin().seasonCalendar.createTemplateItem({ templateId: template.id, title: 'New', offsetDays: 0, visibilityFunctionIds: [off] }),
        written: () => prisma.milestoneTemplateItem.count({ where: { templateId: template.id, title: 'New' } }),
      };
    }],
    ['updateTemplateItem adding it', async (off: string) => {
      const { item } = await newItem([]);
      return {
        call: () => asAdmin().seasonCalendar.updateTemplateItem({ id: item.id, visibilityFunctionIds: [off] }),
        written: () => prisma.milestoneTemplateItemVisibility.count({ where: { templateItemId: item.id } }),
      };
    }],
  ])('the writer module: %s', async (_name, prepare) => {
    const off = await newFunction(false);
    const { call, written } = await prepare(off.id);
    writersSeeAllActive();

    expectTriggerRefusal(await rejectionOf(call()));
    expect(await written()).toBe(0);
  });

  it('uncancelMilestone: stays cancelled, with no audit row or push, and answers 412', async () => {
    const off = await newFunction(false);
    const event = await newEvent([off.id], true);
    const push = vi.spyOn(sseStore, 'pushToAll');
    writersSeeAllActive();

    const err = await rejectionOf(asAdmin().seasonCalendar.uncancelMilestone({ id: event.id }));

    expectTriggerRefusal(err);
    expect(getHTTPStatusCodeFromError(err)).toBe(412);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).cancelledAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'CALENDAR_EVENT_UNCANCEL', targetId: event.id } })).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ['an active event', (fnId: string) => newEvent([fnId])],
    ['a template item', (fnId: string) => newItem([fnId])],
  ])('function.delete, used by %s: stays active, with no audit row', async (_case, use) => {
    const fn = await newFunction();
    await use(fn.id);
    // `function.delete`'s own counts see no use: only the trigger can refuse.
    overrideTransactions(tx => ({
      calendarEvent: withOverrides(tx.calendarEvent, { count: async () => 0 }),
      milestoneTemplateItemVisibility: withOverrides(tx.milestoneTemplateItemVisibility, { findMany: async () => [] }),
    }));

    expectTriggerRefusal(await rejectionOf(asAdmin().company.function.delete({ id: fn.id })));
    expect((await prisma.companyFunction.findUniqueOrThrow({ where: { id: fn.id } })).isActive).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'COMPANY_FUNCTION_DEACTIVATED', targetId: fn.id } })).toBe(0);
  });
});

describe('races: the second write waits for the first, then the trigger refuses it', () => {
  const deactivate = (id: string) => (db: Client) => db.query('UPDATE company_functions SET "isActive" = false WHERE id = $1', [id]);
  const link = (eventId: string, fnId: string) => (db: Client) =>
    db.query('INSERT INTO calendar_event_visibilities ("eventId", "functionId") VALUES ($1, $2)', [eventId, fnId]);
  const linkItem = (itemId: string, fnId: string) => (db: Client) =>
    db.query('INSERT INTO milestone_template_item_visibilities ("templateItemId", "functionId") VALUES ($1, $2)', [itemId, fnId]);
  const uncancel = (eventId: string) => (db: Client) =>
    db.query('UPDATE calendar_events SET "cancelledAt" = NULL, "cancelReason" = NULL WHERE id = $1', [eventId]);

  /** `first` holds its write uncommitted; `second` runs on a connection of its own. */
  type Race = (fnId: string) => Promise<{ first: (db: Client) => Promise<unknown>; second: (db: Client) => Promise<unknown> }>;

  async function onOwnConnection(write: (db: Client) => Promise<unknown>) {
    const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    try {
      await write(db);
    } finally {
      await db.end();
    }
  }

  /** A cancelled event with no functions yet, and `fnId` deactivated. */
  async function cancelledEventWithFunctionOff(fnId: string) {
    const event = await newEvent([], true);
    await prisma.companyFunction.update({ where: { id: fnId }, data: { isActive: false } });
    return event.id;
  }

  const races: [string, Race][] = [
    ['T1 then T4', async fnId => ({ first: link((await newEvent([])).id, fnId), second: deactivate(fnId) })],
    ['T4 then T1', async fnId => ({ first: deactivate(fnId), second: link((await newEvent([])).id, fnId) })],
    ['T2 then T4', async fnId => ({ first: linkItem((await newItem([])).item.id, fnId), second: deactivate(fnId) })],
    ['T4 then T2', async fnId => ({ first: deactivate(fnId), second: linkItem((await newItem([])).item.id, fnId) })],
    ['T3 then T4', async fnId => ({ first: uncancel((await newEvent([fnId], true)).id), second: deactivate(fnId) })],
    ['T4 then T3', async fnId => ({ first: deactivate(fnId), second: uncancel((await newEvent([fnId], true)).id) })],
    ['T1 on a cancelled event, then uncancel', async fnId => {
      const eventId = await cancelledEventWithFunctionOff(fnId);
      return { first: link(eventId, fnId), second: uncancel(eventId) };
    }],
    ['uncancel, then T1', async fnId => {
      const eventId = await cancelledEventWithFunctionOff(fnId);
      return { first: uncancel(eventId), second: link(eventId, fnId) };
    }],
  ];

  it.each(races)('%s', async (_name, prepare) => {
    const fn = await newFunction();
    const { first, second } = await prepare(fn.id);

    const outcome = await whileHeld(first, () => onOwnConnection(second));

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'LK001' } });
  });
});
