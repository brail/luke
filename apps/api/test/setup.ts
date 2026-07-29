/**
 * Setup globale per i test Vitest.
 *
 * `DATABASE_URL` viene allineato a `TEST_DATABASE_URL` quando presente: in Prisma 7
 * il costruttore non accetta più un URL, quindi ogni `new PrismaClient()` senza
 * adapter esplicito legge da qui. Senza questo allineamento un test di integrazione
 * finirebbe sul database di sviluppo.
 *
 * Nessun default hardcoded: se `TEST_DATABASE_URL` manca, le suite di integrazione
 * devono fallire in modo esplicito, non ripiegare su un database arbitrario.
 */

import { afterAll } from 'vitest';

process.env.NODE_ENV = 'test';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long';

// Unico punto in cui il client Prisma di test viene chiuso: una volta per file.
// Le spec chiamano `teardownTestDb()` nei loro afterEach, ma quella è ormai un
// no-op — disconnettere per-test è ciò che esauriva il pool.
afterAll(async () => {
  const { disconnectTestDb } = await import('./helpers/database');
  await disconnectTestDb();
});
