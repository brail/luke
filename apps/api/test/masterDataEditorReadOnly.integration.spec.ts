/**
 * Brands, seasons, vendors and user management are admin-only: editor reads them like viewer.
 * Their sections are hidden to every non-admin role by default, and a role writes only where it
 * sees (`sectionHierarchy.test.ts`). Each refusal also proves nothing was written: an endpoint that
 * throws after persisting would pass the code check alone.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { rateLimitStore } from '../src/lib/ratelimit';

import { createCallerAs, createTestUser, expectUnauthorized, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
});

type Caller = Awaited<ReturnType<typeof createCallerAs>>;

const uid = () => randomUUID().slice(0, 6).toUpperCase();
const NON_ADMIN = ['editor', 'viewer'] as const;

/** One master-data resource: a stored row, and its router's writes. */
const MASTER_DATA = [
  {
    resource: 'brand',
    seed: () => prisma.brand.create({ data: { code: `B${uid()}`, name: `Brand ${uid()}` } }),
    count: () => prisma.brand.count(),
    find: (id: string) => prisma.brand.findUniqueOrThrow({ where: { id } }),
    create: (c: Caller) => c.brand.create({ code: `B${uid()}`, name: `New ${uid()}`, isActive: true }),
    rename: (c: Caller, id: string, name: string) => c.brand.update({ id, data: { name } }),
    archiving: (c: Caller, id: string) => [
      () => c.brand.remove({ id }),
      () => c.brand.restore({ id }),
      () => c.brand.unlink({ id }),
    ],
  },
  {
    resource: 'season',
    seed: () => prisma.season.create({ data: { code: `S${uid()}`, name: `Season ${uid()}` } }),
    count: () => prisma.season.count(),
    find: (id: string) => prisma.season.findUniqueOrThrow({ where: { id } }),
    create: (c: Caller) => c.season.create({ code: `S${uid()}`, name: `New ${uid()}`, isActive: true }),
    rename: (c: Caller, id: string, name: string) => c.season.update({ id, data: { name } }),
    archiving: (c: Caller, id: string) => [
      () => c.season.remove({ id }),
      () => c.season.restore({ id }),
      () => c.season.unlink({ id }),
    ],
  },
  {
    resource: 'vendor',
    seed: () => prisma.vendor.create({ data: { name: `Vendor ${uid()}` } }),
    count: () => prisma.vendor.count(),
    find: (id: string) => prisma.vendor.findUniqueOrThrow({ where: { id } }),
    create: (c: Caller) => c.vendors.create({ name: `New ${uid()}`, moqPerColor: 300 }),
    rename: (c: Caller, id: string, name: string) => c.vendors.update({ id, data: { name } }),
    archiving: (c: Caller, id: string) => [
      () => c.vendors.remove({ id }),
      () => c.vendors.restore({ id }),
      () => c.vendors.unlink({ id }),
    ],
  },
];

describe.each(MASTER_DATA)('$resource', r => {
  it.each(NON_ADMIN)('%s cannot create, rename, archive, restore or unlink one, and nothing is written', async role => {
    const row = await r.seed();
    const before = await r.count();
    const caller = await createCallerAs(role);

    await expectUnauthorized(() => r.create(caller));
    await expectUnauthorized(() => r.rename(caller, row.id, `Renamed ${uid()}`));
    for (const write of r.archiving(caller, row.id)) {
      await expectUnauthorized(write);
    }

    expect(await r.count()).toBe(before);
    expect(await r.find(row.id)).toEqual(row);
  });

  it('admin can create and rename one', async () => {
    const row = await r.seed();
    const before = await r.count();
    const caller = await createCallerAs('admin');
    const name = `Renamed ${uid()}`;

    await r.create(caller);
    await r.rename(caller, row.id, name);

    expect(await r.count()).toBe(before + 1);
    expect((await r.find(row.id)).name).toBe(name);
  });
});

describe('user management', () => {
  /** A pending, unverified account, so that every operation below would change it. */
  async function target() {
    const { user } = await createTestUser('viewer');
    return prisma.user.update({
      where: { id: user.id },
      data: { pendingApproval: true, emailVerifiedAt: null },
    });
  }

  type Target = Awaited<ReturnType<typeof target>>;

  const OPERATIONS: [string, (c: Caller, t: Target) => Promise<unknown>][] = [
    ['users.update', (c, t) => c.users.update({ id: t.id, firstName: 'Changed' })],
    ['users.approvePending', (c, t) => c.users.approvePending({ id: t.id, teamId: randomUUID() })],
    ['users.forceVerifyEmail', (c, t) => c.users.forceVerifyEmail({ userId: t.id, verified: true })],
    ['users.revokeUserSessions', (c, t) => c.users.revokeUserSessions({ id: t.id })],
  ];

  it.each(NON_ADMIN.flatMap(role => OPERATIONS.map(([label, invoke]) => [role, label, invoke] as const)))(
    '%s: %s → FORBIDDEN, the account unchanged',
    async (role, _label, invoke) => {
      const before = await target();
      const caller = await createCallerAs(role);

      await expectUnauthorized(() => invoke(caller, before));

      expect(await prisma.user.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    }
  );

  // `approvePending` needs an active team; its admin path is `usersApprovePending.integration.spec.ts`.
  it('admin can update, verify and sign out an account', async () => {
    const before = await target();
    const caller = await createCallerAs('admin');

    await caller.users.update({ id: before.id, firstName: 'Changed' });
    await caller.users.forceVerifyEmail({ userId: before.id, verified: true });
    await caller.users.revokeUserSessions({ id: before.id });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.firstName).toBe('Changed');
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
  });
});
