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

import { afterAll, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long';

/**
 * Store in memoria dei moduli di produzione, azzerati prima di ogni test.
 *
 * Sono singleton a livello di modulo: sopravvivono ai test e, dentro un file,
 * anche fra una spec e l'altra. La pulizia era ri-derivata in cinque punti
 * (`brand`, `brandLogo.service` ×2, `pricing`, `ratelimit.integration`,
 * `idempotency.integration`), ognuno col proprio commento che rispiegava perché:
 * una spec nuova che tocca una mutation rate-limited falliva in modo oscuro e
 * doveva riscoprire la convenzione.
 *
 * Qui e non in un `beforeEach(resetTestData)` globale: troncare il database
 * prima di ogni test cancellerebbe le fixture che otto spec costruiscono in
 * `beforeAll`. Azzerare una mappa in memoria non tocca nulla di persistito.
 *
 * Resta legittimo chiamare `.clear()` **dentro** un test per simulare la
 * scadenza della finestra: lì è un'asserzione, non pulizia.
 */
beforeEach(async () => {
  const [{ rateLimitStore }, { idempotencyStore }] = await Promise.all([
    import('../src/lib/ratelimit'),
    import('../src/lib/idempotency'),
  ]);
  rateLimitStore.clear();
  idempotencyStore.clear();
});

// Unico punto in cui il client Prisma di test viene chiuso: una volta per file.
// Disconnettere per-test è ciò che esauriva il pool, ed è il motivo per cui le
// spec non hanno alcun hook di teardown del database.
afterAll(async () => {
  const { disconnectTestDb } = await import('./helpers/database');
  await disconnectTestDb();
});
