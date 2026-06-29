import type { PrismaClient } from '@prisma/client';

/**
 * Returns the subset of candidateEventIds visible to the given user.
 * Visibility is granted by either function-level CalendarEventVisibility (via team
 * membership) or an explicit CalendarEventUserVisibility override.
 *
 * @returns Set of visible event IDs from the candidate list.
 */
export async function getVisibleMilestoneIdsForUser(
  userId: string,
  candidateEventIds: string[],
  prisma: PrismaClient
): Promise<Set<string>> {
  if (candidateEventIds.length === 0) return new Set();

  // Collect all functionIds from user's team memberships
  const memberships = await prisma.companyTeamMembership.findMany({
    where: { userId, team: { isActive: true } },
    select: { team: { select: { functionId: true } } },
  });
  const functionIds = [...new Set(memberships.map(m => m.team.functionId))];

  const [fnVisibilities, userVisibilities] = await Promise.all([
    functionIds.length > 0
      ? prisma.calendarEventVisibility.findMany({
          where: {
            eventId: { in: candidateEventIds },
            functionId: { in: functionIds },
          },
          select: { eventId: true },
        })
      : Promise.resolve([]),
    prisma.calendarEventUserVisibility.findMany({
      where: {
        eventId: { in: candidateEventIds },
        userId,
      },
      select: { eventId: true },
    }),
  ]);

  const visible = new Set<string>();
  for (const r of fnVisibilities) visible.add(r.eventId);
  for (const r of userVisibilities) visible.add(r.eventId);
  return visible;
}
