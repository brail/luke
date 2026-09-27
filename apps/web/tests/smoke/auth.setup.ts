import { test as setup, expect } from '@playwright/test';

import {
  ADMIN_STORAGE_STATE,
  SMOKE_USERNAME,
  login,
  suppressDailyGreeting,
} from '../support/smoke';

/**
 * Authenticates once per run and saves the state to disk: the other specs start
 * already logged in.
 *
 * Repeating the login in every `beforeEach` would cost an Auth.js round-trip per
 * test and make every failure ambiguous — "is the flow broken or is the login
 * broken?". The real login is still covered, in full, by `auth.smoke.spec.ts`.
 */
setup('autentica come admin', async ({ page }) => {
  await login(page);

  await expect(
    page,
    `Login failed for user "${SMOKE_USERNAME}". ` +
      'Check that the seed ran and that E2E_USERNAME/E2E_PASSWORD ' +
      'match an active user.'
  ).toHaveURL(/\/dashboard$/);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await suppressDailyGreeting(page);

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
