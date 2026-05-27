import type { PrismaClient } from '@prisma/client';
import type { SolverHoliday } from '@luke/calendar';

export async function loadHolidaysForSolver(
  prisma: PrismaClient,
  countryCodes: string[],
): Promise<SolverHoliday[]> {
  if (countryCodes.length === 0) return [];

  const rows = await prisma.holiday.findMany({
    where: { countryCode: { in: countryCodes } },
    select: { countryCode: true, startDate: true, endDate: true },
  });

  return rows.map(r => ({
    countryCode: r.countryCode,
    startDate: r.startDate,
    endDate: r.endDate,
  }));
}

export async function loadVendorClosuresForSolver(
  prisma: PrismaClient,
  vendorIds: string[],
  seasonId: string,
): Promise<SolverHoliday[]> {
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
