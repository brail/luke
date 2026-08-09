import { test, expect } from '@playwright/test';

import { login, expectNoErrorBoundary } from '../support/smoke';

/**
 * Il login è l'unico flusso il cui fallimento rende l'applicazione interamente
 * inutilizzabile: nessun altro smoke ha senso se questo non passa. Parte da
 * sessione vuota, quindi ignora lo storageState condiviso.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('smoke: autenticazione', () => {
  test('credenziali valide portano alla dashboard', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoErrorBoundary(page);
  });

  test('credenziali errate mostrano un errore e non autenticano', async ({
    page,
  }) => {
    await login(page, 'utente-inesistente-smoke', 'password-sbagliata');

    await expect(page.getByText('Credenziali non valide')).toBeVisible();
    // Il controllo che conta: l'errore è visibile *e* la sessione non è partita.
    // Un login che fallisce ma lascia entrare è peggio di uno che non funziona.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('una rotta protetta da anonimo redirige al login', async ({ page }) => {
    await page.goto('/admin/brands');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('il logout chiude la sessione', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard$/);

    // Il trigger del menu utente è l'unico `div` con aria-haspopup: gli altri
    // menu della sidebar sono <button>. Con `asChild` Radix propaga
    // aria-haspopup sul div ma non gli dà role="button", quindi niente
    // getByRole; e `[data-sidebar="footer"]` non basta a discriminare, perché
    // AppSidebar ne ha due annidati.
    await page.locator('div[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();

    await expect(page).toHaveURL(/\/login$/);

    // Tornare indietro non deve resuscitare la sessione dal bfcache.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
