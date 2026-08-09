import { defineConfig, devices } from '@playwright/test';

import { ADMIN_STORAGE_STATE } from './tests/support/smoke';

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/smoke',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /**
   * Sempre seriale, non solo in CI, per due motivi indipendenti.
   *
   * 1. La pulizia in `brand-crud.smoke.spec.ts` cancella *tutti* i brand con
   *    prefisso `SMOKE-`: in parallelo un worker cancellerebbe il brand che un
   *    altro sta ancora usando.
   * 2. Margine sul rate limit dell'API. In sviluppo localhost è in allowList,
   *    ma puntando la suite a un ambiente non-dev valgono i 100 req/min per IP —
   *    e con più worker li si supera.
   *
   * Uno smoke pre-release può permettersi il minuto in più. Per lo stesso motivo
   * niente `fullyParallel`: sarebbe inerte con un solo worker.
   */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'playwright-report/results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    ...devices['Desktop Chrome'],

    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video on failure */
    video: 'retain-on-failure',
  },

  projects: [
    /* Autentica una volta e deposita lo storageState per il progetto `smoke`. */
    { name: 'smoke-setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'smoke',
      testMatch: /\.smoke\.spec\.ts$/,
      dependencies: ['smoke-setup'],
      use: { storageState: ADMIN_STORAGE_STATE },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000, // 2 minutes
      },

  /* Pre-flight su API e frontend. Nessun globalTeardown: la suite non lascia
     stato globale da smontare — la pulizia dei brand di test è per-spec. */
  globalSetup: require.resolve('./tests/global-setup.ts'),

  /* Test timeout */
  timeout: 30 * 1000, // 30 seconds

  /* Expect timeout */
  expect: {
    timeout: 10 * 1000, // 10 seconds
  },
});
