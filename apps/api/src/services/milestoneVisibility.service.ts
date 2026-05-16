import type { PrismaClient } from '@prisma/client';

/**
 * Returns Set of milestone IDs visible to userId from candidateMilestoneIds.
 * Visibility sources:
 *   1. MilestoneVisibility — function-level (user's team functions)
 *   2. MilestoneUserVisibility — explicit user override
 */
export async function getVisibleMilestoneIdsForUser(
  userId: string,
  candidateMilestoneIds: string[],
  prisma: PrismaClient
): Promise<Set<string>> {
  if (candidateMilestoneIds.length === 0) return new Set();

  // Collect all functionIds from user's team memberships
  const memberships = await prisma.companyTeamMembership.findMany({
    where: { userId, team: { isActive: true } },
    select: { team: { select: { functionId: true } } },
  });
  const functionIds = [...new Set(memberships.map(m => m.team.functionId))];

  const [fnVisibilities, userVisibilities] = await Promise.all([
    functionIds.length > 0
      ? prisma.milestoneVisibility.findMany({
          where: {
            milestoneId: { in: candidateMilestoneIds },
            functionId: { in: functionIds },
          },
          select: { milestoneId: true },
        })
      : Promise.resolve([]),
    prisma.milestoneUserVisibility.findMany({
      where: {
        milestoneId: { in: candidateMilestoneIds },
        userId,
      },
      select: { milestoneId: true },
    }),
  ]);

  const visible = new Set<string>();
  for (const r of fnVisibilities) visible.add(r.milestoneId);
  for (const r of userVisibilities) visible.add(r.milestoneId);
  return visible;
}
