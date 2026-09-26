import { getApiBaseUrl } from '@luke/core';

import type { FullConfig } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? getApiBaseUrl();

/**
 * Pre-flight: checks that the API and the frontend respond before the suite starts.
 *
 * Without this check an unreachable or rate-limited backend shows up as "login failed" and
 * sends you hunting for the wrong error — it really happened while the suite was being
 * written. The 429 gets a dedicated message because it has a precise cause: the API rate
 * limit does not exempt localhost when `NODE_ENV` is not `development`.
 *
 * It is two `fetch` calls and not a browser session: Playwright's `webServer` has already
 * waited for the frontend before getting here, and `auth.setup.ts` navigates to it right
 * after. Launching a chromium to read a `<title>` and throw it away was work paid on every
 * run without adding coverage.
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
