import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

import { login, logoutAccount, test } from '../support/smoke';

/**
 * The one sign-out path over real HTTP (#238, ADR-048): a native form post to `/api/auth/logout`,
 * answered with a 303 that clears every session cookie chunk, with no JavaScript in the page. A
 * post from another origin changes nothing. Runs on the dedicated logout account, as
 * `auth.smoke.spec.ts`'s sidebar sign-out: `auth.logout` ends every session of its user.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const SESSION_COOKIE = 'next-auth.session-token';

/** Signs in with JavaScript (the login form needs it); returns the session cookies and API bearer. */
async function signIn(page: Page) {
  const { username, password } = logoutAccount();
  await login(page, username, password);
  await expect(page).toHaveURL(/\/dashboard$/);
  const session = await (await page.request.get('/api/auth/session')).json();
  return { state: await page.context().storageState(), bearer: session.accessToken as string };
}

async function sessionCookies(context: BrowserContext) {
  return (await context.cookies()).filter(cookie => cookie.name.startsWith(SESSION_COOKIE));
}

async function isSignedIn(request: APIRequestContext): Promise<boolean> {
  const session = await (await request.get('/api/auth/session')).json();
  return Boolean(session?.user);
}

/** Splits the session cookie into the two chunks Auth.js writes for a large session. */
async function splitIntoChunks(context: BrowserContext) {
  const [cookie] = await sessionCookies(context);
  const half = Math.ceil(cookie.value.length / 2);
  await context.clearCookies({ name: SESSION_COOKIE });
  await context.addCookies([
    { ...cookie, name: `${SESSION_COOKIE}.0`, value: cookie.value.slice(0, half) },
    { ...cookie, name: `${SESSION_COOKIE}.1`, value: cookie.value.slice(half) },
  ]);
}

test.describe('smoke: sign-out form', () => {
  // One sign-in only: a run's logins are counted against the per-IP login limit (apps/web/README.md).
  test('signs out without JavaScript, chunks included, and refuses a foreign post', async ({ page, browser }) => {
    const { state, bearer } = await signIn(page);
    // The same session, with JavaScript disabled.
    const context = await browser.newContext({ storageState: state, javaScriptEnabled: false });

    // A post from another origin, or an opaque one, changes nothing and asks for confirmation.
    for (const origin of ['https://evil.example', 'null']) {
      const response = await context.request.post('/api/auth/logout', { headers: { Origin: origin }, maxRedirects: 0 });
      expect(response.status()).toBe(303);
      expect(response.headers().location).toBe('/logout');
      expect(await isSignedIn(context.request)).toBe(true);
    }
    // A GET (a link, a prefetch) signs nobody out.
    expect((await context.request.get('/api/auth/logout', { maxRedirects: 0 })).status()).toBe(405);

    await splitIntoChunks(context);
    expect(await isSignedIn(context.request)).toBe(true);

    // From an error page with no sidebar, the 404.
    const noScript = await context.newPage();
    await noScript.goto('/no-such-page-smoke');
    await noScript.getByRole('button', { name: 'Esci' }).click();
    await expect(noScript).toHaveURL(/\/login$/);

    expect(await sessionCookies(context)).toEqual([]);
    // Read from the session endpoint: without JavaScript a page would not redirect to the login.
    expect(await isSignedIn(context.request)).toBe(false);
    // The API session is over too, not only this browser's.
    const me = await context.request.get('/trpc/me.get', { headers: { Authorization: `Bearer ${bearer}` } });
    expect(me.status()).toBe(401);

    // The confirmation page, pressed again once signed out: nothing left to end, no notice.
    await noScript.goto('/logout');
    await noScript.getByRole('button', { name: 'Esci' }).click();
    await expect(noScript).toHaveURL(/\/login$/);

    await context.close();
  });
});
