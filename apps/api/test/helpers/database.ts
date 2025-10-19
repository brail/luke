/**
 * Helper per gestire il database di test
 * Assicura che i test usino un database separato da quello di sviluppo
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = join(__dirname, '../test.db');

/**
 * Crea un nuovo client Prisma per i test
 * Usa sempre il database di test, non quello di sviluppo
 */
export function createTestPrismaClient(): PrismaClient {
  // Assicurati che il DATABASE_URL punti al database di test
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;

  return new PrismaClient({
    datasources: {
      db: {
        url: `file:${TEST_DB_PATH}`,
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

    // Genera il client Prisma e applica lo schema al database di test
    execSync('pnpm prisma generate', {
      cwd: join(__dirname, '../../'),
      stdio: 'pipe',
    });

    execSync('pnpm prisma db push', {
      cwd: join(__dirname, '../../'),
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: `file:${TEST_DB_PATH}`,
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
