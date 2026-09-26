import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * The planning freeze is deliberately NOT run to the end.
 *
 * Freezing a group changes the season state and can only be undone by an admin action:
 * doing it on every smoke run against a shared environment would be a worse side effect
 * than the bug it looks for. Here we check everything upstream of the write — permissions,
 * opening the picker, the groups query, the guard on "Continua" — and stop before the
 * mutation. The real freeze stays covered by the `seasonCalendar` integration tests.
 */
// Page loading is not tested here: `shell.smoke.spec.ts` covers `/calendar` with a
// superset of these assertions (heading, error boundary, plus unhandled exceptions and
// 5xx). In a serial suite a second page load for the same check is time spent twice,
// and two assertions on the same heading in different files diverge at the first rename.
test.describe('smoke: calendario e freeze', () => {
  test('the freeze picker opens and lists the groups', async ({
    page,
  }) => {
    await page.goto('/calendar');
    await expectContextConfigured(page);
    await expect(
      page.getByRole('heading', { name: 'Calendario Stagionale', level: 1 })
    ).toBeVisible();

    // In the "planning" state the action sits in the bar; once the season has started it
    // moves into the menu. Both positions are legitimate, so the smoke test accepts either
    // instead of hard-coding one of the two states.
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

    // The picker is full or empty depending on the data: both are valid states; what
    // must never happen is staying on "Caricamento…".
    await expect(picker.getByText('Caricamento…')).toHaveCount(0);

    // The guard that matters: without a selected group you cannot move on towards an
    // irreversible write.
    await expect(
      picker.getByRole('button', { name: 'Continua' })
    ).toBeDisabled();

    await picker.getByRole('button', { name: 'Annulla' }).click();
    await expect(picker).toHaveCount(0);

    await expectNoErrorBoundary(page);
  });
});
