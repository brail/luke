import type { FullConfig } from '@playwright/test';

/**
 * Pre-flight: checks that the API and the frontend respond before the suite starts.
 *
 * Without this check an unreachable or rate-limited backend shows up as "login failed" and
 * sends you hunting for the wrong error — it really happened while the suite was being
 * written. The 429 gets a dedicated message because it has a precise cause: the API rate
 * limit does not exempt localhost when `NODE_ENV` is not `development`.
 *
 * It is two `fetch` calls and not a browser session: `auth.setup.ts` navigates to the
 * frontend right after, and on a local run Playwright's `webServer` has already waited for
 * it. Launching a chromium to read a `<title>` and throw it away was work paid on every run
 * without adding coverage.
 */
async function probe(label: string, url: string): Promise<void> {
  const response = await fetch(url).catch((error: unknown) => {
    throw new Error(
      `${label} unreachable at ${url}: ${String(error)}. ` +
        'Start the stack with `pnpm dev`, or check PLAYWRIGHT_BASE_URL.'
    );
  });

  if (response.status === 429) {
    throw new Error(
      `${label} is answering 429 (rate limit) on ${url}. Wait a minute ` +
        'before running again: with NODE_ENV other than "development" the ' +
        '100 req/min per IP limit applies, to localhost too.'
    );
  }

  if (!response.ok) {
    throw new Error(`${label} answered HTTP ${response.status} at ${url}.`);
  }
}

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000';

  await probe('Frontend', baseURL);
  // Through the web origin: a deployed stack exposes the API only there, and not its `/healthz`.
  await probe('API', `${baseURL}/trpc/public.appInfo`);
}

export default globalSetup;
