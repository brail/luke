import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * Historic regression: pressing Enter in a quotation field (retail/FOB/note/SKU) submitted
 * the row's outer `<form>` — the quotation field saved only on blur, and Enter produced no
 * blur before the submit. Pre-fix result: the modal closed, the typed price vanished, and
 * reopening the row it was not there.
 *
 * The mechanism has changed since: quotations no longer have their own mutation for
 * add/blur/delete — they are buffered in local drawer state and committed in a single
 * request only on Save (`collectionLayout.rows.update`, which syncs phase/group/quotations
 * in the same transaction as the row — see `CollectionRowDrawer.tsx`/`syncRowQuotations`).
 * Enter now calls `submitRow()` directly: there is no separate mutation left to run before
 * the submit, so the original bug class (blur never fired before the submit) cannot come
 * back by construction. The test stays valid as a regression on the buffer: it checks that
 * a price typed and submitted with Enter survives the local form → payload → mutation →
 * refetch round, not just that the modal closes.
 *
 * It is a DOM/keyboard interaction on a nested form, verifiable only in a real browser —
 * here, or in the browser tier (`vitest.browser.config.mts`).
 */
test.describe('smoke: collection layout — Enter on a quotation field', () => {
  test('saves the quotation and closes the row, without losing the retail price', async ({ page }) => {
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

    // Pick a parameter set: an environment precondition, as in pricing.smoke.spec.ts.
    await quotationRow.getByRole('combobox').click();
    const paramOption = page.getByRole('option').filter({ hasNotText: 'Nessuno' }).first();
    if ((await paramOption.count()) === 0) {
      await page.keyboard.press('Escape');
      // The added row is empty (no paramSetId): delete it so the layout stays clean.
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

      // Expected behaviour: the row submits and the modal closes — the price is in the
      // payload of the same update mutation, no separate round before the submit is
      // needed any more.
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('Riga aggiornata')).toBeVisible();
      await expectNoErrorBoundary(page);

      // Reopen the row: if the local buffer did not end up in the submit payload, the
      // retail field would be empty here because the quotation would never have been
      // sent to the server.
      await row.click();
      const reopened = page.getByRole('dialog');
      await expect(reopened).toBeVisible();
      const persistedRow = reopened.locator('table tbody tr').last();
      await expect(persistedRow.locator('input').first()).toHaveValue(RETAIL_VALUE);

      // Cleanup: delete the test quotation before closing.
      await persistedRow.getByRole('button').last().click();
      await expect(reopened.locator('table tbody tr')).toHaveCount(initialQuotations);
      cleanedUp = true;

      await page.getByRole('button', { name: 'Annulla' }).click();
      await expect(reopened).toHaveCount(0);
      await expectNoErrorBoundary(page);
    } finally {
      if (!cleanedUp) {
        // Try to clean up anyway, whatever failed above: a smoke test must not leave
        // permanent test data on a row that is not its own.
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
