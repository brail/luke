import { defineConfig } from 'vitest/config';

/**
 * Unit tier of `apps/web`, deliberately restricted to **pure** modules under `src/lib/`:
 * formatting, style calculations, error mapping. They run in `node`, without jsdom.
 *
 * Components and hooks are tested elsewhere: in a real Chromium by the browser tier
 * (`vitest.browser.config.mts`, `*.browser.test.tsx`), and end to end by the Playwright smoke
 * suite (`tests/smoke/`). Keeping this tier Node-only is what lets `pnpm test` and
 * `.husky/pre-push` run it without provisioning a browser.
 *
 * The `test` task in `turbo.json` does not filter packages, so `pnpm test` and CI pick up this
 * suite with no other changes.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/lib/**/*.test.ts'],
  },
});
