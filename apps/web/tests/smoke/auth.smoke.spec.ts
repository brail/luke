import { test, expect } from '@playwright/test';

import { login, expectNoErrorBoundary } from '../support/smoke';

/**
 * Login is the only flow whose failure makes the application entirely unusable: no
 * other smoke test makes sense if this one does not pass. It starts from an empty
 * session, so it ignores the shared storageState.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('smoke: autenticazione', () => {
  test('valid credentials lead to the dashboard', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoErrorBoundary(page);
  });

  test('wrong credentials show an error and do not authenticate', async ({
    page,
  }) => {
    await login(page, 'utente-inesistente-smoke', 'password-sbagliata');

    await expect(page.getByText('Credenziali non valide')).toBeVisible();
    // The check that matters: the error is visible *and* the session did not start.
    // A login that fails but lets you in is worse than one that does not work.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a protected route redirects an anonymous visitor to login', async ({ page }) => {
    await page.goto('/admin/brands');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout closes the session', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard$/);

    // The user menu trigger is the only `div` with aria-haspopup: the other sidebar
    // menus are <button>. With `asChild` Radix propagates aria-haspopup onto the div but
    // does not give it role="button", so no getByRole; and `[data-sidebar="footer"]` is
    // not enough to tell them apart, because AppSidebar has two of them nested.
    await page.locator('div[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();

    await expect(page).toHaveURL(/\/login$/);

    // Going back must not resurrect the session from the bfcache.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
