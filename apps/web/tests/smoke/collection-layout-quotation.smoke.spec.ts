import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * Regressione: Invio su un campo quotazione (retail/FOB/note/SKU) sottomette
 * il `<form>` esterno della riga — il campo quotazione salva solo su blur, e
 * l'Invio non genera un blur prima del submit. Risultato pre-fix: il modal si
 * chiude, il prezzo digitato sparisce, riaprendo la riga non c'è.
 *
 * Il fix fa sì che l'Invio salvi prima la quotazione via mutation e solo dopo
 * sottometta/chiuda la riga — stessa UX di prima, senza perdere il dato.
 *
 * Nessun tier unit esiste per i componenti web (solo Playwright smoke): è
 * un'interazione DOM/tastiera su un form annidato, non verificabile senza un
 * browser reale.
 */
test.describe('smoke: collection layout — Invio su campo quotazione', () => {
  test('salva la quotazione e chiude la riga, senza perdere il prezzo retail', async ({ page }) => {
    await page.goto('/product/collection-layout');
    await expectContextConfigured(page);

    const emptyState = page.getByText('Nessun Collection Layout configurato');
    if (await emptyState.isVisible().catch(() => false)) {
      await expectNoErrorBoundary(page);
      test.skip(
        true,
        'Nessun collection layout per il contesto corrente: nessuna riga su cui aprire il drawer.'
      );
    }

    const row = page
      .locator('table tbody tr')
      .filter({ hasNotText: 'Nessuna riga' })
      .first();
    if ((await row.count()) === 0) {
      await expectNoErrorBoundary(page);
      test.skip(true, 'Nessuna riga disponibile nel layout corrente.');
    }
    await expect(row).toBeVisible();

    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const addQuotation = dialog.getByRole('button', { name: 'Aggiungi quotazione' });
    if ((await addQuotation.count()) === 0) {
      await expectNoErrorBoundary(page);
      test.skip(true, 'Utente senza permesso di scrittura sul collection layout: impossibile riprodurre.');
    }

    const quotationBody = dialog.locator('table tbody');
    const initialQuotations = await quotationBody.locator('tr').count();

    await addQuotation.click();
    await expect(quotationBody.locator('tr')).toHaveCount(initialQuotations + 1);
    const quotationRow = quotationBody.locator('tr').last();

    // Scegli un set parametri — precondizione ambientale come in pricing.smoke.spec.ts.
    await quotationRow.getByRole('combobox').click();
    const paramOption = page.getByRole('option').filter({ hasNotText: 'Nessuno' }).first();
    if ((await paramOption.count()) === 0) {
      await page.keyboard.press('Escape');
      // La riga aggiunta è vuota (nessun paramSetId): eliminala per non sporcare il layout.
      await quotationRow.getByRole('button').last().click();
      await expect(quotationBody.locator('tr')).toHaveCount(initialQuotations);
      await expectNoErrorBoundary(page);
      test.skip(true, 'Nessun set parametri pricing configurato: impossibile selezionare la quotazione.');
    }
    await paramOption.click();

    const RETAIL_VALUE = '123.45';
    let cleanedUp = false;
    try {
      const retailInput = quotationRow.locator('input').first();
      await expect(retailInput).toBeEnabled();
      await retailInput.fill(RETAIL_VALUE);
      await retailInput.press('Enter');

      // Comportamento atteso: la riga si sottomette e il modal si chiude, come
      // faceva prima del fix — ma stavolta il prezzo è stato persistito prima.
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('Riga aggiornata')).toBeVisible();
      await expectNoErrorBoundary(page);

      // Riapri la riga: se il bug fosse ancora presente, il campo retail
      // sarebbe vuoto qui perché la mutation di update non è mai partita.
      await row.click();
      const reopened = page.getByRole('dialog');
      await expect(reopened).toBeVisible();
      const persistedRow = reopened.locator('table tbody tr').last();
      await expect(persistedRow.locator('input').first()).toHaveValue(RETAIL_VALUE);

      // Pulizia: elimina la quotazione di test prima di chiudere.
      await persistedRow.getByRole('button').last().click();
      await expect(reopened.locator('table tbody tr')).toHaveCount(initialQuotations);
      cleanedUp = true;

      await page.getByRole('button', { name: 'Annulla' }).click();
      await expect(reopened).toHaveCount(0);
      await expectNoErrorBoundary(page);
    } finally {
      if (!cleanedUp) {
        // Prova comunque a ripulire, qualunque cosa sia fallita sopra: uno smoke
        // non deve lasciare dati di test permanenti su una riga non sua.
        const openDialog = page.getByRole('dialog');
        if (await openDialog.isVisible().catch(() => false)) {
          const rows = openDialog.locator('table tbody tr');
          const count = await rows.count().catch(() => 0);
          if (count > initialQuotations) {
            await rows.last().getByRole('button').last().click().catch(() => {});
          }
        }
      }
    }
  });
});
