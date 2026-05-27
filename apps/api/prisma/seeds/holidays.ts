import { PrismaClient } from '@prisma/client';

const HOLIDAY_COUNTRIES = [
  { code: 'IT', name: 'Italy' },
  { code: 'CN', name: 'China' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'IN', name: 'India' },
  { code: 'TR', name: 'Turkey' },
];

export async function seedHolidayCountries(prisma: PrismaClient): Promise<void> {
  console.log('🌍 Seeding holiday countries...');

  for (const country of HOLIDAY_COUNTRIES) {
    await prisma.holidayCountry.upsert({
      where: { code: country.code },
      update: { name: country.name },
      create: { code: country.code, name: country.name },
    });
  }

  console.log(`   ${HOLIDAY_COUNTRIES.length} holiday countries seeded`);
}
