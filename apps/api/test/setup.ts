/**
 * Global setup for Vitest tests.
 *
 * `DATABASE_URL` is aligned to `TEST_DATABASE_URL` when present: in Prisma 7
 * the constructor no longer accepts a URL, so every `new PrismaClient()` without
 * an explicit adapter reads from here. Without this alignment, an integration
 * test would end up on the development database.
 *
 * No hardcoded default: if `TEST_DATABASE_URL` is missing, integration suites
 * must fail explicitly, not fall back to an arbitrary database.
 */

import { afterAll, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long';

/**
 * In-memory stores of production modules, zeroed before every test.
 *
 * They're module-level singletons: they survive across tests and, within a
 * file, across specs too. The cleanup used to be re-derived in five places
 * (`brand`, `brandLogo.service` ×2, `pricing`, `ratelimit.integration`,
 * `idempotency.integration`), each with its own comment re-explaining why:
 * a new spec touching a rate-limited mutation would fail obscurely and would
 * have to rediscover the convention.
 *
 * Here and not in a global `beforeEach(resetTestData)`: truncating the
 * database before every test would wipe out the fixtures that eight specs
 * build in `beforeAll`. Zeroing an in-memory map doesn't touch anything
 * persisted.
 *
 * It's still legitimate to call `.clear()` **inside** a test to simulate the
 * window expiring: there it's an assertion, not cleanup.
 */
beforeEach(async () => {
  const [{ rateLimitStore }, { idempotencyStore }] = await Promise.all([
    import('../src/lib/ratelimit'),
    import('../src/lib/idempotency'),
  ]);
  rateLimitStore.clear();
  idempotencyStore.clear();
});

// The single point where the test Prisma client gets closed: once per file.
// Disconnecting per-test is what exhausted the pool, and it's the reason the
// specs have no database teardown hook.
afterAll(async () => {
  const { disconnectTestDb } = await import('./helpers/database');
  await disconnectTestDb();
});
