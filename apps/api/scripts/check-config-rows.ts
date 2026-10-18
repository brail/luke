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
 * - registered rows whose stored value their schema refuses (an upgrade can leave one behind:
 *   2.1.6 stored `storage.type = minio`, which 3.0 refuses), with the schema's message; a row
 *   stored as `''` is listed apart, since that is how 2.1.6 recorded "not configured"; encrypted
 *   rows are counted, not checked, since that would need the master key;
 * - whether `app.baseUrl` is stored: when it is not, every link in outgoing email already points
 *   at its default, `http://localhost:3000`.
 *
 * Exits 1 when the first, the third or the last needs attention, 0 otherwise.
 *
 * Usage:
 *   In production, inside the API container (the image ships `dist-scripts`, the working directory
 *   is `/app/apps/api` and `DATABASE_URL` is already set; the database publishes no port):
 *     node dist-scripts/scripts/check-config-rows.js
 *   Against a local or tunnelled database, with DATABASE_URL in apps/api/.env:
 *     pnpm --filter @luke/api db:check-config-rows
 */

import { checkConfigRows } from './lib/configRows.js';
import { createScriptPrismaClient } from './lib/prisma.js';
import { describeTarget } from './lib/target.js';

function printKeys(title: string, keys: string[]): void {
  console.log(`\n${title}: ${keys.length}`);
  for (const key of keys) console.log(`  - ${key}`);
}

async function main() {
  const prisma = createScriptPrismaClient();

  try {
    console.log(`Target database: ${describeTarget(process.env.DATABASE_URL)}`);

    const report = checkConfigRows(
      await prisma.appConfig.findMany({ select: { key: true, value: true, isEncrypted: true }, orderBy: { key: 'asc' } })
    );

    console.log(`AppConfig rows: ${report.total}`);
    console.log(`Registered keys another router owns (managed on their own pages): ${report.ownedElsewhere}`);
    printKeys(
      'Unregistered rows outside the router prefixes (the settings page can no longer delete them)',
      report.strandedOrphans
    );
    printKeys('Unregistered rows under the router prefixes (still deletable from the settings page)', report.deletableOrphans);
    printKeys(
      'Registered rows whose value their schema refuses (the application rejects or ignores it)',
      report.invalid.map(({ key, message }) => `${key}: ${message}`)
    );
    printKeys(
      "Registered rows stored as '' (2.1.6's \"not configured\"; harmless, deletable to tidy up)",
      report.emptyStored
    );
    console.log(`Encrypted rows not checked (needs the master key): ${report.encryptedSkipped}`);
    console.log(
      `\napp.baseUrl: ${report.hasBaseUrl ? 'stored' : 'NOT stored — email links currently use http://localhost:3000'}`
    );

    console.log(
      report.attention
        ? '\nACTION NEEDED: decide on each stranded row (a data step removes it), correct each refused value from its settings page, and/or set app.baseUrl from the mail settings page.'
        : '\nOK: nothing needs a decision.'
    );
    process.exitCode = report.attention ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
