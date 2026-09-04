/**
 * Helper for the test database (PostgreSQL).
 *
 * Integration tests run on a dedicated database, never on the dev one or the
 * production one. The URL comes from `TEST_DATABASE_URL`; if it's missing the
 * suites **fail**, they don't skip: a job that reports green with zero tests
 * run is worse than a red job.
 *
 * ## Lifecycle
 *
 * A single Prisma client per test file, created lazily and closed exactly
 * once at the end of the file (vitest isolates modules per file, so the
 * state below is per-file). Isolation between tests happens via **data
 * truncation**, not by reconnecting the client.
 *
 * The previous version ran `migrate deploy` on every `beforeEach` and called
 * `$disconnect()` on every `afterEach` on a module-level shared client: the
 * pool got closed while other references were still alive, cascading
 * `Cannot use a pool after calling end on the pool` across the following
 * suites. The problem wasn't the individual specs, it was this file.
 */

import { execSync } from 'child_process';

import { createPrismaClient, type PrismaClient, PRISMA_PACKAGE_ROOT } from '@luke/db';

/** Required marker in the database name: guards against pointing at dev or production. */
const REQUIRED_DB_NAME_MARKER = 'test';

/** Client shared by the current test file. */
let sharedClient: PrismaClient | null = null;

/** List of tables to truncate, resolved once and reused. */
let truncatableTables: string[] | null = null;

/**
 * Schema already verified for the current test file.
 *
 * Set only after the schema actually exists, never ahead of time: the answer
 * can't change within a file, and the `information_schema` probe is a
 * round-trip on every `setupTestDb`/`createContextForRole`.
 */
let schemaEnsured = false;

/**
 * Returns the test database URL, or `null` if not configured.
 *
 * Never falls back to `DATABASE_URL`: destructive operations run here, and a
 * silent fallback to the dev DB would wipe it.
 */
export function getTestDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;

  // The database name must contain "test": a guard against a URL pasted in
  // by mistake from a real environment.
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.includes(REQUIRED_DB_NAME_MARKER)) {
    throw new Error(
      `TEST_DATABASE_URL punta al database "${dbName}", che non contiene "${REQUIRED_DB_NAME_MARKER}". ` +
        'Rifiuto di eseguire operazioni distruttive su un database che potrebbe non essere di test.'
    );
  }

  return url;
}

/** Test URL, or an exception with instructions if missing. */
function requireTestDatabaseUrl(): string {
  const url = getTestDatabaseUrl();
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL non configurato. Avvia il database di test con `pnpm test:db:up`.'
    );
  }
  return url;
}

/**
 * Creates a new Prisma client bound to the test database.
 *
 * Prefer `getTestPrismaClient()`: each client opens its own pool, and
 * multiple pools on the same test file exhaust each other.
 */
export function createTestPrismaClient(): PrismaClient {
  return createPrismaClient({ connectionString: requireTestDatabaseUrl() });
}

/** Client shared by the current test file, created on first access. */
export function getTestPrismaClient(): PrismaClient {
  sharedClient ??= createTestPrismaClient();
  return sharedClient;
}

/**
 * Applies migrations if the schema isn't present yet.
 *
 * `migrate deploy` is idempotent but costs ~1s of external process: running
 * it on every test made the integration suites unusable. Here the cost is
 * paid only when the database is truly empty.
 */
export async function ensureTestSchema(
  prisma: PrismaClient = getTestPrismaClient()
): Promise<void> {
  if (schemaEnsured) return;

  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) AS present
  `;

  if (!present) {
    // The URL comes from prisma.config.ts, which reads DATABASE_URL from the env.
    // `PRISMA_PACKAGE_ROOT` is where that config and the migrations live — the
    // only cwd the CLI resolves them from, and one this file cannot drift from
    // by moving directory.
    execSync('pnpm exec prisma migrate deploy', {
      cwd: PRISMA_PACKAGE_ROOT,
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: requireTestDatabaseUrl() },
    });
  }

  schemaEnsured = true;
}

/**
 * Empties all application tables, leaving the schema intact.
 *
 * This is the isolation mechanism between tests: much faster than recreating
 * the schema, and above all it doesn't touch the connection.
 *
 * Ensures the schema before reading the table list, and **never memoizes an
 * empty list**. The previous version did both the wrong way around: on a
 * database that still had no schema, the query returned zero rows, which
 * got memoized, and from then on the function was a silent no-op for the
 * rest of the file — tests kept running with no isolation at all and
 * collided on hardcoded data. It wasn't visible on an already-populated
 * database: it only surfaced in CI, on the first truly empty database.
 */
export async function resetTestData(
  prisma: PrismaClient = getTestPrismaClient()
): Promise<void> {
  if (!truncatableTables?.length) {
    await ensureTestSchema(prisma);

    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    truncatableTables = rows.map(r => r.tablename);
  }

  if (truncatableTables.length === 0) {
    throw new Error(
      'Nessuna tabella da troncare dopo `ensureTestSchema`: le migration non ' +
        'hanno prodotto alcuna tabella. Proseguire significherebbe eseguire i ' +
        'test senza isolamento.'
    );
  }

  // `$executeRawUnsafe` is unavoidable: table names are identifiers, not
  // parameters, and can't be expressed with Prisma.sql. The strings come
  // from pg_tables of the test database, not from user input.
  const list = truncatableTables.map(t => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`
  );
}

/**
 * Prepares the database for a test and returns the shared client.
 *
 * Idempotent and safe to call in `beforeEach`: applies the schema only if
 * it's missing, then truncates the data. Doesn't open or close connections.
 */
export async function setupTestDb(): Promise<PrismaClient> {
  requireTestDatabaseUrl();

  const prisma = getTestPrismaClient();
  await ensureTestSchema(prisma);
  await resetTestData(prisma);

  return prisma;
}

/** Closes the shared client. Called exactly once at the end of the test file. */
export async function disconnectTestDb(): Promise<void> {
  if (!sharedClient) return;

  await sharedClient.$disconnect();
  sharedClient = null;
  truncatableTables = null;
  schemaEnsured = false;
}
