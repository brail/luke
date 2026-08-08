/**
 * RBAC on `company.*`: who can read and who can mutate.
 *
 * The cases are tables, not copy-pasted `it` blocks: the role × procedure matrix
 * is what grows, and written by hand it grew two identical lines at a time.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import {
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

type Role = 'admin' | 'editor' | 'viewer';

let prisma: PrismaClient;

const sessions = {} as Record<Role, UserSession>;

let testFunctionId: string;
let testTeamId: string;
let testMemberId: string;

/** Caller on `appRouter`, restricted to the namespace under test. */
function companyAs(role: Role) {
  return createCallerWithSession(sessions[role]).company;
}

/** Role, label for the test name, and invocation to deny. */
type DeniedCase = [Role, string, (role: Role) => Promise<unknown>];

const ALL_ROLES: Role[] = ['admin', 'editor', 'viewer'];

beforeAll(async () => {
  // `setupTestDb()` guarantees the schema and truncates: file order isn't
  // alphabetical or stable, so no suite can assume that another suite
  // has already created the tables.
  prisma = await setupTestDb();

  const [admin, editor, viewer] = await Promise.all(
    ALL_ROLES.map(role => createTestUser(role))
  );
  sessions.admin = admin.session;
  sessions.editor = editor.session;
  sessions.viewer = viewer.session;

  const uid = randomUUID().substring(0, 6);
  const fn = await prisma.companyFunction.create({
    data: {
      slug: `rbac_fn_${uid}`,
      name: `RBAC Fn ${uid}`,
      order: 95,
      isActive: true,
    },
  });
  testFunctionId = fn.id;

  const team = await prisma.companyTeam.create({
    data: { functionId: fn.id, name: `RBAC Team ${uid}` },
  });
  testTeamId = team.id;

  // A user to use as a member in the addMembers/removeMembers tests
  const member = await prisma.user.create({
    data: {
      email: `rbac-member-${uid}@test.com`,
      username: `rbac-member-${uid}`,
      firstName: 'Member',
      lastName: 'RBAC',
      role: 'viewer',
      isActive: true,
    },
  });
  testMemberId = member.id;
});

describe('RBAC — company.profile', () => {
  it.each(ALL_ROLES)('%s: get OK', async role => {
    await expect(companyAs(role).profile.get()).resolves.toBeDefined();
  });

  const denied: DeniedCase[] = [
    ['editor', 'update', r => companyAs(r).profile.update({ legalName: 'X', displayName: 'X' })],
    ['viewer', 'update', r => companyAs(r).profile.update({ legalName: 'X', displayName: 'X' })],
  ];

  it.each(denied)('%s: %s → FORBIDDEN', async (role, _label, invoke) => {
    await expectUnauthorized(() => invoke(role));
  });
});

describe('RBAC — company.function', () => {
  it.each(ALL_ROLES)('%s: list OK', async role => {
    await expect(companyAs(role).function.list()).resolves.toBeInstanceOf(Array);
  });

  // `deactivate` was renamed `delete` when soft-delete became the
  // sole deletion semantics: the old procedure no longer exists.
  const denied: DeniedCase[] = [
    // The slug depends on the role: if the guard regressed, two successful creates
    // would conflict on the unique constraint and the failure would point to slug,
    // not RBAC.
    ['editor', 'create', r => companyAs(r).function.create({ slug: `xtest${r}`, name: 'X' })],
    ['viewer', 'create', r => companyAs(r).function.create({ slug: `xtest${r}`, name: 'X' })],
    ['editor', 'update', r => companyAs(r).function.update({ id: testFunctionId, name: 'Y' })],
    ['editor', 'delete (soft)', r => companyAs(r).function.delete({ id: testFunctionId })],
  ];

  it.each(denied)('%s: %s → FORBIDDEN', async (role, _label, invoke) => {
    await expectUnauthorized(() => invoke(role));
  });
});

describe('RBAC — company.team', () => {
  it.each(ALL_ROLES)('%s: listByFunction OK', async role => {
    await expect(
      companyAs(role).team.listByFunction({ functionId: testFunctionId })
    ).resolves.toBeInstanceOf(Array);
  });

  const denied: DeniedCase[] = [
    ['editor', 'create', r => companyAs(r).team.create({ functionId: testFunctionId, name: 'X' })],
    ['viewer', 'create', r => companyAs(r).team.create({ functionId: testFunctionId, name: 'X' })],
    ['editor', 'delete', r => companyAs(r).team.delete({ id: testTeamId })],
    ['editor', 'addMembers', r => companyAs(r).team.addMembers({ teamId: testTeamId, userIds: [testMemberId] })],
    ['editor', 'removeMembers', r => companyAs(r).team.removeMembers({ teamId: testTeamId, userIds: [testMemberId] })],
  ];

  it.each(denied)('%s: %s → FORBIDDEN', async (role, _label, invoke) => {
    await expectUnauthorized(() => invoke(role));
  });
});
