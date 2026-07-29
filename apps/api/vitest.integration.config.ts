import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

/**
 * Progetto integration: richiede un PostgreSQL dedicato in `TEST_DATABASE_URL`.
 * Locale: `pnpm test:db:up` poi `pnpm test:integration`.
 * CI: service container nel job `test`.
 *
 * I file girano in sequenza (`fileParallelism: false`) perché condividono
 * lo stesso database: in parallelo si cancellerebbero i dati a vicenda.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    setupFiles: ['./test/setup.ts'],
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
