import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * Il pricing è l'unico punto dell'app in cui un numero sbagliato costa soldi.
 * Il motore ha già i suoi unit test; qui verifichiamo la catena completa —
 * contesto brand+stagione → set parametri → `pricing.calculate` → numero a
 * schermo — che nessun test unitario attraversa.
 */
test.describe('smoke: pricing', () => {
  test('la calcolatrice produce un prezzo retail', async ({ page }) => {
    await page.goto('/product/pricing');
    await expectContextConfigured(page);

    await expect(
      page.getByRole('heading', { name: 'Costi e Prezzi', level: 1 })
    ).toBeVisible();

    // Senza set parametri la pagina mostra legittimamente l'empty state: è una
    // precondizione di ambiente, non un difetto. Verifichiamo che l'empty state
    // sia quello giusto e ci fermiamo, invece di fallire su un sintomo altrui.
    const emptyState = page.getByText('Nessun parametro configurato');
    if (await emptyState.isVisible().catch(() => false)) {
      await expectNoErrorBoundary(page);
      test.skip(
        true,
        'Nessun set parametri per il contesto corrente: calcolo non verificabile.'
      );
    }

    const purchase = page.getByLabel('Prezzo acquisto');
    const retail = page.getByLabel('Prezzo retail');

    await expect(purchase).toBeVisible();
    await purchase.fill('100');

    // L'etichetta del bottone è derivata dallo stato dei campi: se dice
    // "Calcola prezzo retail" la modalità forward è stata risolta correttamente.
    const calculate = page.getByRole('button', {
      name: 'Calcola prezzo retail',
    });
    await expect(calculate).toBeEnabled();
    await calculate.click();

    // Forward mode riscrive il campo retail con il risultato del server.
    await expect(retail).not.toHaveValue('');
    await expect(page.getByText('Dettagli calcolo')).toBeVisible();
    // `exact` obbligatorio: la description della SectionCard contiene la stessa
    // frase e getByText di default fa substring case-insensitive.
    await expect(
      page.getByText('Margine aziendale', { exact: true })
    ).toBeVisible();

    const computed = Number(await retail.inputValue());
    expect(
      computed,
      'Il retail calcolato deve superare il costo di acquisto'
    ).toBeGreaterThan(100);

    await expectNoErrorBoundary(page);
  });
});
