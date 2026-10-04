import { readdirSync } from 'fs';
import path from 'path';

import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * Critical routes and their `h1`. `null` where the title is dynamic (the dashboard greets
 * the user and changes with the time of day): there, it is enough that an h1 exists.
 */
const CRITICAL_ROUTES: { path: string; heading: string | null }[] = [
  { path: '/dashboard', heading: null },
  { path: '/admin/brands', heading: 'Brand' },
  { path: '/admin/seasons', heading: 'Stagioni' },
  { path: '/product/pricing', heading: 'Costi e Prezzi' },
  { path: '/product/collection-layout', heading: 'Collection Layout' },
  { path: '/calendar', heading: 'Calendario Stagionale' },
  { path: '/settings/users', heading: 'Gestione Utenti' },
  { path: '/maintenance/audit-log', heading: 'Audit Log' },
];

/**
 * Routes deliberately left out of the sweep, with the reason.
 *
 * It exists to make the choice explicit: without this list, a new page would silently
 * join the "not covered" set and nobody would notice — which is exactly how the previous
 * E2E suite stayed broken for months. Adding a page now forces a decision: either it is
 * critical, or you state why it is not.
 */
const UNCOVERED_ROUTES: Record<string, string> = {
  '/about': 'static page, no query',
  '/profile': 'covered indirectly by the logout in auth.smoke',
  '/notifications': 'no deterministic seeded data',
  '/admin/calendar-configuration': 'admin config, little traffic',
  '/admin/collection-layout-configuration': 'admin config, little traffic',
  '/admin/phase-catalog': 'admin config, little traffic',
  '/admin/vendors': 'same CRUD pattern as /admin/brands, already covered',
  '/maintenance/backup': 'destructive operations, unfit for a smoke test',
  '/maintenance/config': 'destructive operations, unfit for a smoke test',
  '/maintenance/import-export': 'destructive operations, unfit for a smoke test',
  '/maintenance/mode': 'turns maintenance on: it would block the rest of the suite',
  '/product/collection-layout/revisions': 'needs existing revisions',
  '/product/control': 'needs seeded collection data',
  '/product/merchandising-plan': 'needs seeded collection data',
  '/sales/statistics': 'needs synced NAV data',
  '/settings/collection-control': 'config, no heavy query',
  '/settings/company': 'config, no heavy query',
  '/settings/google': 'config with external credentials',
  '/settings/ldap': 'config with external credentials',
  '/settings/mail': 'config with external credentials',
  '/settings/nav': 'config with external credentials',
  '/settings/nav-sync': 'starts real syncs against NAV',
  '/settings/storage': 'config, no heavy query',
};

/** Derives the static routes of the `(app)` group from the file tree. */
function discoverAppRoutes(): string[] {
  const root = path.join(__dirname, '..', '..', 'src', 'app', '(app)');
  const routes: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Dynamic segments (`[revisionId]`) have no reachable URL without data: out of
        // the comparison, together with their descendants.
        if (entry.name.startsWith('[')) continue;
        walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === 'page.tsx') {
        routes.push(prefix || '/');
      }
    }
  };

  walk(root, '');
  return routes.sort();
}

/**
 * Sweep of the critical routes.
 *
 * It is the smoke test with the best value/cost ratio in the suite: lint and typecheck do
 * not see a tRPC contract changed on one side only, a stale `@luke/core` dist, or a client
 * component marked as server. All three show up the same way — the page blowing up on
 * first load — and all three reach production if nobody opens that page before the tag.
 */
test.describe('smoke: shell applicativa', () => {
  for (const { path: routePath, heading } of CRITICAL_ROUTES) {
    test(`${routePath} loads without errors`, async ({ page }) => {
      const uncaught: string[] = [];
      const serverErrors: string[] = [];

      page.on('pageerror', error => uncaught.push(error.message));
      page.on('response', response => {
        if (response.status() >= 500) {
          serverErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto(routePath);

      await expectContextConfigured(page);

      // Waiting on the heading is also the synchronization: React Query has resolved the
      // page queries when the final title is on screen.
      if (heading) {
        await expect(
          page.getByRole('heading', { name: heading, level: 1, exact: true })
        ).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }

      await expectNoErrorBoundary(page);

      expect(uncaught, `Eccezioni non gestite su ${routePath}`).toEqual([]);
      expect(
        serverErrors,
        `Risposte 5xx durante il caricamento di ${routePath}`
      ).toEqual([]);
    });
  }

  test('every app route is covered or declared uncovered', async () => {
    const covered = new Set(CRITICAL_ROUTES.map(r => r.path));
    const declared = new Set(Object.keys(UNCOVERED_ROUTES));

    const undeclared = discoverAppRoutes().filter(
      route => !covered.has(route) && !declared.has(route)
    );
    expect(
      undeclared,
      'New routes with no decision: add them to CRITICAL_ROUTES if they matter, ' +
        'or to UNCOVERED_ROUTES saying why not.'
    ).toEqual([]);

    // The opposite matters just as much: an entry that no longer matches a page is noise
    // pretending to be a coverage decision about something that does not exist.
    const existing = new Set(discoverAppRoutes());
    const stale = [...covered, ...declared].filter(r => !existing.has(r));
    expect(stale, 'Entries that match no page').toEqual([]);
  });

  test('the sidebar exposes the main navigation', async ({ page }) => {
    await page.goto('/dashboard');

    // If the sidebar does not mount, every other test would still pass via a direct goto
    // while the app is unusable with the mouse.
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole('link', { name: 'Dashboard' })
    ).toBeVisible();
  });
});
