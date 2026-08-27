import { defineConfig } from 'vitest/config';

/**
 * Tier unit di `apps/web`, deliberatamente ristretto ai moduli **puri** sotto `src/lib/`:
 * formattazione, calcoli di stile, mapping di errori. Girano in `node`, senza jsdom.
 *
 * Componenti e hook restano coperti dagli smoke Playwright (`tests/smoke/`): testarli qui
 * richiederebbe jsdom più `@testing-library/react`, cioè uno stack diverso e una decisione a sé —
 * mentre la logica pura oggi non è verificabile da nessuna parte, ed è quella che si rompe in
 * silenzio.
 *
 * Il task `test` in `turbo.json` non filtra i package, quindi `pnpm test` e la CI raccolgono
 * questa suite senza altre modifiche.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/lib/**/*.test.ts'],
  },
});
