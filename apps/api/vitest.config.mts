import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

/**
 * Unit project: always runs, no infrastructure.
 * Suites that require PostgreSQL live in `vitest.integration.config.ts`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The compiled .js files in dist/ are duplicates of the sources: without an
    // explicit exclude vitest picks them up as phantom suites with 0 tests.
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    // The convention is membership: a `*.integration.spec.ts` file requires
    // PostgreSQL and lives in the other project. No manual list to keep
    // aligned — a rename can't sneak one out.
    exclude: ['**/node_modules/**', 'dist/**', '**/*.integration.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
