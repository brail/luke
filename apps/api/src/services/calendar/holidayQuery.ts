/**
 * Data-access helpers that load working-day holiday inputs from the database.
 */

import type { WorkingDayHoliday } from '@luke/core';

import type { PrismaClient } from '@prisma/client';

/**
 * Loads confirmed vendor closure periods for the given vendors and season.
 *
 * Only periods with a non-null `countryCode` and a set `confirmedAt` timestamp are included.
 * Returns an empty array when `vendorIds` is empty.
 */
export async function loadVendorClosuresForSolver(
  prisma: PrismaClient,
  vendorIds: string[],
  seasonId: string,
): Promise<WorkingDayHoliday[]> {
  if (vendorIds.length === 0) return [];

  const rows = await prisma.vendorClosurePeriod.findMany({
    where: {
      vendorId: { in: vendorIds },
      seasonId,
      countryCode: { not: null },
      confirmedAt: { not: null },
    },
    select: { countryCode: true, startDate: true, endDate: true },
  });

  return rows
    .filter((r): r is typeof r & { countryCode: string } => r.countryCode !== null)
    .map(r => ({
      countryCode: r.countryCode,
      startDate: r.startDate,
      endDate: r.endDate,
    }));
}
