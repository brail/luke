/**
 * Seed script for Luke API
 * Creates the admin user and initial configurations
 *
 * Exportable functions for use in bootstrap and tests:
 * - seedAdminUser(prisma): Creates/updates the admin user
 * - seedAppConfigs(prisma): Creates base configurations (no LDAP)
 */

import { randomBytes } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { DEFAULT_PASSWORD_POLICY } from '@luke/core';

import { encryptValue } from '../src/lib/configManager';
import { hashPassword } from '../src/lib/password';
import { seedCollectionCatalog } from './seeds/collectionCatalog';
import { seedCompanyStructure } from './seeds/companyStructure';
import { seedHolidayCountries } from './seeds/holidays';

/**
 * Initializes Prisma Client
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

/**
 * Creates/updates the admin user with a local identity
 * Idempotent function: can be run multiple times without duplication
 */
export async function seedAdminUser(prisma: PrismaClient): Promise<void> {
  console.log('👤 Seeding utente admin...');

  // Check whether the admin user already exists
  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [{ email: 'admin@luke.local' }, { username: 'admin' }],
    },
  });

  if (existingAdmin) {
    console.log('⚠️  Utente admin già esistente, verifica stato...');
    console.log(
      `🔍 Admin user details: ID=${existingAdmin.id}, Email=${existingAdmin.email}, Username=${existingAdmin.username}, Active=${existingAdmin.isActive}`
    );

    // Activate the admin user if it's not active
    if (!existingAdmin.isActive) {
      console.log('🔧 Attivazione utente admin...');
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { isActive: true },
      });
      console.log('✅ Utente admin attivato');
    } else {
      console.log('✅ Utente admin già attivo');
    }
  } else {
    // Hash the admin password using the centralized function
    const adminPassword = 'changeme';
    const passwordHash = await hashPassword(adminPassword);

    console.log('🔧 Creazione utente admin...');

    // Create admin user with local identity in a transaction
    const adminUser = await prisma.$transaction(async tx => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: 'admin@luke.local',
          username: 'admin',
          role: 'admin',
          isActive: true,
          emailVerifiedAt: new Date(), // Admin pre-verified
        },
      });

      // Create local identity
      const identity = await tx.identity.create({
        data: {
          userId: user.id,
          provider: 'LOCAL',
          providerId: 'admin',
        },
      });

      // Create local credential
      await tx.localCredential.create({
        data: {
          identityId: identity.id,
          passwordHash,
        },
      });

      return user;
    });

    console.log(
      `✅ Utente admin creato: ${adminUser.email} (ID: ${adminUser.id})`
    );
  }
}

/**
 * Updates existing users with emailVerifiedAt
 * Marks all existing users (without emailVerifiedAt) as verified
 */
export async function updateExistingUsersVerification(
  prisma: PrismaClient
): Promise<void> {
  console.log('📧 Aggiornamento verifica email utenti esistenti...');

  const usersToUpdate = await prisma.user.findMany({
    where: {
      emailVerifiedAt: null,
    },
  });

  if (usersToUpdate.length === 0) {
    console.log('✅ Nessun utente da aggiornare');
    return;
  }

  await prisma.user.updateMany({
    where: {
      emailVerifiedAt: null,
    },
    data: {
      emailVerifiedAt: new Date(),
    },
  });

  console.log(
    `✅ ${usersToUpdate.length} utenti aggiornati con emailVerifiedAt`
  );
}

/**
 * Creates the application's base configurations
 * Idempotent function: can be run multiple times without duplication
 * Does NOT include LDAP configurations (managed via UI/API)
 */
export async function seedAppConfigs(prisma: PrismaClient): Promise<void> {
  console.log('⚙️  Seeding configurazioni base...');

  // Generate NextAuth secret (JWT secret now derived via HKDF)
  const nextAuthSecret = randomBytes(32).toString('hex');

  const initialConfigs = [
    {
      key: 'auth.nextAuthSecret',
      value: nextAuthSecret,
      encrypt: true,
    },
    {
      key: 'app.name',
      value: 'Luke',
      encrypt: false,
    },
    {
      key: 'app.environment',
      value: process.env.NODE_ENV || 'development',
      encrypt: false,
    },
    {
      key: 'app.locale',
      value: 'it-IT',
      encrypt: false,
    },
    {
      key: 'app.defaultTimezone',
      value: 'Europe/Rome',
      encrypt: false,
    },
    {
      key: 'app.baseUrl',
      value: 'http://localhost:3000',
      encrypt: false,
    },
    {
      key: 'auth.strategy',
      value: 'local-first',
      encrypt: false,
    },
    {
      key: 'auth.requireEmailVerification',
      value: 'false',
      encrypt: false,
    },
    {
      key: 'security.password.minLength',
      value: String(DEFAULT_PASSWORD_POLICY.minLength),
      encrypt: false,
    },
    {
      key: 'security.password.requireUppercase',
      value: String(DEFAULT_PASSWORD_POLICY.requireUppercase),
      encrypt: false,
    },
    {
      key: 'security.password.requireLowercase',
      value: String(DEFAULT_PASSWORD_POLICY.requireLowercase),
      encrypt: false,
    },
    {
      key: 'security.password.requireDigit',
      value: String(DEFAULT_PASSWORD_POLICY.requireDigit),
      encrypt: false,
    },
    {
      key: 'security.password.requireSpecialChar',
      value: String(DEFAULT_PASSWORD_POLICY.requireSpecialChar),
      encrypt: false,
    },
    {
      key: 'security.tokenVersionCacheTTL',
      value: '60000', // 60 seconds default
      encrypt: false,
    },
    {
      key: 'security.session.maxAge',
      value: '28800', // 8h in seconds
      encrypt: false,
    },
    {
      key: 'security.session.updateAge',
      value: '14400', // 4h in seconds
      encrypt: false,
    },
    {
      key: 'security.cors.developmentOrigins',
      value: 'http://localhost:3000,http://localhost:5173',
      encrypt: false,
    },
    // Rate Limiting (single JSON object)
    {
      key: 'rateLimit',
      value: JSON.stringify({
        login: { max: 5, timeWindow: '1m', keyBy: 'ip' },
        passwordChange: { max: 3, timeWindow: '15m', keyBy: 'userId' },
        passwordReset: { max: 3, timeWindow: '15m', keyBy: 'ip' },
        configMutations: { max: 20, timeWindow: '1m', keyBy: 'userId' },
        userMutations: { max: 10, timeWindow: '1m', keyBy: 'userId' },
      }),
      encrypt: false,
    },
    // Timeouts for integrations
    {
      key: 'integrations.ldap.timeout',
      value: '10000', // ms
      encrypt: false,
    },
    {
      key: 'integrations.ldap.connectTimeout',
      value: '5000', // ms
      encrypt: false,
    },
    // Storage configuration
    {
      key: 'storage.type',
      value: 'local',
      encrypt: false,
    },
    {
      key: 'storage.local.basePath',
      value: join(homedir(), '.luke', 'storage'),
      encrypt: false,
    },
    {
      key: 'storage.local.maxFileSizeMB',
      value: '50',
      encrypt: false,
    },
    {
      key: 'storage.local.publicBaseUrl',
      value: 'http://localhost:3001',
      encrypt: false,
    },
    {
      key: 'storage.local.enableProxy',
      value: 'true',
      encrypt: false,
    },
    // Storage — S3-compatible defaults (used when storage.type = 's3'); dev stack runs SeaweedFS
    {
      key: 'storage.s3.endpoint',
      value: 'seaweedfs',
      encrypt: false,
    },
    {
      key: 'storage.s3.port',
      value: '8333',
      encrypt: false,
    },
    {
      key: 'storage.s3.useSSL',
      value: 'false',
      encrypt: false,
    },
    {
      key: 'storage.s3.accessKey',
      value: 's3admin',
      encrypt: true,
    },
    {
      key: 'storage.s3.secretKey',
      value: 's3adminpwd',
      encrypt: true,
    },
    {
      key: 'storage.s3.region',
      value: 'us-east-1',
      encrypt: false,
    },
    {
      key: 'storage.s3.presignedPutTtl',
      value: '3600',
      encrypt: false,
    },
    {
      key: 'storage.s3.presignedGetTtl',
      value: '3600',
      encrypt: false,
    },
    // Storage — asset derivative pipeline (thumb/card/export image variants)
    {
      key: 'storage.derivatives.enabled',
      value: 'true',
      encrypt: false,
    },
    // NAV (Microsoft Dynamics NAV / SQL Server)
    {
      key: 'integrations.nav.host',
      value: '192.168.1.32',
      encrypt: false,
    },
    {
      key: 'integrations.nav.port',
      value: '1433',
      encrypt: false,
    },
    {
      key: 'integrations.nav.database',
      value: 'NAV_DATABASE',
      encrypt: false,
    },
    {
      key: 'integrations.nav.user',
      value: 'nav_user',
      encrypt: false,
    },
    {
      key: 'integrations.nav.password',
      value: 'changeme',
      encrypt: true,
    },
    {
      key: 'integrations.nav.company',
      value: 'MYCOMPANY',
      encrypt: false,
    },
    {
      key: 'integrations.nav.syncIntervalMinutes',
      value: '30',
      encrypt: false,
    },
    {
      key: 'integrations.nav.readOnly',
      value: 'true',
      encrypt: false,
    },
    {
      key: 'integrations.nav.syncEnabled',
      value: 'false',
      encrypt: false,
    },
    // Retention sweep (audit log + notifications) — see retentionScheduler.ts
    {
      key: 'auditLog.retentionDays',
      value: '365',
      encrypt: false,
    },
    {
      key: 'auditLog.criticalRetentionDays',
      value: '3650', // 10 years, for actions in CRITICAL_AUDIT_ACTIONS
      encrypt: false,
    },
    {
      key: 'notification.retentionDays',
      value: '90',
      encrypt: false,
    },
    {
      key: 'notification.dedupRetentionDays',
      value: '30',
      encrypt: false,
    },
    // Feedback GitHub issue sync — see feedbackSyncScheduler.ts
    {
      key: 'integrations.github.feedbackSyncIntervalMs',
      value: '86400000', // 24h
      encrypt: false,
    },
  ];

  let configsCreated = 0;
  let configsSkipped = 0;

  for (const config of initialConfigs) {
    const existingConfig = await prisma.appConfig.findUnique({
      where: { key: config.key },
    });

    if (existingConfig) {
      console.log(`⚠️  Config '${config.key}' già esistente, skip`);
      configsSkipped++;
      continue;
    }

    const finalValue = config.encrypt
      ? encryptValue(config.value)
      : config.value;

    await prisma.appConfig.create({
      data: {
        key: config.key,
        value: finalValue,
        isEncrypted: config.encrypt,
      },
    });

    console.log(`✅ Config '${config.key}' creato`);
    configsCreated++;
  }

  console.log(
    `📊 Configurazioni: ${configsCreated} create, ${configsSkipped} esistenti`
  );
}

/**
 * Creates Brand, Season, and a minimal pricing parameter set for the context layer.
 * Idempotent function: can be run multiple times without duplication.
 */
export async function seedContextData(prisma: PrismaClient): Promise<void> {
  console.log('🏢 Seeding context data (Brand & Season)...');

  // Seed Brand
  const brand = await prisma.brand.upsert({
    where: { code: 'ACME' },
    update: { isActive: true },
    create: {
      code: 'ACME',
      name: 'Acme',
      isActive: true,
    },
  });

  console.log(`✅ Brand '${brand.code}' ready (ID: ${brand.id})`);

  // Seed Season
  const season = await prisma.season.upsert({
    where: { code: 'PE00' },
    update: { isActive: true },
    create: {
      code: 'PE00',
      name: 'Primavera/Estate 2000',
      isActive: true,
    },
  });

  console.log(`✅ Season '${season.code}' ready (ID: ${season.id})`);

  // Seed pricing parameter set.
  //
  // Not decoration: without at least one set, the Costi e Prezzi page shows
  // the empty state and the E2E smoke test skips the calculation (`test.skip`). The result
  // would be a green suite that never actually ran pricing — exactly the
  // green-that-proves-nothing the whole quality plan was born to fix.
  //
  // Plausible values for production in China with purchase in USD and selling
  // in EUR; they're meant to exercise the full chain, not to represent
  // real commercial conditions.
  const parameterSet = await prisma.pricingParameterSet.upsert({
    where: {
      brandId_seasonId_name: {
        brandId: brand.id,
        seasonId: season.id,
        name: 'Standard',
      },
    },
    update: {},
    create: {
      brandId: brand.id,
      seasonId: season.id,
      name: 'Standard',
      countryCode: 'CN',
      purchaseCurrency: 'USD',
      sellingCurrency: 'EUR',
      qualityControlPercent: 2,
      transportInsuranceCost: 3,
      duty: 8,
      exchangeRate: 1.08,
      italyAccessoryCosts: 2,
      tools: 1,
      retailMultiplier: 2.6,
      optimalMargin: 62,
      isDefault: true,
      orderIndex: 0,
    },
  });

  console.log(
    `✅ Pricing parameter set '${parameterSet.name}' ready (ID: ${parameterSet.id})`
  );
}

async function seedMilestoneTemplates(
  prisma: PrismaClient,
  functionIds: Record<string, string>,
): Promise<void> {
  console.log('📅 Seeding milestone templates...');

  const template = await prisma.milestoneTemplate.upsert({
    where: { name: 'Standard footwear season' },
    create: { name: 'Standard footwear season', description: 'Template base per una stagione calzature' },
    update: { description: 'Template base per una stagione calzature' },
  });

  const items: Array<{
    title: string;
    offsetDays: number;
    durationDays: number;
    visibleFunctionSlugs: string[];
  }> = [
    {
      title: 'Kickoff',
      offsetDays: 0,
      durationDays: 1,
      visibleFunctionSlugs: ['sales', 'product', 'sourcing'],
    },
    {
      title: 'Briefing materials',
      offsetDays: 14,
      durationDays: 1,
      visibleFunctionSlugs: ['product', 'sourcing'],
    },
    {
      title: 'First samples',
      offsetDays: 60,
      durationDays: 1,
      visibleFunctionSlugs: ['product', 'sourcing'],
    },
    {
      title: 'Linesheet review',
      offsetDays: 90,
      durationDays: 1,
      visibleFunctionSlugs: ['sales', 'product'],
    },
    {
      title: 'Sales pre-opening',
      offsetDays: 120,
      durationDays: 1,
      visibleFunctionSlugs: ['sales', 'product'],
    },
    {
      title: 'PO cutoff',
      offsetDays: 180,
      durationDays: 1,
      visibleFunctionSlugs: ['product', 'sourcing'],
    },
  ];

  for (const item of items) {
    let templateItem = await prisma.milestoneTemplateItem.findFirst({
      where: { templateId: template.id, title: item.title },
    });

    if (!templateItem) {
      templateItem = await prisma.milestoneTemplateItem.create({
        data: {
          templateId:      template.id,
          title:           item.title,
          offsetDays:      item.offsetDays,
          durationDays:    item.durationDays,
        },
      });
    }

    // Upsert visibility records for each visible function
    for (const slug of item.visibleFunctionSlugs) {
      const fId = functionIds[slug];
      if (!fId) continue;
      await prisma.milestoneTemplateItemVisibility.upsert({
        where:  { templateItemId_functionId: { templateItemId: templateItem.id, functionId: fId } },
        update: {},
        create: { templateItemId: templateItem.id, functionId: fId },
      });
    }
  }

  console.log(`   Template "${template.name}" seeded (${items.length} items)`);
}

async function main() {
  console.log('🌱 Avvio seed database...');

  try {
    // Seeding admin user
    await seedAdminUser(prisma);

    // Update existing users with emailVerifiedAt
    await updateExistingUsersVerification(prisma);

    // Seeding configurations
    await seedAppConfigs(prisma);

    // Seeding context data
    await seedContextData(prisma);

    // Seeding company structure (functions, teams, profile)
    const functionIds = await seedCompanyStructure(prisma);

    // Seeding collection catalog (revisionType items)
    await seedCollectionCatalog(prisma);

    // Seeding holiday countries
    await seedHolidayCountries(prisma);

    // Seeding milestone templates
    await seedMilestoneTemplates(prisma, functionIds);

    // Final log
    console.log('\n🎉 Seed completato con successo!');
    console.log('\n🔑 Credenziali admin:');
    console.log('   Email: admin@luke.local');
    console.log('   Username: admin');
    console.log('   Password: changeme');
    console.log('\n🔐 Segreti generati:');
    console.log('   JWT Secret: Derivato via HKDF dalla master key');
    console.log('   NextAuth Secret: Generato e cifrato in AppConfig');
    console.log('\n⚠️  IMPORTANTE: Cambia la password admin al primo login!');
    console.log('\n🚀 Prossimi passi:');
    console.log('   1. Avvia il server: pnpm --filter @luke/api dev');
    console.log('   2. Testa health check: curl http://localhost:3001/healthz');
    console.log(
      '   3. Apri Prisma Studio: pnpm --filter @luke/api prisma:studio'
    );
  } catch (error) {
    console.error('❌ Errore durante seed:', error);
    throw error;
  }
}

/**
 * Run seed and close the connection — only when this file is the entrypoint.
 *
 * Without the guard, a simple `import { seedAdminUser } from '../prisma/seed'`
 * would kick off the entire seed as a side effect of the import, and its
 * `process.exit(1)` on error would take down the calling process (in tests
 * it took the runner down with it).
 */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return require.resolve(entry) === __filename;
}

if (isEntrypoint()) {
  main()
    .catch(e => {
      console.error('💥 Seed fallito:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      console.log('🔌 Connessione database chiusa');
    });
}
