import { test, expect, type Page } from '@playwright/test';

import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
  uniqueBrandCode,
} from '../support/smoke';

const BRANDS_PATH = '/admin/brands';

/** Prefix of `uniqueBrandCode()`: it identifies everything that needs cleaning up. */
const SMOKE_PREFIX = 'SMOKE-';

/** Brand table row that contains the given code. */
function brandRow(page: Page, code: string) {
  return page.getByRole('row').filter({ hasText: code });
}

/**
 * Waits for the table to finish loading.
 *
 * Needed before every `count()`: unlike `expect`, `count()` does not retry, and while
 * React Query refetches, the table shows skeletons — zero rows. Without this wait the
 * cleanup read 0 and exited convinced it was done, leaving the brands in the database.
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
 * Deletes the first remaining `SMOKE-` brand. Returns `false` when there are none left.
 *
 * It starts from a fresh navigation on every call instead of looping on the same page:
 * chaining several deletions on the live DOM proved unstable — between an AlertDialog
 * closing, the toasts and the list invalidation, the next click found the element
 * "not stable" or already detached. The reload costs a few hundred milliseconds and
 * makes the cleanup deterministic; at rest the table is stable and does not refetch, so
 * there is nothing to fix on the application side.
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

  // The permanent delete sits behind a typed confirmation: the button stays disabled until the
  // field holds the exact phrase, and the server refuses a call that does not carry it either.
  // Friction meant for humans is friction for this cleanup too — the accepted cost, not something
  // to work around.
  await dialog.getByRole('textbox').fill(HARD_DELETE_CONFIRM_PHRASE);

  await dialog
    .getByRole('button', { name: 'Elimina definitivamente', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  return true;
}

/**
 * Permanently deletes every brand the run left behind.
 *
 * It filters on the `SMOKE-` prefix and never fails the test: the failure that matters is
 * the flow, not the tail. It does print an error, though — the first version stayed
 * silent and hid for two runs the fact that it deleted nothing. It also cleans up leftovers
 * from earlier runs that went wrong.
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
  // The cleanup runs inside the test budget and may have to clear the leftovers of an
  // earlier run that went wrong: the 30s default is not enough.
  test.describe.configure({ timeout: 90_000 });

  test.afterEach(async ({ page }) => {
    await cleanupSmokeBrands(page);
  });

  test('creates, edits and deactivates a brand', async ({ page }) => {
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
      // The toast says the mutation returned; the row says the list was really
      // invalidated. Both are needed: the classic bug is the write that succeeds
      // and the UI that stays still.
      await expect(brandRow(page, code)).toBeVisible();
    });

    await test.step('edit', async () => {
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

      // Soft delete: it disappears from the default list but not from the database.
      // If this distinction breaks, a "delete" becomes irreversible without anyone
      // noticing.
      await expect(brandRow(page, code)).toHaveCount(0);

      await page.getByLabel('Mostra disattivati').check();
      await expect(brandRow(page, code)).toBeVisible();
      await expect(brandRow(page, code)).toContainText('Disattivo');
    });

    await expectNoErrorBoundary(page);
  });

  test('a duplicate code is rejected', async ({ page }) => {
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

    // The uniqueness constraint lives in the DB: this checks that the P2002 reaches
    // the user as a message, not as a generic 500. It is exactly the branch added in
    // `brand.ts` after the `$transaction`.
    await expect(page.getByText('Nome o codice brand già in uso')).toBeVisible();
    await expectNoErrorBoundary(page);
  });
});
