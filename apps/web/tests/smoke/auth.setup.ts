import { test as setup, expect } from '@playwright/test';

import {
  ADMIN_STORAGE_STATE,
  SMOKE_USERNAME,
  login,
  suppressDailyGreeting,
} from '../support/smoke';

/**
 * Autentica una volta per run e salva lo stato su disco: gli altri spec
 * ripartono già loggati.
 *
 * Ripetere il login in ogni `beforeEach` costerebbe un round-trip Auth.js per
 * test e renderebbe ogni fallimento ambiguo — "è rotto il flusso o è rotto il
 * login?". Il login vero resta comunque coperto, per intero, da
 * `auth.smoke.spec.ts`.
 */
setup('autentica come admin', async ({ page }) => {
  await login(page);

  await expect(
    page,
    `Login fallito per l'utente "${SMOKE_USERNAME}". ` +
      'Verifica che il seed sia stato eseguito e che E2E_USERNAME/E2E_PASSWORD ' +
      'corrispondano a un utente attivo.'
  ).toHaveURL(/\/dashboard$/);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await suppressDailyGreeting(page);

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
