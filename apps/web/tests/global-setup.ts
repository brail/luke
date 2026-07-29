import { getApiBaseUrl } from '@luke/core';

import type { FullConfig } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? getApiBaseUrl();

/**
 * Pre-flight: verifica che API e frontend rispondano prima di far partire la suite.
 *
 * Senza questo controllo un backend irraggiungibile o rate-limitato si manifesta
 * come "login fallito" e manda a caccia dell'errore sbagliato — è successo
 * davvero mentre la suite veniva scritta. Il 429 ha un messaggio dedicato perché
 * ha una causa precisa: il rate limit dell'API non esclude localhost quando
 * `NODE_ENV` non vale `development`.
 *
 * Sono due `fetch` e non una sessione browser: il `webServer` di Playwright ha
 * già atteso il frontend prima di arrivare qui, e `auth.setup.ts` ci naviga
 * subito dopo. Avviare un chromium per leggere un `<title>` e buttarlo era lavoro
 * pagato a ogni run senza aggiungere copertura.
 */
async function probe(label: string, url: string): Promise<void> {
  const response = await fetch(url).catch((error: unknown) => {
    throw new Error(
      `${label} non raggiungibile su ${url}: ${String(error)}. ` +
        'Avvia lo stack con `pnpm dev`.'
    );
  });

  if (response.status === 429) {
    throw new Error(
      `${label} sta rispondendo 429 (rate limit) su ${url}. Attendi un minuto ` +
        'prima di rilanciare: con NODE_ENV diverso da "development" il limite ' +
        'di 100 req/min vale anche per localhost.'
    );
  }

  if (!response.ok) {
    throw new Error(`${label} ha risposto HTTP ${response.status} su ${url}.`);
  }
}

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000';

  await probe('API', `${API_URL}/healthz`);
  await probe('Frontend', baseURL);
}

export default globalSetup;
