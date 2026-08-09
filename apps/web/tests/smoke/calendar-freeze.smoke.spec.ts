import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * Il freeze della pianificazione è deliberatamente NON eseguito fino in fondo.
 *
 * Congelare un gruppo cambia lo stato della stagione e si annulla solo con
 * un'azione admin: farlo a ogni smoke su un ambiente condiviso sarebbe un
 * effetto collaterale peggiore del bug che cerca. Qui verifichiamo tutto ciò
 * che sta a monte della scrittura — permessi, apertura del picker, query dei
 * gruppi, guardia sul "Continua" — e ci fermiamo prima della mutation.
 * Il freeze vero resta coperto dai test di integrazione su `seasonCalendar`.
 */
// Il caricamento della pagina non è testato qui: `shell.smoke.spec.ts` copre
// `/calendar` con un superset di queste asserzioni (heading, error boundary, più
// eccezioni non gestite e 5xx). In una suite seriale un secondo page load per lo
// stesso controllo è tempo speso due volte, e due asserzioni sullo stesso
// heading in file diversi divergono al primo rename.
test.describe('smoke: calendario e freeze', () => {
  test('il picker di congelamento si apre ed elenca i gruppi', async ({
    page,
  }) => {
    await page.goto('/calendar');
    await expectContextConfigured(page);
    await expect(
      page.getByRole('heading', { name: 'Calendario Stagionale', level: 1 })
    ).toBeVisible();

    // In stato "planning" l'azione sta nella barra; a stagione avviata si
    // sposta nel menu. Entrambe le posizioni sono legittime, quindi lo smoke
    // le accetta tutte e due invece di codificare uno solo dei due stati.
    const barButton = page.getByRole('button', {
      name: 'Congela pianificazione',
    });

    if (await barButton.isVisible().catch(() => false)) {
      await barButton.click();
    } else {
      await page.getByRole('button', { name: 'Altre azioni' }).click();
      await page
        .getByRole('menuitem', { name: 'Congela pianificazione' })
        .click();
    }

    const picker = page.getByRole('dialog');
    await expect(
      picker.getByRole('heading', {
        name: 'Congela quale gruppo di pianificazione?',
      })
    ).toBeVisible();

    // Il picker è pieno o vuoto a seconda dei dati: entrambi sono stati validi,
    // quello che non deve mai succedere è restare su "Caricamento…".
    await expect(picker.getByText('Caricamento…')).toHaveCount(0);

    // Guardia che conta: senza un gruppo selezionato non si prosegue verso una
    // scrittura irreversibile.
    await expect(
      picker.getByRole('button', { name: 'Continua' })
    ).toBeDisabled();

    await picker.getByRole('button', { name: 'Annulla' }).click();
    await expect(picker).toHaveCount(0);

    await expectNoErrorBoundary(page);
  });
});
