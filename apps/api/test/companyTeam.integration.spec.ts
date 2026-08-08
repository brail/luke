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

import {
  createCallerWithSession,
  createTestUser,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

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
  it('il nome del team è unico dentro la stessa function', async () => {
    const functionId = await createFunction();
    const caller = createCallerWithSession(adminSession);

    await caller.company.team.create({ functionId, name: 'Duplicato' });

    // @@unique([functionId, name]) on the schema: the second insert must fail.
    await expect(
      caller.company.team.create({ functionId, name: 'Duplicato' })
    ).rejects.toThrow();
  });

  it('lo stesso nome è ammesso in function diverse', async () => {
    const [fnA, fnB] = await Promise.all([createFunction(), createFunction()]);
    const caller = createCallerWithSession(adminSession);

    // Uniqueness is per (functionId, name), not global.
    await caller.company.team.create({ functionId: fnA, name: 'Condiviso' });
    const second = await caller.company.team.create({ functionId: fnB, name: 'Condiviso' });

    expect(second.name).toBe('Condiviso');
  });

  it('delete di un team inesistente → NOT_FOUND, non un errore Prisma grezzo', async () => {
    const caller = createCallerWithSession(adminSession);

    // The router catches P2025 and translates it: without that catch the client
    // would receive an INTERNAL_SERVER_ERROR on a legitimate request.
    await expect(
      caller.company.team.delete({ id: randomUUID() })
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'NOT_FOUND'
    );
  });

  it('create con brandIds popola i brand scope nella stessa transazione', async () => {
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

  it('update con brandIds sostituisce gli scope, non li accumula', async () => {
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

  it('update con brandIds omesso lascia gli scope invariati', async () => {
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
