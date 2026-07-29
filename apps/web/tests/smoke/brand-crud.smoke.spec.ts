import { test, expect, type Page } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
  uniqueBrandCode,
} from '../support/smoke';

const BRANDS_PATH = '/admin/brands';

/** Prefisso di `uniqueBrandCode()`: identifica tutto ciò che è da ripulire. */
const SMOKE_PREFIX = 'SMOKE-';

/** Riga della tabella brand che contiene il codice dato. */
function brandRow(page: Page, code: string) {
  return page.getByRole('row').filter({ hasText: code });
}

/**
 * Attende che la tabella abbia finito di caricare.
 *
 * Serve prima di ogni `count()`: a differenza di `expect`, `count()` non
 * ritenta, e mentre React Query rifà la query la tabella mostra skeleton — zero
 * righe. Senza questa attesa la pulizia leggeva 0 e usciva convinta di aver
 * finito, lasciando i brand nel database.
 */
async function waitForBrandList(page: Page): Promise<void> {
  const anySmokeRow = page
    .getByRole('row')
    .filter({ hasText: SMOKE_PREFIX })
    .first();
  const emptyState = page.getByText('Nessun brand trovato');

  await expect(anySmokeRow.or(emptyState)).toBeVisible();
}

/**
 * Elimina il primo brand `SMOKE-` rimasto. Torna `false` quando non ce n'è più.
 *
 * Riparte da una navigazione a ogni chiamata invece di ciclare sulla stessa
 * pagina: incatenare più eliminazioni sul DOM vivo si è rivelato instabile —
 * fra un AlertDialog che si chiude, i toast e l'invalidazione della lista, il
 * click successivo trovava l'elemento "not stable" o già staccato dal DOM. Il
 * reload costa qualche centinaio di millisecondi e rende la pulizia
 * deterministica; a riposo la tabella è stabile e non rifà query, quindi non
 * c'è nulla da correggere lato applicazione.
 */
async function deleteFirstSmokeBrand(page: Page): Promise<boolean> {
  await page.goto(BRANDS_PATH);
  await page.getByLabel('Cerca brand').fill(SMOKE_PREFIX);
  await page.getByLabel('Mostra disattivati').check();
  await waitForBrandList(page);

  const row = page.getByRole('row').filter({ hasText: SMOKE_PREFIX }).first();
  if ((await row.count()) === 0) return false;

  const dialog = page.getByRole('alertdialog');
  await row.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole('button', { name: 'Elimina definitivamente', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  return true;
}

/**
 * Cancella in modo definitivo ogni brand lasciato indietro dalla run.
 *
 * Filtra per prefisso `SMOKE-` e non fa mai fallire il test: il fallimento che
 * conta è quello del flusso, non quello della coda. Un errore però lo stampa —
 * la prima versione taceva e ha nascosto per due run il fatto che non cancellava
 * niente. Ripulisce anche i residui di run precedenti andate male.
 */
async function cleanupSmokeBrands(page: Page): Promise<void> {
  try {
    for (let i = 0; i < 20; i++) {
      if (!(await deleteFirstSmokeBrand(page))) return;
    }
  } catch (error) {
    console.warn('[smoke] pulizia brand non completata:', error);
  }
}

test.describe('smoke: CRUD brand', () => {
  // La pulizia gira dentro il budget del test e può dover smaltire i residui di
  // una run precedente andata male: 30s di default non bastano.
  test.describe.configure({ timeout: 90_000 });

  test.afterEach(async ({ page }) => {
    await cleanupSmokeBrands(page);
  });

  test('crea, modifica e disattiva un brand', async ({ page }) => {
    const code = uniqueBrandCode();

    await page.goto(BRANDS_PATH);
    await expectContextConfigured(page);
    await expect(
      page.getByRole('heading', { name: 'Brand', level: 1, exact: true })
    ).toBeVisible();

    await test.step('crea', async () => {
      await page.getByRole('button', { name: 'Nuovo Brand' }).click();

      const dialog = page.getByRole('dialog');
      await expect(
        dialog.getByRole('heading', { name: 'Nuovo Brand' })
      ).toBeVisible();
      await dialog.getByLabel('Codice').fill(code);
      await dialog.getByLabel('Nome').fill('Smoke Brand');
      await dialog.getByRole('button', { name: 'Crea', exact: true }).click();

      await expect(page.getByText('Brand creato con successo')).toBeVisible();
      // Il toast dice che la mutation è tornata; la riga dice che la lista è
      // stata invalidata davvero. Servono entrambe: il bug classico è la
      // scrittura che riesce e la UI che resta ferma.
      await expect(brandRow(page, code)).toBeVisible();
    });

    await test.step('modifica', async () => {
      await brandRow(page, code)
        .getByRole('button', { name: 'Modifica', exact: true })
        .click();

      const dialog = page.getByRole('dialog');
      await expect(
        dialog.getByRole('heading', { name: 'Modifica Brand' })
      ).toBeVisible();
      await dialog.getByLabel('Nome').fill('Smoke Brand Aggiornato');
      await dialog
        .getByRole('button', { name: 'Aggiorna', exact: true })
        .click();

      await expect(
        page.getByText('Brand aggiornato con successo')
      ).toBeVisible();
      await expect(brandRow(page, code)).toContainText('Smoke Brand Aggiornato');
    });

    await test.step('disattiva', async () => {
      await brandRow(page, code)
        .getByRole('button', { name: 'Disattiva', exact: true })
        .click();

      const confirm = page.getByRole('alertdialog');
      await expect(
        confirm.getByRole('heading', { name: 'Disattiva brand' })
      ).toBeVisible();
      await confirm
        .getByRole('button', { name: 'Disattiva', exact: true })
        .click();

      // Soft delete: sparisce dalla lista di default ma non dal database.
      // Se questa distinzione si rompe, un "elimina" diventa irreversibile
      // senza che nessuno se ne accorga.
      await expect(brandRow(page, code)).toHaveCount(0);

      await page.getByLabel('Mostra disattivati').check();
      await expect(brandRow(page, code)).toBeVisible();
      await expect(brandRow(page, code)).toContainText('Disattivo');
    });

    await expectNoErrorBoundary(page);
  });

  test('il codice duplicato viene rifiutato', async ({ page }) => {
    const code = uniqueBrandCode();

    await page.goto(BRANDS_PATH);
    await expectContextConfigured(page);

    await page.getByRole('button', { name: 'Nuovo Brand' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Codice').fill(code);
    await dialog.getByLabel('Nome').fill('Smoke Primo');
    await dialog.getByRole('button', { name: 'Crea', exact: true }).click();
    await expect(brandRow(page, code)).toBeVisible();

    await page.getByRole('button', { name: 'Nuovo Brand' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Codice').fill(code);
    await dialog.getByLabel('Nome').fill('Smoke Secondo');
    await dialog.getByRole('button', { name: 'Crea', exact: true }).click();

    // Il vincolo di unicità è a livello di DB: questo verifica che il P2002
    // arrivi all'utente come messaggio, non come 500 generico. È esattamente
    // il ramo aggiunto in `brand.ts` dopo la `$transaction`.
    await expect(page.getByText('Nome o codice brand già in uso')).toBeVisible();
    await expectNoErrorBoundary(page);
  });
});
