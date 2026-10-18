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
   * Always serial, not only in CI, for two independent reasons.
   *
   * 1. The cleanup in `brand-crud.smoke.spec.ts` deletes *every* brand with the
   *    `SMOKE-` prefix: in parallel, one worker would delete the brand another
   *    one is still using.
   * 2. Headroom on the API rate limit. In development localhost is on the
   *    allowList, but with the suite pointed at a non-dev environment the
   *    100 req/min per IP apply — and more workers exceed them.
   *
   * A pre-release smoke run can afford the extra minute. For the same reason,
   * no `fullyParallel`: it would be inert with a single worker.
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
    /* Authenticates once and stores the storageState for the `smoke` project. */
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

  /* Pre-flight on the API and the frontend. No globalTeardown: the suite leaves no
     global state to tear down — test-brand cleanup is per spec. */
  globalSetup: require.resolve('./tests/global-setup.ts'),

  /* Test timeout */
  timeout: 30 * 1000, // 30 seconds

  /* Expect timeout */
  expect: {
    timeout: 10 * 1000, // 10 seconds
  },
});
