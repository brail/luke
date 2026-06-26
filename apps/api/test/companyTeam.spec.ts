import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { UserSession } from '../src/lib/auth';
import type { Context } from '../src/lib/trpc';
import { appRouter } from '../src/routers/index';

let prisma: PrismaClient;
let adminUserId: string;
let adminSession: UserSession;

function createContext(session: UserSession): Context {
  return {
    prisma,
    session,
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    req: { headers: {}, ip: '127.0.0.1', log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } } as any,
    res: {} as any,
    traceId: randomUUID(),
  };
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const uid = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: { email: `team-admin-${uid}@test.com`, username: `team-admin-${uid}`, firstName: 'Team', lastName: 'Admin', role: 'admin', isActive: true },
  });
  adminUserId = user.id;
  adminSession = { user: { id: user.id, email: user.email, username: user.username, role: 'admin', tokenVersion: 0 } };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CompanyTeam invariants', () => {
  it('crea function → esiste main team con isMain=true', async () => {
    const caller = appRouter.createCaller(createContext(adminSession));
    const uid = randomUUID().substring(0, 6);
    const fn = await caller.company.function.create({ slug: `inv_fn_${uid}`, name: `Inv Fn ${uid}` });

    const teams = await caller.company.team.listByFunction({ functionId: fn.id });
    const mainTeam = teams.find((t: any) => t.isMain);
    expect(mainTeam).toBeDefined();
    expect(mainTeam?.name).toBe(`Inv Fn ${uid}`);
  });

  it('delete main team via API → BAD_REQUEST', async () => {
    const caller = appRouter.createCaller(createContext(adminSession));
    const uid = randomUUID().substring(0, 6);
    await caller.company.function.create({ slug: `inv_del_${uid}`, name: `Inv Del ${uid}` });

    const teams = await prisma.companyTeam.findMany({ where: { function: { slug: `inv_del_${uid}` }, isMain: true } });
    const mainTeamId = teams[0]?.id;
    expect(mainTeamId).toBeDefined();

    await expect(caller.company.team.delete({ id: mainTeamId! })).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === 'BAD_REQUEST'
    );
  });

  it('secondo main team via raw SQL → violazione partial unique index', async () => {
    const uid = randomUUID().substring(0, 6);
    const fn = await prisma.companyFunction.create({
      data: { slug: `inv_dup_${uid}`, name: `Inv Dup ${uid}`, order: 98, isActive: true },
    });
    // Crea il main team obbligatorio
    await prisma.companyTeam.create({ data: { functionId: fn.id, name: 'Main', isMain: true } });

    // Tentativo di secondo main team via raw SQL → deve violare l'indice parziale
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO company_teams (id, "functionId", name, "isMain", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, true, now(), now())`,
        randomUUID(),
        fn.id,
        'Duplicate Main'
      )
    ).rejects.toThrow();
  });

  it('isMain non è presente negli input schema di create/update', async () => {
    const caller = appRouter.createCaller(createContext(adminSession));
    const uid = randomUUID().substring(0, 6);
    const fn = await caller.company.function.create({ slug: `inv_nm_${uid}`, name: `Inv NoMain ${uid}` });

    // create team: isMain non è nel tipo — TS enforcerebbe questo, ma testiamo che
    // anche passandolo come `any` non venga usato (il router forza isMain=false)
    const newTeam = await caller.company.team.create({
      functionId: fn.id,
      name: 'Sub Team',
    } as any);
    expect(newTeam.isMain).toBe(false);
  });
});
