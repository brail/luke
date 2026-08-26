import { test, expect } from '@playwright/test';

/**
 * Regression per il bug per cui il dialog di segnalazione non si apriva mai:
 * era montato dentro `DropdownMenuContent`, che Radix smonta alla chiusura del
 * menu — prima che il dialog potesse comparire. Vedi AppSidebar.tsx.
 */
test.describe('smoke: feedback dialog', () => {
  test('aprire "Segnala / Suggerisci" dal menu utente mostra il dialog', async ({ page }) => {
    await page.goto('/dashboard');

    await page.locator('div[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Segnala / Suggerisci' }).click();

    await expect(
      page.getByRole('dialog', { name: 'Segnalazione / Suggerimento' })
    ).toBeVisible();

    // Il dialog resta visibile: il menu che lo conteneva è ormai chiuso/smontato,
    // e prima del fix questo era esattamente il momento in cui il dialog spariva
    // con lui invece di restare aperto.
    await page.waitForTimeout(300);
    await expect(
      page.getByRole('dialog', { name: 'Segnalazione / Suggerimento' })
    ).toBeVisible();
  });
});
