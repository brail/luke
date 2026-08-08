import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

/**
 * Integration project: requires a dedicated PostgreSQL in `TEST_DATABASE_URL`.
 * Local: `pnpm test:db:up` then `pnpm test:integration`.
 * CI: service container in the `test` job.
 *
 * Files run in sequence (`fileParallelism: false`) because they share the
 * same database: running in parallel would have them wiping each other's data.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    setupFiles: ['./test/setup.ts', './test/setup.procedureUsage.ts'],
    // tRPC procedure coverage gate: lives here and not as a CI step because
    // a step can be forgotten when adding one. See
    // `test/globalSetup.procedureCoverage.ts`.
    globalSetup: ['./test/globalSetup.procedureCoverage.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    teardownTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
