import { PrismaClient } from '@prisma/client';

const SEED_FUNCTIONS = [
  { slug: 'product',  name: 'Prodotto', order: 0 },
  { slug: 'sales',    name: 'Vendite',  order: 1 },
  { slug: 'sourcing', name: 'Sourcing', order: 2 },
] as const;

export async function seedCompanyStructure(
  prisma: PrismaClient,
): Promise<Record<string, string>> {
  const functionIds: Record<string, string> = {};

  for (const f of SEED_FUNCTIONS) {
    await prisma.$transaction(async tx => {
      const fn = await tx.companyFunction.upsert({
        where:  { slug: f.slug },
        update: { name: f.name, order: f.order },
        create: { slug: f.slug, name: f.name, order: f.order },
      });
      functionIds[f.slug] = fn.id;

      // main team — idempotent (unique on functionId+name)
      await tx.companyTeam.upsert({
        where:  { functionId_name: { functionId: fn.id, name: fn.name } },
        update: {},
        create: { functionId: fn.id, name: fn.name, isMain: true },
      });
    });
  }

  // CompanyProfile singleton
  await prisma.companyProfile.upsert({
    where:  { id: 'singleton' },
    update: {},
    create: { id: 'singleton', legalName: 'FEBOS S.r.l.', displayName: 'FEBOS' },
  });

  // AppConfig default team key (empty = not yet configured)
  await prisma.appConfig.upsert({
    where:  { key: 'auth.provisioning.defaultTeamId' },
    update: {},
    create: { key: 'auth.provisioning.defaultTeamId', value: '', isEncrypted: false },
  });

  return functionIds;
}
