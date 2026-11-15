declare const APPROVED_USER_WHERE: { isActive: true; pendingApproval: false };
declare const APPROVED_ADMIN_WHERE: { isActive: true; pendingApproval: false; role: 'admin' };
declare const ids: string[];
declare const prisma: {
  user: {
    findMany(args: unknown): unknown;
    count(args: unknown): unknown;
    groupBy(args: unknown): unknown;
    findFirst(args: unknown): unknown;
  };
};
declare const ctx: { prisma: typeof prisma };

export async function selections() {
  // ruleid: luke-user-selection-approved
  await ctx.prisma.user.findMany({ where: { isActive: true }, select: { email: true } });

  // ruleid: luke-user-selection-approved
  await prisma.user.count({ where: { isActive: true } });

  // ruleid: luke-user-selection-approved
  await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });

  // A hand-written copy of the whole definition drifts as well.
  // ruleid: luke-user-selection-approved
  await prisma.user.groupBy({ by: ['role'], where: { isActive: true, pendingApproval: false } });

  // ruleid: luke-user-selection-approved
  await prisma.user.findMany({ where: { pendingApproval: false, role: 'admin' } });

  // ok: luke-user-selection-approved
  await prisma.user.findMany({ where: APPROVED_USER_WHERE, select: { id: true } });

  // ok: luke-user-selection-approved
  await prisma.user.findMany({ where: { id: { in: ids }, ...APPROVED_USER_WHERE } });

  // ok: luke-user-selection-approved
  await prisma.user.count({ where: { ...APPROVED_ADMIN_WHERE, emailVerifiedAt: { not: null } } });

  // The accounts awaiting approval are a set of their own.
  // ok: luke-user-selection-approved
  await prisma.user.findMany({ where: { isActive: true, pendingApproval: true } });

  // A single-account lookup is not a set.
  // ok: luke-user-selection-approved
  await prisma.user.findFirst({ where: { username: 'alice', isActive: true } });
}
