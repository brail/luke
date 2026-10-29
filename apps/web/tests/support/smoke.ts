import path from 'path';

import { expect, type Page } from '@playwright/test';

import { addCalendarDays, calendarDateIn } from '@luke/core';

import { dailyGreetingSeenKey } from '../../src/lib/dailyGreetingKey';

/**
 * Smoke credentials. The default is the user created by `apps/api/prisma/seed.ts`: it is not
 * a secret (it is in the clear in the versioned seed) and it does not go through AppConfig,
 * because it is a test runner input — the same status as `TEST_DATABASE_URL` on the API side,
 * not application configuration.
 */
export const SMOKE_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const SMOKE_PASSWORD = process.env.E2E_PASSWORD ?? 'changeme';

/**
 * The logout test's own account: `auth.logout` revokes every session of its user, so the shared
 * smoke user must never log out. No default; the test fails rather than skips without it.
 */
export function logoutAccount(): { username: string; password: string } {
  const username = process.env.E2E_LOGOUT_USERNAME;
  const password = process.env.E2E_LOGOUT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'Set E2E_LOGOUT_USERNAME and E2E_LOGOUT_PASSWORD to the dedicated logout account (apps/web/README.md).'
    );
  }
  return { username, password };
}

/**
 * storageState produced by `auth.setup.ts` and reused by every smoke spec.
 * Resolved from `__dirname` and not from the cwd, so the suite also starts when invoked
 * from the monorepo root.
 */
export const ADMIN_STORAGE_STATE = path.join(__dirname, '..', '.auth', 'admin.json');

/**
 * Title of the `PageHeader` in `app/error.tsx`. If it shows, the page fell into the error
 * boundary: it is the signal a smoke test must always catch, because a runtime crash gets
 * past lint and typecheck undisturbed.
 */
const ERROR_BOUNDARY_HEADING = 'Si è verificato un errore';

/** Title of the `ContextGate` blocking modal. */
const CONTEXT_GATE_TITLE = 'Seleziona Contesto';

/** Logs in from the `/login` page by filling in the real form. */
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
 * The daily greeting is a full-screen `Dialog` that intercepts every click: without this,
 * the first spec of every run would fail on a covered element. `useDailyGreeting` skips it
 * if it finds today's flag, today being the profile zone's: up to a day either side of this
 * process's UTC day, and one more for a run across midnight, so we flag all four. Suppressing it
 * here does not leave it uncovered: it is the modal's behaviour, not that of the flows the smoke
 * tests check.
 *
 * The key comes from `dailyGreetingSeenKey`, the same module the hook uses: re-deriving
 * its format here would break it silently at the first change.
 */
export async function suppressDailyGreeting(page: Page): Promise<void> {
  const today = calendarDateIn(new Date(), 'UTC');
  const keys = [-1, 0, 1, 2].map(offset => dailyGreetingSeenKey(addCalendarDays(today, offset)));

  await page.evaluate(ks => {
    for (const key of ks) {
      localStorage.setItem(key, '1');
    }
  }, keys);
}

/** Fails if the current page ended up in the Next error boundary. */
export async function expectNoErrorBoundary(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: ERROR_BOUNDARY_HEADING })
  ).toHaveCount(0);
}

/**
 * Checks that the environment has an active brand and season.
 *
 * Without a context, `ContextGate` opens a blocking modal and every spec would fail on
 * symptoms unrelated to the cause. Telling the precondition failure apart from a bug here
 * is the only way not to waste time debugging an empty DB.
 */
export async function expectContextConfigured(page: Page): Promise<void> {
  const gate = page.getByRole('dialog').filter({ hasText: CONTEXT_GATE_TITLE });
  await expect(
    gate,
    'ContextGate open: the environment has no active brand/season. ' +
      'The smoke suite assumes a seeded DB — this is not a bug in the code under test.'
  ).toHaveCount(0);
}

/**
 * Unique brand code per run. Uppercase and with no characters outside `[A-Z0-9_ -]`, so
 * `normalizeCode` leaves it unchanged and the table assertions can compare exactly the
 * value entered.
 */
export function uniqueBrandCode(): string {
  return `SMOKE-${Date.now().toString(36).toUpperCase()}`;
}
