/**
 * Script di seed per Luke API
 * Crea utente admin e configurazioni iniziali
 *
 * Funzioni esportabili per uso in bootstrap e test:
 * - seedAdminUser(prisma): Crea/aggiorna utente admin
 * - seedAppConfigs(prisma): Crea configurazioni base (no LDAP)
 */

import { randomBytes } from 'crypto';

import { PrismaClient } from '@prisma/client';

import { encryptValue } from '../src/lib/configManager';
import { hashPassword } from '../src/lib/password';

/**
 * Inizializza Prisma Client
 */
const prisma = new PrismaClient();

/**
 * Crea/aggiorna l'utente admin con identità locale
 * Funzione idempotente: può essere eseguita multiple volte senza duplicazioni
 */
export async function seedAdminUser(prisma: PrismaClient): Promise<void> {
  console.log('👤 Seeding utente admin...');

  // Verifica se l'utente admin esiste già
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

    // Attiva l'utente admin se non è attivo
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
    // Hash della password admin usando la funzione centralizzata
    const adminPassword = 'changeme';
    const passwordHash = await hashPassword(adminPassword);

    console.log('🔧 Creazione utente admin...');

    // Crea utente admin con identità locale in una transazione
    const adminUser = await prisma.$transaction(async tx => {
      // Crea utente
      const user = await tx.user.create({
        data: {
          email: 'admin@luke.local',
          username: 'admin',
          role: 'admin',
          isActive: true,
          emailVerifiedAt: new Date(), // Admin pre-verificato
        },
      });

      // Crea identità locale
      const identity = await tx.identity.create({
        data: {
          userId: user.id,
          provider: 'LOCAL',
          providerId: 'admin',
        },
      });

      // Crea credenziale locale
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
 * Aggiorna utenti esistenti con emailVerifiedAt
 * Imposta tutti gli utenti esistenti (senza emailVerifiedAt) come verificati
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
 * Crea configurazioni base dell'applicazione
 * Funzione idempotente: può essere eseguita multiple volte senza duplicazioni
 * NON include configurazioni LDAP (gestite via UI/API)
 */
export async function seedAppConfigs(prisma: PrismaClient): Promise<void> {
  console.log('⚙️  Seeding configurazioni base...');

  // Genera NextAuth secret (JWT secret ora derivato via HKDF)
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
      key: 'app.version',
      value: '0.1.0',
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
      value: '12',
      encrypt: false,
    },
    {
      key: 'security.password.requireUppercase',
      value: 'true',
      encrypt: false,
    },
    {
      key: 'security.password.requireLowercase',
      value: 'true',
      encrypt: false,
    },
    {
      key: 'security.password.requireDigit',
      value: 'true',
      encrypt: false,
    },
    {
      key: 'security.password.requireSpecialChar',
      value: 'true',
      encrypt: false,
    },
    {
      key: 'security.tokenVersionCacheTTL',
      value: '60000', // 60 secondi default
      encrypt: false,
    },
    {
      key: 'security.session.maxAge',
      value: '28800', // 8h in secondi
      encrypt: false,
    },
    {
      key: 'security.session.updateAge',
      value: '14400', // 4h in secondi
      encrypt: false,
    },
    {
      key: 'security.cors.developmentOrigins',
      value: 'http://localhost:3000,http://localhost:5173',
      encrypt: false,
    },
    // Rate Limiting (JSON object unico)
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
    // Timeouts per integrazioni
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
    // Storage configurazione
    {
      key: 'storage.type',
      value: 'local',
      encrypt: false,
    },
    {
      key: 'storage.local.basePath',
      value: '/tmp/luke-storage', // Development default
      encrypt: false,
    },
    {
      key: 'storage.local.maxFileSizeMB',
      value: '50',
      encrypt: false,
    },
    {
      key: 'storage.local.buckets',
      value: '["uploads","exports","assets","brand-logos"]',
      encrypt: false,
    },
    {
      key: 'storage.local.publicBaseUrl',
      value: 'http://localhost:3001/uploads',
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
 * Crea Brand e Season minimi per il context layer
 * Funzione idempotente: può essere eseguita multiple volte senza duplicazioni
 */
export async function seedContextData(prisma: PrismaClient): Promise<void> {
  console.log('🏢 Seeding context data (Brand & Season)...');

  // Seed Brand
  const brand = await prisma.brand.upsert({
    where: { code: 'ACME' },
    update: { isActive: true },
    create: {
      code: 'ACME',
      name: 'ACME',
      isActive: true,
      logoUrl: null,
    },
  });

  console.log(`✅ Brand '${brand.code}' ready (ID: ${brand.id})`);

  // Seed Season
  const season = await prisma.season.upsert({
    where: { code_year: { code: 'SS', year: 2026 } },
    update: { isActive: true },
    create: {
      code: 'SS',
      year: 2026,
      name: 'Spring/Summer 2026',
      isActive: true,
    },
  });

  console.log(
    `✅ Season '${season.code}${season.year}' ready (ID: ${season.id})`
  );
}

/**
 * Funzione principale di seed
 */
async function main() {
  console.log('🌱 Avvio seed database...');

  try {
    // Seeding utente admin
    await seedAdminUser(prisma);

    // Aggiorna utenti esistenti con emailVerifiedAt
    await updateExistingUsersVerification(prisma);

    // Seeding configurazioni
    await seedAppConfigs(prisma);

    // Seeding context data
    await seedContextData(prisma);

    // Log finale
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
 * Esegui seed e chiudi connessione
 */
main()
  .catch(e => {
    console.error('💥 Seed fallito:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('🔌 Connessione database chiusa');
  });
