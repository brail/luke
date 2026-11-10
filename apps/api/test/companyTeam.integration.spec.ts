/**
 * CompanyTeam invariants.
 *
 * The previous version of this file tested the "main team" concept
 * (`isMain`, main team auto-created for each function, partial index on a single
 * main per function). Commit 28b1873 removed the whole concept, moving to
 * an opt-in access model via brand scope: those four tests covered a
 * feature that no longer exists. Rewritten against the current invariants.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import {
  createCallerWithSession,
  createTestUser,
  setupTestDb,
} from './helpers';
import { createCalendarFixture } from './helpers/calendarFixture';
import { whileHeld } from './helpers/heldTransaction';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;


/** Creates a function and returns its id. */
async function createFunction(): Promise<string> {
  const uid = randomUUID().substring(0, 8);
  const fn = await prisma.companyFunction.create({
    data: { slug: `team_fn_${uid}`, name: `Team Fn ${uid}`, order: 97, isActive: true },
  });
  return fn.id;
}

beforeAll(async () => {
  // `setupTestDb()` guarantees the schema and truncates: file order isn't
  // alphabetical or stable, so no suite can assume that another suite
  // has already created the tables.
  prisma = await setupTestDb();

  ({ session: adminSession } = await createTestUser('admin'));
});

describe('CompanyTeam invariants', () => {
  it('the team name is unique within the same function', async () => {
    const functionId = await createFunction();
    const caller = createCallerWithSession(adminSession);

    await caller.company.team.create({ functionId, name: 'Duplicato' });

    // @@unique([functionId, name]) on the schema: the second insert must fail.
    await expect(
      caller.company.team.create({ functionId, name: 'Duplicato' })
    ).rejects.toThrow();
  });

  it('the same name is allowed in different functions', async () => {
    const [fnA, fnB] = await Promise.all([createFunction(), createFunction()]);
    const caller = createCallerWithSession(adminSession);

    // Uniqueness is per (functionId, name), not global.
    await caller.company.team.create({ functionId: fnA, name: 'Condiviso' });
    const second = await caller.company.team.create({ functionId: fnB, name: 'Condiviso' });

    expect(second.name).toBe('Condiviso');
  });

  it('delete of a nonexistent team → NOT_FOUND, not a raw Prisma error', async () => {
    const caller = createCallerWithSession(adminSession);

    // The router catches P2025 and translates it: without that catch the client
    // would receive an INTERNAL_SERVER_ERROR on a legitimate request.
    await expect(
      caller.company.team.delete({ id: randomUUID() })
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'NOT_FOUND'
    );
  });

  it('create with brandIds populates the brand scopes in the same transaction', async () => {
    const functionId = await createFunction();
    const caller = createCallerWithSession(adminSession);

    const brand = await prisma.brand.create({
      data: { code: `TM-${randomUUID().substring(0, 6)}`, name: 'Team Brand', isActive: true },
    });

    const team = await caller.company.team.create({
      functionId,
      name: `Scoped ${randomUUID().substring(0, 6)}`,
      brandIds: [brand.id],
    });

    const scopes = await prisma.companyTeamBrandScope.findMany({ where: { teamId: team.id } });
    expect(scopes.map(s => s.brandId)).toEqual([brand.id]);
  });

  it('update with brandIds replaces the scopes, it does not accumulate them', async () => {
    const functionId = await createFunction();
    const caller = createCallerWithSession(adminSession);

    const [brandA, brandB] = await Promise.all([
      prisma.brand.create({ data: { code: `TA-${randomUUID().substring(0, 6)}`, name: 'Team Brand A', isActive: true } }),
      prisma.brand.create({ data: { code: `TB-${randomUUID().substring(0, 6)}`, name: 'Team Brand B', isActive: true } }),
    ]);

    const team = await caller.company.team.create({
      functionId,
      name: `Replace ${randomUUID().substring(0, 6)}`,
      brandIds: [brandA.id],
    });

    await caller.company.team.update({ id: team.id, name: team.name, brandIds: [brandB.id] });

    // The semantics is "replace", not "add": accumulating would silently
    // widen brand access on every update.
    const scopes = await prisma.companyTeamBrandScope.findMany({ where: { teamId: team.id } });
    expect(scopes.map(s => s.brandId)).toEqual([brandB.id]);
  });

  it('update without brandIds leaves the scopes unchanged', async () => {
    const functionId = await createFunction();
    const caller = createCallerWithSession(adminSession);

    const brand = await prisma.brand.create({
      data: { code: `TK-${randomUUID().substring(0, 6)}`, name: 'Team Brand Keep', isActive: true },
    });

    const team = await caller.company.team.create({
      functionId,
      name: `Keep ${randomUUID().substring(0, 6)}`,
      brandIds: [brand.id],
    });

    // `brandIds: undefined` means "don't touch", not "clear".
    await caller.company.team.update({ id: team.id, name: 'Rinominato' });

    const scopes = await prisma.companyTeamBrandScope.findMany({ where: { teamId: team.id } });
    expect(scopes.map(s => s.brandId)).toEqual([brand.id]);
  });
});

/** An update leaves an omitted field as stored, and applies an explicit one (#225). */
describe('function and team updates', () => {
  const caller = () => createCallerWithSession(adminSession);

  it('editing a function without order keeps its order', async () => {
    const id = await createFunction();
    await caller().company.function.update({ id, name: 'Renamed' });
    expect(await prisma.companyFunction.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: 'Renamed', order: 97, isActive: true });
  });

  it('an update without isActive keeps a deactivated function and team inactive', async () => {
    const functionId = await createFunction();
    const team = await prisma.companyTeam.create({ data: { functionId, name: `Off ${randomUUID().slice(0, 8)}`, isActive: false } });
    await prisma.companyFunction.update({ where: { id: functionId }, data: { isActive: false } });

    await caller().company.function.update({ id: functionId, name: 'Still off' });
    await caller().company.team.update({ id: team.id, name: 'Still off' });

    expect((await prisma.companyFunction.findUniqueOrThrow({ where: { id: functionId } })).isActive).toBe(false);
    expect((await prisma.companyTeam.findUniqueOrThrow({ where: { id: team.id } })).isActive).toBe(false);
  });

  it('an explicit order applies; a team update applies isActive, a function update ignores it (#237)', async () => {
    const functionId = await createFunction();
    const team = await prisma.companyTeam.create({ data: { functionId, name: `On ${randomUUID().slice(0, 8)}` } });

    // A function is deactivated only by `delete` and reactivated only by `restore`, with their checks.
    // @ts-expect-error -- `isActive` is no longer part of the function update input
    await caller().company.function.update({ id: functionId, name: 'Moved', order: 3, isActive: false });
    await caller().company.team.update({ id: team.id, name: 'Off', isActive: false });

    expect(await prisma.companyFunction.findUniqueOrThrow({ where: { id: functionId } })).toMatchObject({ order: 3, isActive: true });
    expect((await prisma.companyTeam.findUniqueOrThrow({ where: { id: team.id } })).isActive).toBe(false);
  });

  it('null clears a description, for a function and a team', async () => {
    const functionId = await createFunction();
    await prisma.companyFunction.update({ where: { id: functionId }, data: { description: 'Old text' } });
    const team = await prisma.companyTeam.create({
      data: { functionId, name: `Desc ${randomUUID().slice(0, 8)}`, description: 'Old text' },
    });

    await caller().company.function.update({ id: functionId, name: 'Cleared', description: null });
    await caller().company.team.update({ id: team.id, name: 'Cleared', description: null });

    expect((await prisma.companyFunction.findUniqueOrThrow({ where: { id: functionId } })).description).toBeNull();
    expect((await prisma.companyTeam.findUniqueOrThrow({ where: { id: team.id } })).description).toBeNull();
  });

  it('the function audit row records before and after of the changed fields only', async () => {
    const functionId = await createFunction();
    const before = await prisma.companyFunction.findUniqueOrThrow({ where: { id: functionId } });

    await caller().company.function.update({ id: functionId, name: 'After', order: 5 });

    const row = await prisma.auditLog.findFirst({
      where: { action: 'COMPANY_FUNCTION_UPDATED', targetId: functionId },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.metadata).toEqual({ oldName: before.name, newName: 'After', oldOrder: before.order, newOrder: 5 });
  });

  it('a function deleted while its update waits answers NOT_FOUND, not a server error', async () => {
    const functionId = await createFunction();

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR UPDATE', [functionId]),
      () => caller().company.function.update({ id: functionId, name: 'Too late' }),
      holder => holder.query('DELETE FROM company_functions WHERE id = $1', [functionId])
    );

    expect(outcome.status === 'rejected' && (outcome.reason as TRPCError).code).toBe('NOT_FOUND');
  });
});

/** A function's state changes only through delete and restore, which keep their checks (#237). */
describe('function delete and restore checks', () => {
  const caller = () => createCallerWithSession(adminSession);

  it('delete is refused while an active event is visible to the function', async () => {
    const functionId = await createFunction();
    const calendar = await createCalendarFixture(prisma, { prefix: 'FND' });
    await prisma.calendarEvent.create({
      data: {
        calendarId: calendar.calendarId, planningGroupId: calendar.planningGroupId, title: 'Visible',
        startAt: new Date('2096-03-02'), visibilities: { create: [{ functionId }] },
      },
    });

    await expect(caller().company.function.delete({ id: functionId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((await prisma.companyFunction.findUniqueOrThrow({ where: { id: functionId } })).isActive).toBe(true);
  });

  it('restore is refused while an active function holds the same slug', async () => {
    const slug = `dup_fn_${randomUUID().substring(0, 8)}`;
    // Two rows with one slug exist only outside the router, which refuses a duplicate on create.
    await prisma.companyFunction.create({ data: { slug, name: 'Active', order: 98, isActive: true } });
    const inactive = await prisma.companyFunction.create({ data: { slug, name: 'Inactive', order: 99, isActive: false } });

    await expect(caller().company.function.restore({ id: inactive.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await prisma.companyFunction.findUniqueOrThrow({ where: { id: inactive.id } })).isActive).toBe(false);
  });

  it('of two concurrent restores of a function, the second answers BAD_REQUEST', async () => {
    const inactive = await prisma.companyFunction.create({
      data: { slug: `twice_fn_${randomUUID().substring(0, 8)}`, name: 'Twice', isActive: false },
    });

    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM company_functions WHERE id = $1 FOR UPDATE', [inactive.id]),
      () => caller().company.function.restore({ id: inactive.id }),
      holder => holder.query('UPDATE company_functions SET "isActive" = true WHERE id = $1', [inactive.id])
    );

    expect(outcome.status === 'rejected' && (outcome.reason as TRPCError).code).toBe('BAD_REQUEST');
  });

  // Past create's check, the active-slug index refuses the loser of a race: a CONFLICT too. A restore
  // has no check of its own, so the test above already goes through the index.
  it('a concurrent create of the same slug answers CONFLICT, not a server error', async () => {
    const slug = `race_fn_${randomUUID().substring(0, 8)}`;

    const outcome = await whileHeld(
      holder => holder.query(
        `INSERT INTO company_functions (id, slug, name, "order", "isActive", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, 'Concurrent', 1, true, now())`,
        [slug]
      ),
      () => caller().company.function.create({ slug, name: 'Second' })
    );

    expect(outcome.status === 'rejected' && (outcome.reason as TRPCError).code).toBe('CONFLICT');
  });
});
