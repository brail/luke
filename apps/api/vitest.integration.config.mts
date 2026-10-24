import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

/**
 * Integration project: requires a dedicated PostgreSQL in `TEST_DATABASE_URL`.
 * Local: `pnpm test:integration:local` from the repository root.
 * CI: service container in the `integration` job.
 *
 * Files run in parallel, one database per worker: `test/globalSetup.integration.ts`
 * clones them from the migrated `TEST_DATABASE_URL` database, and
 * `test/setup.workerDatabase.ts` points each worker at its own. Four workers: the
 * CI runners have four vCPUs, more brought nothing locally (the time goes into each
 * file's import), and each worker's Prisma client pools up to ten connections.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    setupFiles: [
      './test/setup.workerDatabase.ts',
      './test/setup.ts',
      './test/setup.procedureUsage.ts',
    ],
    // The worker databases and the tRPC procedure coverage gate, composed in
    // one file. The gate lives here and not as a CI step because a step can be
    // forgotten when adding one. See `test/globalSetup.procedureCoverage.ts`.
    globalSetup: ['./test/globalSetup.integration.ts'],
    maxWorkers: 4,
    testTimeout: 30000,
    hookTimeout: 60000,
    teardownTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});
