/**
 * `users.approvePending` — team assignment at approval time (Piano C), and, since #272 (ADR-044), the
 * address, role and section overrides an administrator gives with it, all in one transaction.
 *
 * Replaces `auth.provisioning.defaultTeamId` (removed): an LDAP user is now provisioned with no
 * team at all (`ldapAuth.ts`), and `approvePending` requires one explicitly, in the same
 * transaction that clears `pendingApproval` and creates the `CompanyTeamMembership`. This is the
 * first point a human decides where the user belongs, instead of a config key silently deciding
 * it for them (or a team-less pending user later ending up with brand-unrestricted-looking gaps).
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { APPROVAL_HAS_EMAIL_MESSAGE, APPROVAL_NEEDS_EMAIL_MESSAGE, LDAP_SYNTHETIC_EMAIL_DOMAIN } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, expectToThrow, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let activeTeamId: string;
let inactiveTeamId: string;
let functionId: string;

async function createPendingUser(email?: string) {
  const { user } = await createTestUser('viewer');
  return prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true, email } });
}

const syntheticAddress = () => `synthetic-${randomUUID().substring(0, 8)}@${LDAP_SYNTHETIC_EMAIL_DOMAIN}`;

/** A pending account on a synthetic address, verified (`createTestUser`) and with a live link, to see what moves. */
async function createSyntheticPendingUser() {
  const pending = await createPendingUser(syntheticAddress());
  await prisma.userToken.create({
    data: { userId: pending.id, type: 'RESET', tokenHash: `link-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
  });
  return prisma.user.findUniqueOrThrow({ where: { id: pending.id } });
}

/** Everything an approval can write for `userId`, to compare before and after a refusal. */
async function stateOf(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true, role: true, tokenVersion: true, pendingApproval: true },
  });
  return {
    user,
    overrides: await prisma.userSectionAccess.findMany({ where: { userId }, select: { section: true, enabled: true } }),
    links: await prisma.userToken.count({ where: { userId } }),
    memberships: await prisma.companyTeamMembership.count({ where: { userId } }),
    auditRows: await prisma.auditLog.count({
      where: {
        OR: [{ targetId: userId }, { targetId: { startsWith: `${userId}:` } }, { targetId: { endsWith: `:${userId}` } }],
        action: { not: 'USER_APPROVED' },
      },
    }),
  };
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
  functionId = fn.id;
  activeTeamId = activeTeam.id;
  inactiveTeamId = inactiveTeam.id;
});

describe('users.approvePending', () => {
  it('without teamId it is rejected by the Zod schema', async () => {
    const pending = await createPendingUser();
    const caller = createCallerWithSession(adminSession);

    // `teamId` is required by the schema — bypassing the type to exercise the runtime check
    // the schema enforces, the same way other zod-boundary tests in this suite do.
    await expectToThrow(
      caller.users.approvePending({ id: pending.id } as unknown as { id: string; teamId: string }),
      { code: 'BAD_REQUEST' }
    );
  });

  it('with an inactive team it is rejected, and the user stays pending', async () => {
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

  it('with an active team it creates the membership and clears pendingApproval, in the same transaction', async () => {
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

  it('a user not pending → NOT_FOUND, no membership created', async () => {
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

  // #266, owner #69 a: an LDAP user can no longer give an address once approved.
  describe('a user still on a synthetic LDAP address', () => {
    it('is refused with its text, and stays pending with no membership and no access change', async () => {
      const pending = await createPendingUser(`synthetic-${randomUUID().substring(0, 8)}@ldap.local`);

      await expectToThrow(
        createCallerWithSession(adminSession).users.approvePending({ id: pending.id, teamId: activeTeamId }),
        { code: 'PRECONDITION_FAILED', message: APPROVAL_NEEDS_EMAIL_MESSAGE }
      );

      expect(await prisma.user.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ pendingApproval: true });
      expect(await prisma.companyTeamMembership.count({ where: { userId: pending.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'USER_ACCESS_CHANGED', targetId: pending.id } })).toBe(0);
    });
  });

  // #272, ADR-044: an administrator gives the address, role and overrides with the approval.
  describe('with the address, role and overrides', () => {
    it('stores the address in its stored form, unverified, with its links revoked and sessions ended', async () => {
      const pending = await createSyntheticPendingUser();

      await createCallerWithSession(adminSession).users.approvePending({
        id: pending.id,
        teamId: activeTeamId,
        email: `  Real-${pending.id.substring(0, 8)}@Example.COM `,
      });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: pending.id } });
      expect(after).toMatchObject({
        email: `real-${pending.id.substring(0, 8)}@example.com`,
        emailVerifiedAt: null,
        pendingApproval: false,
        role: 'viewer',
        tokenVersion: pending.tokenVersion + 1,
      });
      // The link mailed to the old address is gone; the only one left is the new address's verification.
      expect(await prisma.userToken.findMany({ where: { userId: pending.id }, select: { type: true } })).toEqual([{ type: 'VERIFY' }]);
      const changed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'EMAIL_CHANGED', targetId: pending.id } });
      expect(changed.metadata).toEqual({ reason: 'admin_approval', resetTokensRevoked: 1 });
    });

    it('applies the role and the overrides, checking each override against the new role, with one session bump', async () => {
      const pending = await createSyntheticPendingUser();

      await createCallerWithSession(adminSession).users.approvePending({
        id: pending.id,
        teamId: activeTeamId,
        email: `both-${pending.id.substring(0, 8)}@example.com`,
        role: 'admin',
        // `audit:read_all` is the admin's only: turned on, it passes only against the new role (ADR-043).
        sectionOverrides: [
          { section: 'maintenance.audit_log', enabled: true },
          { section: 'sales.statistics', enabled: false },
        ],
      });

      const state = await stateOf(pending.id);
      expect(state.user).toMatchObject({ role: 'admin', pendingApproval: false, tokenVersion: pending.tokenVersion + 1 });
      expect(state.overrides).toEqual(expect.arrayContaining([
        { section: 'maintenance.audit_log', enabled: true },
        { section: 'sales.statistics', enabled: false },
      ]));
      expect(state.overrides).toHaveLength(2);
      const roleRow = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_ACCESS_CHANGED', targetId: pending.id, metadata: { path: ['newRole'], equals: 'admin' } },
      });
      expect(roleRow.metadata).toEqual({ oldRole: 'viewer', newRole: 'admin' });
      expect(await prisma.auditLog.count({ where: { action: 'SECTION_ACCESS_UPDATED', targetId: { startsWith: `${pending.id}:` } } })).toBe(2);
    });

    it('refuses an address another account holds, leaving everything as it was', async () => {
      const pending = await createSyntheticPendingUser();
      const { user: holder } = await createTestUser('viewer');
      const before = await stateOf(pending.id);

      await expectToThrow(
        createCallerWithSession(adminSession).users.approvePending({ id: pending.id, teamId: activeTeamId, email: holder.email }),
        { code: 'CONFLICT' }
      );

      expect(await stateOf(pending.id)).toEqual(before);
    });

    it('never replaces an address the user gave meanwhile, and says so', async () => {
      const pending = await createPendingUser(`own-${randomUUID().substring(0, 8)}@example.com`);
      const before = await stateOf(pending.id);

      await expectToThrow(
        createCallerWithSession(adminSession).users.approvePending({
          id: pending.id,
          teamId: activeTeamId,
          email: `admin-typed-${pending.id.substring(0, 8)}@example.com`,
        }),
        { code: 'PRECONDITION_FAILED', message: APPROVAL_HAS_EMAIL_MESSAGE }
      );

      expect(await stateOf(pending.id)).toEqual(before);
    });

    it('refuses a synthetic address as the new one', async () => {
      const pending = await createSyntheticPendingUser();

      await expectToThrow(
        createCallerWithSession(adminSession).users.approvePending({ id: pending.id, teamId: activeTeamId, email: syntheticAddress() }),
        { code: 'BAD_REQUEST' }
      );
    });

    // A refusal after the other parts were written: the inactive team is checked after them, and an
    // override the role cannot hold after the address and role.
    it.each([
      ['an inactive team', () => inactiveTeamId, 'viewer' as const, [] as const],
      ['an override the role cannot hold', () => activeTeamId, 'editor' as const, [{ section: 'maintenance.audit_log' as const, enabled: true }]],
    ])('a refusal for %s leaves address, role, overrides, links, sessions, team and trail as they were', async (_, team, role, overrides) => {
      const pending = await createSyntheticPendingUser();
      const before = await stateOf(pending.id);

      await expect(createCallerWithSession(adminSession).users.approvePending({
        id: pending.id,
        teamId: team(),
        email: `refused-${pending.id.substring(0, 8)}@example.com`,
        role,
        sectionOverrides: [{ section: 'sales.statistics', enabled: false }, ...overrides],
      })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(await stateOf(pending.id)).toEqual(before);
    });

    it('of two approvals with different payloads, one wins and the other leaves nothing of its own', async () => {
      const pending = await createSyntheticPendingUser();
      const caller = createCallerWithSession(adminSession);
      const teamB = await prisma.companyTeam.create({
        data: { functionId, name: `Approve Race ${randomUUID().substring(0, 6)}`, isActive: true },
      });
      const payloads = [
        { teamId: activeTeamId, email: `race-a-${pending.id.substring(0, 8)}@example.com`, role: 'editor' as const },
        { teamId: teamB.id, email: `race-b-${pending.id.substring(0, 8)}@example.com`, role: 'admin' as const },
      ];

      const results = await Promise.allSettled(payloads.map(payload => caller.users.approvePending({ id: pending.id, ...payload })));

      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const winner = payloads[results.findIndex(r => r.status === 'fulfilled')]!;
      const after = await prisma.user.findUniqueOrThrow({ where: { id: pending.id } });
      expect(after).toMatchObject({ email: winner.email, role: winner.role, tokenVersion: pending.tokenVersion + 1 });
      expect(await prisma.companyTeamMembership.findMany({ where: { userId: pending.id }, select: { teamId: true } }))
        .toEqual([{ teamId: winner.teamId }]);
      expect(await prisma.auditLog.count({ where: { action: 'EMAIL_CHANGED', targetId: pending.id } })).toBe(1);
    });
  });
});
