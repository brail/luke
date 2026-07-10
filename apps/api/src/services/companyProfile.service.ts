import type { PrismaClient } from '@prisma/client';

/** Reads the company's home country from `CompanyProfile` (the singleton row). Shared by
 * `holidays.ts` (listCountries) and `phaseAlert.service.ts` (working-days deadline resolution)
 * — both previously had their own copy of this exact narrow query. */
export async function resolveCompanyCountryCode(prisma: PrismaClient): Promise<string | null> {
  const company = await prisma.companyProfile.findUnique({
    where: { id: 'singleton' },
    select: { countryCode: true },
  });
  return company?.countryCode ?? null;
}
