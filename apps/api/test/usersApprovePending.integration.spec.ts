/**
 * `users.approvePending` — team assignment at approval time (Piano C).
 *
 * Replaces `auth.provisioning.defaultTeamId` (removed): an LDAP user is now provisioned with no
 * team at all (`ldapAuth.ts`), and `approvePending` requires one explicitly, in the same
 * transaction that clears `pendingApproval` and creates the `CompanyTeamMembership`. This is the
 * first point a human decides where the user belongs, instead of a config key silently deciding
 * it for them (or a team-less pending user later ending up with brand-unrestricted-looking gaps).
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, expectToThrow, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let activeTeamId: string;
let inactiveTeamId: string;

async function createPendingUser() {
  const { user } = await createTestUser('viewer');
  await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });
  return user;
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6);

  const admin = await createTestUser('admin');
  adminSession = admin.session;

  const fn = await prisma.companyFunction.create({
    data: { slug: `approve_${uid}`, name: 'Approve Fn', order: 93, isActive: true },
  });

  const [activeTeam, inactiveTeam] = await Promise.all([
    prisma.companyTeam.create({ data: { functionId: fn.id, name: `Approve Active ${uid}`, isActive: true } }),
    prisma.companyTeam.create({ data: { functionId: fn.id, name: `Approve Inactive ${uid}`, isActive: false } }),
  ]);
  activeTeamId = activeTeam.id;
  inactiveTeamId = inactiveTeam.id;
});

describe('users.approvePending', () => {
  it('senza teamId è rifiutato dallo schema Zod', async () => {
    const pending = await createPendingUser();
    const caller = createCallerWithSession(adminSession);

    // `teamId` is required by the schema — bypassing the type to exercise the runtime check
    // the schema enforces, the same way other zod-boundary tests in this suite do.
    await expectToThrow(
      caller.users.approvePending({ id: pending.id } as unknown as { id: string; teamId: string }),
      { code: 'BAD_REQUEST' }
    );
  });

  it('con un team non attivo è rifiutato, e l\'utente resta pending', async () => {
    const pending = await createPendingUser();
    const caller = createCallerWithSession(adminSession);

    await expectToThrow(
      caller.users.approvePending({ id: pending.id, teamId: inactiveTeamId }),
      { code: 'BAD_REQUEST' }
    );

    const stillPending = await prisma.user.findUnique({ where: { id: pending.id }, select: { pendingApproval: true } });
    expect(stillPending?.pendingApproval).toBe(true);
    const membership = await prisma.companyTeamMembership.findUnique({
      where: { teamId_userId: { teamId: inactiveTeamId, userId: pending.id } },
    });
    expect(membership).toBeNull();
  });

  it('con un team attivo crea la membership e azzera pendingApproval, nella stessa transazione', async () => {
    const pending = await createPendingUser();
    const caller = createCallerWithSession(adminSession);

    const result = await caller.users.approvePending({ id: pending.id, teamId: activeTeamId });
    expect(result.success).toBe(true);

    const approved = await prisma.user.findUnique({ where: { id: pending.id }, select: { pendingApproval: true } });
    expect(approved?.pendingApproval).toBe(false);

    const membership = await prisma.companyTeamMembership.findUnique({
      where: { teamId_userId: { teamId: activeTeamId, userId: pending.id } },
    });
    expect(membership).not.toBeNull();
  });

  it('un utente non pending → NOT_FOUND, senza creare membership', async () => {
    const { user } = await createTestUser('viewer'); // pendingApproval: false by default
    const caller = createCallerWithSession(adminSession);

    await expectToThrow(
      caller.users.approvePending({ id: user.id, teamId: activeTeamId }),
      { code: 'NOT_FOUND' }
    );

    const membership = await prisma.companyTeamMembership.findUnique({
      where: { teamId_userId: { teamId: activeTeamId, userId: user.id } },
    });
    expect(membership).toBeNull();
  });
});
