/**
 * Helper semplificato per i test che usa un database in memoria
 * Evita di interferire con il database di sviluppo
 */

import { PrismaClient } from '@prisma/client';

// Database in memoria per i test
const TEST_DATABASE_URL = 'file::memory:?cache=shared';

/**
 * Crea un client Prisma per i test usando un database in memoria
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
 * Setup del database di test in memoria
 * Non richiede migrazioni, il database viene creato automaticamente
 */
export async function setupTestDb(): Promise<PrismaClient> {
  const prisma = createTestPrismaClient();

  try {
    // Il database in memoria viene creato automaticamente
    // Non serve applicare migrazioni
    return prisma;
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

/**
 * Cleanup del database di test
 * Disconnette il client (il database in memoria viene distrutto automaticamente)
 */
export async function teardownTestDb(
  prisma: PrismaClient | undefined
): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}
