import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { UserSession } from '../src/lib/auth';
import type { Context } from '../src/lib/trpc';
import { appRouter } from '../src/routers/index';

let prisma: PrismaClient;

const users = {
  admin: {} as { id: string; session: UserSession },
  editor: {} as { id: string; session: UserSession },
  viewer: {} as { id: string; session: UserSession },
};

let testFunctionId: string;
let testTeamId: string;
let testMemberId: string;

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

async function makeUser(role: 'admin' | 'editor' | 'viewer') {
  const uid = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: { email: `rbac-${role}-${uid}@test.com`, username: `rbac-${role}-${uid}`, firstName: role, lastName: 'RBAC', role, isActive: true },
  });
  const session: UserSession = { user: { id: user.id, email: user.email, username: user.username, role: user.role, tokenVersion: 0 } };
  return { id: user.id, session };
}

beforeAll(async () => {
  prisma = new PrismaClient();

  [users.admin, users.editor, users.viewer] = await Promise.all([
    makeUser('admin'),
    makeUser('editor'),
    makeUser('viewer'),
  ]);

  const uid = randomUUID().substring(0, 6);
  const fn = await prisma.companyFunction.create({
    data: { slug: `rbac_fn_${uid}`, name: `RBAC Fn ${uid}`, order: 95, isActive: true },
  });
  testFunctionId = fn.id;

  const team = await prisma.companyTeam.create({ data: { functionId: fn.id, name: `RBAC Team ${uid}`, isMain: true } });
  testTeamId = team.id;

  // Un utente da usare come membro nei test addMembers/removeMembers
  const member = await prisma.user.create({
    data: { email: `rbac-member-${uid}@test.com`, username: `rbac-member-${uid}`, firstName: 'Member', lastName: 'RBAC', role: 'viewer', isActive: true },
  });
  testMemberId = member.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function expectForbidden(promise: Promise<unknown>) {
  return expect(promise).rejects.toSatisfy((e: unknown) =>
    e instanceof TRPCError && e.code === 'FORBIDDEN'
  );
}

describe('RBAC — company.profile', () => {
  it('admin: get OK', async () => {
    const caller = appRouter.createCaller(createContext(users.admin.session));
    await expect(caller.company.profile.get()).resolves.toBeDefined();
  });

  it('editor: get OK', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expect(caller.company.profile.get()).resolves.toBeDefined();
  });

  it('viewer: get OK', async () => {
    const caller = appRouter.createCaller(createContext(users.viewer.session));
    await expect(caller.company.profile.get()).resolves.toBeDefined();
  });

  it('editor: update → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.profile.update({ legalName: 'X', displayName: 'X' }));
  });

  it('viewer: update → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.viewer.session));
    await expectForbidden(caller.company.profile.update({ legalName: 'X', displayName: 'X' }));
  });
});

describe('RBAC — company.function', () => {
  it('admin: list OK', async () => {
    const caller = appRouter.createCaller(createContext(users.admin.session));
    await expect(caller.company.function.list()).resolves.toBeInstanceOf(Array);
  });

  it('editor: list OK', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expect(caller.company.function.list()).resolves.toBeInstanceOf(Array);
  });

  it('viewer: list OK', async () => {
    const caller = appRouter.createCaller(createContext(users.viewer.session));
    await expect(caller.company.function.list()).resolves.toBeInstanceOf(Array);
  });

  it('editor: create → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.function.create({ slug: 'xtest', name: 'X' }));
  });

  it('viewer: create → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.viewer.session));
    await expectForbidden(caller.company.function.create({ slug: 'xtestv', name: 'X' }));
  });

  it('editor: update → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.function.update({ id: testFunctionId, name: 'Y' }));
  });

  it('editor: deactivate → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.function.deactivate({ id: testFunctionId }));
  });
});

describe('RBAC — company.team', () => {
  it('admin: listByFunction OK', async () => {
    const caller = appRouter.createCaller(createContext(users.admin.session));
    await expect(caller.company.team.listByFunction({ functionId: testFunctionId })).resolves.toBeInstanceOf(Array);
  });

  it('editor: listByFunction OK', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expect(caller.company.team.listByFunction({ functionId: testFunctionId })).resolves.toBeInstanceOf(Array);
  });

  it('viewer: listByFunction OK', async () => {
    const caller = appRouter.createCaller(createContext(users.viewer.session));
    await expect(caller.company.team.listByFunction({ functionId: testFunctionId })).resolves.toBeInstanceOf(Array);
  });

  it('editor: create → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.team.create({ functionId: testFunctionId, name: 'X' }));
  });

  it('viewer: create → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.viewer.session));
    await expectForbidden(caller.company.team.create({ functionId: testFunctionId, name: 'X' }));
  });

  it('editor: delete → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.team.delete({ id: testTeamId }));
  });

  it('editor: addMembers → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.team.addMembers({ teamId: testTeamId, userIds: [testMemberId] }));
  });

  it('editor: removeMembers → FORBIDDEN', async () => {
    const caller = appRouter.createCaller(createContext(users.editor.session));
    await expectForbidden(caller.company.team.removeMembers({ teamId: testTeamId, userIds: [testMemberId] }));
  });
});
