/**
 * Script di seed per Luke API
 * Crea utente admin e configurazioni iniziali
 */

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { encryptValue } from '../src/lib/configManager.js';

/**
 * Inizializza Prisma Client
 */
const prisma = new PrismaClient();

/**
 * Funzione principale di seed
 */
async function main() {
  console.log('🌱 Avvio seed database...');

  try {
    // Verifica se l'utente admin esiste già
    const existingAdmin = await prisma.user.findFirst({
      where: {
        OR: [{ email: 'admin@luke.local' }, { username: 'admin' }],
      },
    });

    if (existingAdmin) {
      console.log('⚠️  Utente admin già esistente, skip creazione');
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
      }
    } else {
      // Hash della password admin
      const adminPassword = 'changeme';
      const passwordHash = await argon2.hash(adminPassword, {
        type: argon2.argon2id,
        timeCost: 3,
        memoryCost: 65536,
        parallelism: 1,
      });

      console.log('👤 Creazione utente admin...');

      // Crea utente admin con identità locale in una transazione
      const adminUser = await prisma.$transaction(async tx => {
        // Crea utente
        const user = await tx.user.create({
          data: {
            email: 'admin@luke.local',
            username: 'admin',
            role: 'admin',
            isActive: true,
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

    // Configurazioni iniziali
    console.log('⚙️  Creazione configurazioni iniziali...');

    // Genera NextAuth secret (JWT secret ora derivato via HKDF)
    const nextAuthSecret = randomBytes(32).toString('hex');

    const initialConfigs = [
      {
        key: 'auth.nextAuthSecret',
        value: nextAuthSecret,
        encrypt: true,
      },
      {
        key: 'auth.providers.local.enabled',
        value: 'true',
        encrypt: true,
      },
      {
        key: 'auth.providers.ldap.enabled',
        value: 'false',
        encrypt: true,
      },
      {
        key: 'auth.providers.oidc.enabled',
        value: 'false',
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
        key: 'logging.level',
        value: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
        encrypt: false,
      },
      // Configurazioni LDAP
      {
        key: 'auth.ldap.enabled',
        value: 'false',
        encrypt: false,
      },
      {
        key: 'auth.ldap.url',
        value: 'ldap://localhost:389',
        encrypt: true,
      },
      {
        key: 'auth.ldap.bindDN',
        value: '',
        encrypt: true,
      },
      {
        key: 'auth.ldap.bindPassword',
        value: '',
        encrypt: true,
      },
      {
        key: 'auth.ldap.searchBase',
        value: 'dc=example,dc=com',
        encrypt: true,
      },
      {
        key: 'auth.ldap.searchFilter',
        value: '(sAMAccountName=${username})',
        encrypt: true,
      },
      {
        key: 'auth.ldap.groupSearchBase',
        value: 'ou=groups,dc=example,dc=com',
        encrypt: true,
      },
      {
        key: 'auth.ldap.groupSearchFilter',
        value: '(member=${userDN})',
        encrypt: true,
      },
      {
        key: 'auth.ldap.roleMapping',
        value: '{}',
        encrypt: true,
      },
      {
        key: 'auth.strategy',
        value: 'local-first',
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

    // Log finale
    console.log('\n🎉 Seed completato con successo!');
    console.log('📊 Riepilogo:');
    console.log(`   - Configurazioni create: ${configsCreated}`);
    console.log(`   - Configurazioni esistenti: ${configsSkipped}`);
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
