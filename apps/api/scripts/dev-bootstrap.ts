/**
 * Script di bootstrap per database di sviluppo Luke API
 *
 * Responsabilità:
 * 1. Verifica master key (fail-fast se mancante)
 * 2. Reset completo database (drop + migrations)
 * 3. Seed idempotente (admin user + configurazioni base)
 * 4. Sanity checks post-seed
 * 5. Exit code 0 se successo, 1 se fallimento
 *
 * Prerequisiti: docker-compose -f docker-compose.dev.yml up -d
 */

import { execSync } from 'child_process';
import { join } from 'path';

import { PrismaClient } from '@prisma/client';

import { getMasterKey } from '@luke/core/server';

/**
 * Funzione principale di bootstrap
 */
async function bootstrap() {
  console.log('🚀 Bootstrap sviluppo Luke API...\n');

  // 1. Verifica master key
  try {
    getMasterKey();
    console.log('✅ Master key valida\n');
  } catch (error) {
    console.error('❌ Master key non accessibile:', error);
    process.exit(1);
  }

  // 2. Reset database
  console.log('🗑️  Reset database...');
  try {
    execSync('pnpm prisma migrate reset --force --skip-seed', {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
    });
  } catch (error) {
    console.error(
      '\n❌ Reset database fallito. Questo potrebbe essere dovuto a:'
    );
    console.error('   1. Prisma AI safety check (comando pericoloso rilevato)');
    console.error('   2. Database in uso da altri processi');
    console.error('\n🔧 Soluzioni:');
    console.error(
      '   - Esegui manualmente: cd apps/api && pnpm prisma migrate reset --force --skip-seed'
    );
    console.error('   - Oppure ferma tutti i processi e riprova');
    console.error(
      '   - Per bypassare AI check: PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" pnpm prisma migrate reset --force --skip-seed'
    );
    throw error;
  }

  // 4. Seed database
  console.log('\n🌱 Esecuzione seed...');
  const prisma = new PrismaClient();

  try {
    // Importa e esegui funzioni di seed
    const { seedAdminUser, seedAppConfigs } = await import('../prisma/seed');

    await seedAdminUser(prisma);
    await seedAppConfigs(prisma);

    // 5. Sanity checks
    console.log('\n🔍 Sanity checks...');
    const [userCount, configCount, adminUser, criticalConfigs] =
      await Promise.all([
        prisma.user.count(),
        prisma.appConfig.count(),
        prisma.user.findFirst({ where: { username: 'admin' } }),
        prisma.appConfig.findMany({
          where: {
            key: {
              in: [
                'auth.nextAuthSecret',
                'app.name',
                'security.password.minLength',
              ],
            },
          },
        }),
      ]);

    console.log(`   - User count: ${userCount}`);
    console.log(`   - Config count: ${configCount}`);
    console.log(`   - Admin user: ${adminUser ? '✅' : '❌'}`);
    console.log(`   - Critical configs: ${criticalConfigs.length}/3`);

    if (!adminUser || criticalConfigs.length < 3) {
      throw new Error('Sanity checks falliti');
    }

    console.log('\n🎉 Bootstrap completato con successo!\n');
    console.log('🔑 Credenziali admin:');
    console.log('   Email: admin@luke.local');
    console.log('   Username: admin');
    console.log('   Password: changeme');
    console.log('\n⚠️  IMPORTANTE: Cambia la password admin al primo login!');
  } catch (error) {
    console.error('\n❌ Bootstrap fallito:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Esegui bootstrap
bootstrap();
