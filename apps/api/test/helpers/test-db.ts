/**
 * Helper semplificato per i test che usa un database separato
 * Evita di interferire con il database di sviluppo
 */

import { PrismaClient } from '@prisma/client';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

// Database separato per i test
const TEST_DB_PATH = join(__dirname, '../test.db');
const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

/**
 * Crea un client Prisma per i test usando un database separato
 */
export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: TEST_DATABASE_URL,
      },
    },
  });
}

/**
 * Setup del database di test
 * Crea le tabelle e applica le migrazioni
 */
export async function setupTestDb(): Promise<PrismaClient> {
  const prisma = createTestPrismaClient();

  try {
    // Rimuovi il database di test se esiste
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    // Applica le migrazioni al database di test
    const { execSync } = await import('child_process');
    execSync('pnpm prisma migrate deploy', {
      cwd: join(__dirname, '../../'),
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
      },
    });

    return prisma;
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

/**
 * Cleanup del database di test
 * Disconnette il client e rimuove il file del database
 */
export async function teardownTestDb(
  prisma: PrismaClient | undefined
): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }

  // Rimuovi il database di test
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
}
