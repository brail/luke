/**
 * check-config-rows.ts
 *
 * One-shot, read-only report to run once against production when deploying the release in which
 * `config.delete` started refusing keys outside `CONFIG_ROUTER_PREFIXES` (see
 * `packages/core/src/schemas/config.ts`). Before it, the generic settings page could delete any
 * row; after it, a row outside those prefixes can be removed only by the router that owns it or by
 * a data step. That is harmless for a registered key, which its own settings page manages, and a
 * dead end for a row the registry no longer declares: nothing in the application reads it, and
 * nothing in the application can remove it any more.
 *
 * It reports, by key only, never by value:
 * - rows outside the prefixes that the registry does not declare — the ones that need a decision;
 * - rows under the prefixes that the registry does not declare — still deletable from the page;
 * - whether `app.baseUrl` is stored: when it is not, every link in outgoing email already points
 *   at its default, `http://localhost:3000`.
 *
 * Exits 1 when either of the first or the last needs attention, 0 otherwise.
 *
 * Usage:
 *   In production, inside the API container (the image ships `dist-scripts`, the working directory
 *   is `/app/apps/api` and `DATABASE_URL` is already set; the database publishes no port):
 *     node dist-scripts/scripts/check-config-rows.js
 *   Against a local or tunnelled database, with DATABASE_URL in apps/api/.env:
 *     pnpm --filter @luke/api db:check-config-rows
 */

import { isAppConfigKey, isConfigRouterKey } from '@luke/core';

import { createScriptPrismaClient } from './lib/prisma.js';

/** Host and database of the connection string, without credentials, so the report names its target. */
function describeTarget(url: string | undefined): string {
  if (!url) return '(DATABASE_URL not set)';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

function printKeys(title: string, keys: string[]): void {
  console.log(`\n${title}: ${keys.length}`);
  for (const key of keys) console.log(`  - ${key}`);
}

async function main() {
  const prisma = createScriptPrismaClient();

  try {
    console.log(`Target database: ${describeTarget(process.env.DATABASE_URL)}`);

    const keys = (await prisma.appConfig.findMany({ select: { key: true }, orderBy: { key: 'asc' } }))
      .map(row => row.key);
    const unregistered = keys.filter(key => !isAppConfigKey(key));
    const strandedOrphans = unregistered.filter(key => !isConfigRouterKey(key));
    const deletableOrphans = unregistered.filter(key => isConfigRouterKey(key));
    const ownedElsewhere = keys.filter(key => isAppConfigKey(key) && !isConfigRouterKey(key));
    const hasBaseUrl = keys.includes('app.baseUrl');

    console.log(`AppConfig rows: ${keys.length}`);
    console.log(`Registered keys another router owns (managed on their own pages): ${ownedElsewhere.length}`);
    printKeys(
      'Unregistered rows outside the router prefixes (the settings page can no longer delete them)',
      strandedOrphans
    );
    printKeys('Unregistered rows under the router prefixes (still deletable from the settings page)', deletableOrphans);
    console.log(
      `\napp.baseUrl: ${hasBaseUrl ? 'stored' : 'NOT stored — email links currently use http://localhost:3000'}`
    );

    const attention = strandedOrphans.length > 0 || !hasBaseUrl;
    console.log(
      attention
        ? '\nACTION NEEDED: decide on each stranded row (a data step removes it) and/or set app.baseUrl from the mail settings page.'
        : '\nOK: nothing needs a decision.'
    );
    process.exitCode = attention ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
