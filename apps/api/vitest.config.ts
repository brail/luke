import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

/**
 * Progetto unit: gira sempre, senza infrastruttura.
 * Le suite che richiedono PostgreSQL vivono in `vitest.integration.config.ts`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // I .js compilati in dist/ sono duplicati dei sorgenti: senza exclude esplicito
    // vitest li raccoglie come suite fantasma a 0 test.
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    // La convenzione è la membership: un file `*.integration.spec.ts` richiede
    // PostgreSQL e vive nell'altro progetto. Niente elenco a mano da tenere
    // allineato — una rinomina non può farne uscire uno di soppiatto.
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
