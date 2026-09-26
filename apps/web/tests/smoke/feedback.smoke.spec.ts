import { test, expect } from '@playwright/test';

/**
 * Regression for the bug where the feedback dialog never opened: it was mounted inside
 * `DropdownMenuContent`, which Radix unmounts when the menu closes — before the dialog
 * could appear. See AppSidebar.tsx.
 */
test.describe('smoke: feedback dialog', () => {
  test('opening "Segnala / Suggerisci" from the user menu shows the dialog', async ({ page }) => {
    await page.goto('/dashboard');

    await page.locator('div[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Segnala / Suggerisci' }).click();

    await expect(
      page.getByRole('dialog', { name: 'Segnalazione / Suggerimento' })
    ).toBeVisible();

    // The dialog stays visible: the menu that contained it is now closed/unmounted, and
    // before the fix this was exactly the moment the dialog disappeared with it instead
    // of staying open.
    await page.waitForTimeout(300);
    await expect(
      page.getByRole('dialog', { name: 'Segnalazione / Suggerimento' })
    ).toBeVisible();
  });
});
