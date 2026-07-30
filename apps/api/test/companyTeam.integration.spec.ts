/**
 * Invarianti di CompanyTeam.
 *
 * La versione precedente di questo file testava il concetto di "main team"
 * (`isMain`, main team auto-creato per ogni function, indice parziale su un solo
 * main per function). Il commit 28b1873 ha rimosso l'intero concetto passando a
 * un modello di accesso opt-in via brand scope: quei quattro test coprivano una
 * feature che non esiste più. Riscritti sugli invarianti attuali.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { appRouter } from '../src/routers/index';

import { createTestContext, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
let adminSession: UserSession;


/** Crea una function e restituisce il suo id. */
async function createFunction(): Promise<string> {
  const uid = randomUUID().substring(0, 8);
  const fn = await prisma.companyFunction.create({
    data: { slug: `team_fn_${uid}`, name: `Team Fn ${uid}`, order: 97, isActive: true },
  });
  return fn.id;
}

beforeAll(async () => {
  // `setupTestDb()` garantisce lo schema e tronca: l'ordine dei file non è
  // alfabetico né stabile, quindi nessuna suite può assumere che un'altra
  // abbia già creato le tabelle.
  prisma = await setupTestDb();

  const uid = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: { email: `team-admin-${uid}@test.com`, username: `team-admin-${uid}`, firstName: 'Team', lastName: 'Admin', role: 'admin', isActive: true },
  });
  adminSession = { user: { id: user.id, email: user.email, username: user.username, role: 'admin', tokenVersion: 0 } };
});

afterAll(async () => {
});

describe('CompanyTeam invariants', () => {
  it('il nome del team è unico dentro la stessa function', async () => {
    const functionId = await createFunction();
    const caller = appRouter.createCaller(createTestContext(adminSession));

    await caller.company.team.create({ functionId, name: 'Duplicato' });

    // @@unique([functionId, name]) sullo schema: il secondo insert deve fallire.
    await expect(
      caller.company.team.create({ functionId, name: 'Duplicato' })
    ).rejects.toThrow();
  });

  it('lo stesso nome è ammesso in function diverse', async () => {
    const [fnA, fnB] = await Promise.all([createFunction(), createFunction()]);
    const caller = appRouter.createCaller(createTestContext(adminSession));

    // L'unicità è per (functionId, name), non globale.
    await caller.company.team.create({ functionId: fnA, name: 'Condiviso' });
    const second = await caller.company.team.create({ functionId: fnB, name: 'Condiviso' });

    expect(second.name).toBe('Condiviso');
  });

  it('delete di un team inesistente → NOT_FOUND, non un errore Prisma grezzo', async () => {
    const caller = appRouter.createCaller(createTestContext(adminSession));

    // Il router intercetta P2025 e lo traduce: senza quel catch il client
    // riceverebbe un INTERNAL_SERVER_ERROR su una richiesta legittima.
    await expect(
      caller.company.team.delete({ id: randomUUID() })
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'NOT_FOUND'
    );
  });

  it('create con brandIds popola i brand scope nella stessa transazione', async () => {
    const functionId = await createFunction();
    const caller = appRouter.createCaller(createTestContext(adminSession));

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
    const caller = appRouter.createCaller(createTestContext(adminSession));

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

    // La semantica è "sostituisci", non "aggiungi": accumulare allargherebbe
    // silenziosamente l'accesso ai brand a ogni update.
    const scopes = await prisma.companyTeamBrandScope.findMany({ where: { teamId: team.id } });
    expect(scopes.map(s => s.brandId)).toEqual([brandB.id]);
  });

  it('update con brandIds omesso lascia gli scope invariati', async () => {
    const functionId = await createFunction();
    const caller = appRouter.createCaller(createTestContext(adminSession));

    const brand = await prisma.brand.create({
      data: { code: `TK-${randomUUID().substring(0, 6)}`, name: 'Team Brand Keep', isActive: true },
    });

    const team = await caller.company.team.create({
      functionId,
      name: `Keep ${randomUUID().substring(0, 6)}`,
      brandIds: [brand.id],
    });

    // `brandIds: undefined` significa "non toccare", non "svuota".
    await caller.company.team.update({ id: team.id, name: 'Rinominato' });

    const scopes = await prisma.companyTeamBrandScope.findMany({ where: { teamId: team.id } });
    expect(scopes.map(s => s.brandId)).toEqual([brand.id]);
  });
});
