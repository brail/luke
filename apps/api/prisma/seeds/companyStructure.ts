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

  // Real user memberships — idempotent upsert
  // editors → Prodotto main team (brandScopes=[] = all brands)
  // admin → all 3 main teams
  const prodottoId = functionIds['product'];
  if (prodottoId) {
    const prodottoTeam = await prisma.companyTeam.findFirst({ where: { functionId: prodottoId, isMain: true } });
    if (prodottoTeam) {
      const EDITOR_EMAILS = ['luca.bagante@shoose.it', 'luca.bagante@febos.com'];
      const editors = await prisma.user.findMany({ where: { email: { in: EDITOR_EMAILS } }, select: { id: true } });
      for (const u of editors) {
        await prisma.companyTeamMembership.upsert({
          where: { teamId_userId: { teamId: prodottoTeam.id, userId: u.id } },
          create: { teamId: prodottoTeam.id, userId: u.id },
          update: {},
        });
      }
    }
  }

  const ADMIN_EMAIL = 'luca.bagante@gmail.com';
  const adminUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  if (adminUser) {
    const allMainTeams = await prisma.companyTeam.findMany({
      where: { isMain: true, function: { slug: { in: ['product', 'sales', 'sourcing'] } } },
      select: { id: true },
    });
    for (const team of allMainTeams) {
      await prisma.companyTeamMembership.upsert({
        where: { teamId_userId: { teamId: team.id, userId: adminUser.id } },
        create: { teamId: team.id, userId: adminUser.id },
        update: {},
      });
    }
  }

  return functionIds;
}
