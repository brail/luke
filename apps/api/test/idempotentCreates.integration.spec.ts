/**
 * The creates a repeat would duplicate take the web's per-action `Idempotency-Key` (#248): the same
 * key replays the first answer, the same key with other data is refused with a text the user can
 * read, and a request without a key runs as before. A schedule replayed after its instant has
 * passed still replays: the "in the future" check runs only for a new request.
 */

import { randomUUID } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { appRouter } from '../src/routers/index';

import { createTestContext, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

/** Every create the web sends with a key; a new one belongs here and in its caller. */
const KEYED_CREATES = [
  'maintenance.mode.schedule',
  'maintenance.backup.create',
  'maintenance.backup.runMigrationBridge',
  'seasonCalendar.cloneFromBrandSeason',
  'seasonCalendar.applyTemplate',
  'seasonCalendar.createMilestone',
  'seasonCalendar.createTemplateItem',
  'collectionLayout.rows.create',
  'collectionLayout.groups.create',
  'collectionLayout.rows.duplicate',
  'collectionLayoutRevision.create',
  'merchandisingPlan.createRow',
  'vendors.create',
  'holidays.upsertVendorClosure',
  'dashboard.upsertTask',
  'feedback.submit',
  'system.triggerCalendarDigest',
] as const;

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A caller for `session` that sends `key` as its `Idempotency-Key`, or none. */
function callerFor(session: UserSession, key?: string) {
  const base = createTestContext(session);
  return appRouter.createCaller(
    key ? { ...base, req: { ...base.req, headers: { ...base.req.headers, 'idempotency-key': key } } } : base
  );
}

it('every keyed create runs the idempotency middleware after its input', () => {
  const procedures: Record<string, { _def: { middlewares: Array<{ name: string }> } }> =
    // `_def.procedures` is tRPC's registry, typed loosely: only the middleware names are read here.
    appRouter._def.procedures as never;
  // After the input parser (tRPC's `inputValidatorMiddleware`): before it, `input` is undefined, every
  // body hashes alike, and a key reused with other data would replay instead of being refused.
  const misplaced = KEYED_CREATES.filter(path => {
    const names = procedures[path]?._def.middlewares.map(middleware => middleware.name) ?? [];
    const idempotency = names.indexOf('idempotency');
    return idempotency < 0 || names.lastIndexOf('inputValidatorMiddleware') > idempotency;
  });
  expect(misplaced).toEqual([]);
});

describe('vendors.create with a key', () => {
  it('the same key replays the first create: one vendor', async () => {
    const { session } = await createTestUser('admin');
    const key = randomUUID();
    const name = `Vendor ${randomUUID()}`;

    const first = await callerFor(session, key).vendors.create({ name, moqPerColor: 100 });
    const second = await callerFor(session, key).vendors.create({ name, moqPerColor: 100 });

    expect(second.id).toBe(first.id);
    expect(await prisma.vendor.count({ where: { name } })).toBe(1);
  });

  it('the same key with other data is refused, in Italian, and creates nothing more', async () => {
    const { session } = await createTestUser('admin');
    const key = randomUUID();
    const name = `Vendor ${randomUUID()}`;
    await callerFor(session, key).vendors.create({ name, moqPerColor: 100 });

    await expect(callerFor(session, key).vendors.create({ name: `${name} bis`, moqPerColor: 100 })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Questa operazione è già stata inviata con dati diversi: ricarica e riprova',
    });
    expect(await prisma.vendor.count({ where: { name: { startsWith: name } } })).toBe(1);
  });

  it('without a key two creates are two vendors, as before', async () => {
    const { session } = await createTestUser('admin');
    const name = `Vendor ${randomUUID()}`;

    await callerFor(session).vendors.create({ name, moqPerColor: 100 });
    await callerFor(session).vendors.create({ name, moqPerColor: 100 });

    expect(await prisma.vendor.count({ where: { name } })).toBe(2);
  });
});

describe('maintenance.mode.schedule and the clock', () => {
  const input = (scheduledAt: Date) => ({
    scheduledAt: scheduledAt.toISOString(),
    forceLogout: false,
    warningLeadMinutes: [],
    notifyByEmail: false,
  });

  it('a replay after the scheduled instant has passed returns the stored answer', async () => {
    const { session } = await createTestUser('admin');
    const key = randomUUID();
    const scheduledAt = new Date(Date.now() + 60_000);
    const first = await callerFor(session, key).maintenance.mode.schedule(input(scheduledAt));

    // Two minutes later, inside the store's five-minute window: the instant is now in the past.
    const later = Date.now() + 120_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);

    await expect(callerFor(session, key).maintenance.mode.schedule(input(scheduledAt))).resolves.toEqual(first);
  });

  it('a new request for a past instant is refused', async () => {
    const { session } = await createTestUser('admin');

    await expect(
      callerFor(session, randomUUID()).maintenance.mode.schedule(input(new Date(Date.now() - 60_000)))
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'La data pianificata deve essere nel futuro' });
    expect(await prisma.appConfig.findUnique({ where: { key: 'maintenance.mode.state' } })).toBeNull();
  });
});
