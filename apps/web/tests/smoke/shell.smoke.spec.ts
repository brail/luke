import { readdirSync } from 'fs';
import path from 'path';

import { test, expect } from '@playwright/test';

import {
  expectContextConfigured,
  expectNoErrorBoundary,
} from '../support/smoke';

/**
 * Rotte critiche e il loro `h1`. `null` dove il titolo è dinamico (la dashboard
 * saluta l'utente e cambia con l'ora): lì basta che un h1 esista.
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
 * Rotte deliberatamente fuori dallo sweep, con il motivo.
 *
 * Esiste per rendere la scelta esplicita: senza questa lista, una pagina nuova
 * entrerebbe in silenzio nell'insieme "non coperto" e nessuno se ne accorgerebbe
 * — che è esattamente come la suite E2E precedente è rimasta rotta per mesi.
 * Aggiungere una pagina ora obbliga a decidere: o è critica, o si dichiara
 * perché non lo è.
 */
const UNCOVERED_ROUTES: Record<string, string> = {
  '/about': 'pagina statica, nessuna query',
  '/profile': 'coperta indirettamente dal logout in auth.smoke',
  '/notifications': 'nessun dato seedato deterministico',
  '/admin/calendar-configuration': 'config admin, poco traffico',
  '/admin/collection-layout-configuration': 'config admin, poco traffico',
  '/admin/phase-catalog': 'config admin, poco traffico',
  '/admin/vendors': 'stesso pattern CRUD di /admin/brands, già coperto',
  '/maintenance': 'indice, solo link',
  '/maintenance/backup': 'operazioni distruttive, non adatte a uno smoke',
  '/maintenance/config': 'operazioni distruttive, non adatte a uno smoke',
  '/maintenance/import-export': 'operazioni distruttive, non adatte a uno smoke',
  '/maintenance/mode': 'attiva la manutenzione: bloccherebbe il resto della suite',
  '/product/collection-layout/revisions': 'richiede revisioni preesistenti',
  '/product/control': 'richiede dati di collezione seedati',
  '/product/merchandising-plan': 'richiede dati di collezione seedati',
  '/sales/statistics': 'richiede dati NAV sincronizzati',
  '/settings/collection-control': 'config, nessuna query pesante',
  '/settings/company': 'config, nessuna query pesante',
  '/settings/google': 'config con credenziali esterne',
  '/settings/ldap': 'config con credenziali esterne',
  '/settings/mail': 'config con credenziali esterne',
  '/settings/nav': 'config con credenziali esterne',
  '/settings/nav-sync': 'avvia sincronizzazioni reali verso NAV',
  '/settings/storage': 'config, nessuna query pesante',
};

/** Ricava le rotte statiche del gruppo `(app)` dall'albero dei file. */
function discoverAppRoutes(): string[] {
  const root = path.join(__dirname, '..', '..', 'src', 'app', '(app)');
  const routes: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // I segmenti dinamici (`[revisionId]`) non hanno un URL raggiungibile
        // senza dati: fuori dal confronto, insieme ai loro discendenti.
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
 * Sweep delle rotte critiche.
 *
 * È lo smoke con il rapporto valore/costo più alto della suite: lint e
 * typecheck non vedono un contratto tRPC cambiato solo da un lato, un dist
 * stale di `@luke/core`, o un componente client marcato server. Tutti e tre si
 * manifestano allo stesso modo — la pagina che esplode al primo caricamento —
 * e tutti e tre arrivano in produzione se nessuno apre quella pagina prima del
 * tag.
 */
test.describe('smoke: shell applicativa', () => {
  for (const { path: routePath, heading } of CRITICAL_ROUTES) {
    test(`${routePath} si carica senza errori`, async ({ page }) => {
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

      // L'attesa sull'heading è anche la sincronizzazione: React Query ha
      // risolto le query della pagina quando il titolo definitivo è a schermo.
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

  test('ogni rotta dell\'app è coperta o dichiarata scoperta', async () => {
    const covered = new Set(CRITICAL_ROUTES.map(r => r.path));
    const declared = new Set(Object.keys(UNCOVERED_ROUTES));

    const undeclared = discoverAppRoutes().filter(
      route => !covered.has(route) && !declared.has(route)
    );
    expect(
      undeclared,
      'Rotte nuove senza decisione: aggiungile a CRITICAL_ROUTES se contano, ' +
        'oppure a UNCOVERED_ROUTES spiegando perché no.'
    ).toEqual([]);

    // Il contrario è altrettanto importante: una voce che non corrisponde più a
    // una pagina è rumore che finge copertura decisa su qualcosa che non esiste.
    const existing = new Set(discoverAppRoutes());
    const stale = [...covered, ...declared].filter(r => !existing.has(r));
    expect(stale, 'Voci che non corrispondono a nessuna pagina').toEqual([]);
  });

  test('la sidebar espone la navigazione principale', async ({ page }) => {
    await page.goto('/dashboard');

    // Se la sidebar non monta, ogni altro test passerebbe comunque via goto
    // diretta mentre l'app è inutilizzabile con il mouse.
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole('link', { name: 'Dashboard' })
    ).toBeVisible();
  });
});
