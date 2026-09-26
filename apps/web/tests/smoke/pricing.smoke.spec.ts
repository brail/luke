import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * Pricing is the only place in the app where a wrong number costs money.
 * The engine already has its unit tests; here we check the full chain —
 * brand+season context → parameter set → `pricing.calculate` → number on
 * screen — that no unit test goes through.
 */
test.describe('smoke: pricing', () => {
  test('la calcolatrice produce un prezzo retail', async ({ page }) => {
    await page.goto('/product/pricing');
    await expectContextConfigured(page);

    await expect(
      page.getByRole('heading', { name: 'Costi e Prezzi', level: 1 })
    ).toBeVisible();

    // Without a parameter set the page legitimately shows the empty state: it is an
    // environment precondition, not a defect. We check that it is the right empty state
    // and stop, instead of failing on someone else's symptom.
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

    // The button label is derived from the field state: if it says
    // "Calcola prezzo retail", forward mode was resolved correctly.
    const calculate = page.getByRole('button', {
      name: 'Calcola prezzo retail',
    });
    await expect(calculate).toBeEnabled();
    await calculate.click();

    // Forward mode rewrites the retail field with the server result.
    await expect(retail).not.toHaveValue('');
    await expect(page.getByText('Dettagli calcolo')).toBeVisible();
    // `exact` is mandatory: the SectionCard description contains the same sentence
    // and getByText does a case-insensitive substring match by default.
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
