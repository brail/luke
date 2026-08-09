import path from 'path';

import { expect, type Page } from '@playwright/test';

import { dailyGreetingSeenKey } from '../../src/lib/dailyGreetingKey';

/**
 * Credenziali dello smoke. Il default è l'utente creato da
 * `apps/api/prisma/seed.ts`: non è un segreto (sta in chiaro nel seed
 * versionato) e non passa da AppConfig, perché è un input del test runner —
 * stesso status di `TEST_DATABASE_URL` lato API, non configurazione applicativa.
 */
export const SMOKE_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const SMOKE_PASSWORD = process.env.E2E_PASSWORD ?? 'changeme';

/**
 * storageState prodotto da `auth.setup.ts` e riusato da tutti gli spec smoke.
 * Risolto da `__dirname` e non dalla cwd, così la suite parte anche invocata
 * dalla root del monorepo.
 */
export const ADMIN_STORAGE_STATE = path.join(__dirname, '..', '.auth', 'admin.json');

/**
 * Titolo del `PageHeader` in `app/error.tsx`. Se compare, la pagina è andata in
 * error boundary: è il segnale che uno smoke deve intercettare sempre, perché
 * un crash a runtime supera lint e typecheck indisturbato.
 */
const ERROR_BOUNDARY_HEADING = 'Si è verificato un errore';

/** Titolo del modale bloccante di `ContextGate`. */
const CONTEXT_GATE_TITLE = 'Seleziona Contesto';

/** Esegue il login dalla pagina `/login` compilando il form reale. */
export async function login(
  page: Page,
  username: string = SMOKE_USERNAME,
  password: string = SMOKE_PASSWORD
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Accedi' }).click();
}

/**
 * Il saluto giornaliero è un `Dialog` a schermo intero che intercetta ogni
 * click: senza questo, il primo spec di ogni run fallirebbe su un elemento
 * coperto. `useDailyGreeting` lo salta se trova il flag di oggi, quindi lo
 * scriviamo per oggi e per domani — così una run a cavallo di mezzanotte non lo
 * risveglia a metà. Sopprimerlo qui non lo lascia scoperto: è comportamento del
 * modale, non dei flussi che lo smoke verifica.
 *
 * La chiave arriva da `dailyGreetingSeenKey`, lo stesso modulo che usa l'hook:
 * ri-derivarne il formato qui la romperebbe in silenzio al primo cambio.
 */
export async function suppressDailyGreeting(page: Page): Promise<void> {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const keys = [dailyGreetingSeenKey(now), dailyGreetingSeenKey(tomorrow)];

  await page.evaluate(ks => {
    for (const key of ks) {
      localStorage.setItem(key, '1');
    }
  }, keys);
}

/** Fallisce se la pagina corrente è finita nell'error boundary di Next. */
export async function expectNoErrorBoundary(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: ERROR_BOUNDARY_HEADING })
  ).toHaveCount(0);
}

/**
 * Verifica che l'ambiente abbia un brand e una stagione attivi.
 *
 * Senza contesto `ContextGate` apre un modale bloccante e ogni spec fallirebbe
 * su sintomi scollegati dalla causa. Distinguere qui il precondition failure dal
 * bug è l'unico modo per non perdere tempo a debuggare un DB vuoto.
 */
export async function expectContextConfigured(page: Page): Promise<void> {
  const gate = page.getByRole('dialog').filter({ hasText: CONTEXT_GATE_TITLE });
  await expect(
    gate,
    'ContextGate aperto: l\'ambiente non ha brand/stagione attivi. ' +
      'Lo smoke presuppone un DB seedato — non è un bug del codice in test.'
  ).toHaveCount(0);
}

/**
 * Codice brand univoco per run. Maiuscolo e senza caratteri fuori
 * `[A-Z0-9_ -]`, così `normalizeCode` lo lascia identico e le asserzioni sulla
 * tabella possono confrontare esattamente il valore inserito.
 */
export function uniqueBrandCode(): string {
  return `SMOKE-${Date.now().toString(36).toUpperCase()}`;
}
