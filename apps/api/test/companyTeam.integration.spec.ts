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

  it('an explicit order or isActive still applies', async () => {
    const functionId = await createFunction();
    const team = await prisma.companyTeam.create({ data: { functionId, name: `On ${randomUUID().slice(0, 8)}` } });

    await caller().company.function.update({ id: functionId, name: 'Moved', order: 3, isActive: false });
    await caller().company.team.update({ id: team.id, name: 'Off', isActive: false });

    expect(await prisma.companyFunction.findUniqueOrThrow({ where: { id: functionId } })).toMatchObject({ order: 3, isActive: false });
    expect((await prisma.companyTeam.findUniqueOrThrow({ where: { id: team.id } })).isActive).toBe(false);
  });
});
