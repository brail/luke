/**
 * encrypt-secret-config.ts
 *
 * One-shot data step for the release in which `SECRET_CONFIG_KEYS` made encryption mandatory for
 * credentials (`packages/core/src/schemas/config.ts`): every writer now stores those keys
 * encrypted, but a row an earlier release stored in plaintext stays so until it is rewritten. This
 * encrypts each such row in place, with the API's master key, and writes one audit row per key
 * (`source: 'cli'`). The logic and its checks are in `scripts/lib/secretConfigRows.ts`.
 *
 * Run it after a verified backup, with the same master key the API uses — it refuses when the key
 * file is missing or decrypts none of the rows already encrypted — and again after restoring a
 * backup taken before it. It prints keys and counts, never a value; a second run finds nothing.
 * Exits 1 when a row needs attention (a value its schema refuses, a row changed meanwhile, a write
 * that failed).
 *
 * Usage:
 *   In production, inside the API container (the image ships `dist-scripts`, the working directory
 *   is `/app/apps/api` and `DATABASE_URL` is already set; the database publishes no port):
 *     node dist-scripts/scripts/encrypt-secret-config.js [--dry-run]
 *   Against a local or tunnelled database, with DATABASE_URL in apps/api/.env:
 *     pnpm --filter @luke/api db:encrypt-secret-config [--dry-run]
 */

import { parseArgs } from 'util';

import { createScriptPrismaClient } from './lib/prisma.js';
import { EncryptSecretsRefused, encryptPlainSecretRows } from './lib/secretConfigRows.js';
import { describeTarget } from './lib/target.js';

async function main() {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } }, strict: true });
  const dryRun = values['dry-run'];
  const prisma = createScriptPrismaClient();

  try {
    console.log(`Target database: ${describeTarget(process.env.DATABASE_URL)}${dryRun ? ' (dry run)' : ''}`);
    const report = await encryptPlainSecretRows(prisma, { dryRun });

    console.log(`${dryRun ? 'Would encrypt' : 'Encrypted'}: ${report.encrypted.length}`);
    for (const key of report.encrypted) console.log(`  - ${key}`);
    if (report.invalid.length > 0) {
      console.log(`Left in plaintext, value refused by its schema (fix it, then re-run): ${report.invalid.length}`);
      for (const { key, message } of report.invalid) console.log(`  - ${key}: ${message}`);
    }
    if (report.changedConcurrently.length > 0) {
      console.log(`Changed while running, left alone (re-run): ${report.changedConcurrently.length}`);
      for (const key of report.changedConcurrently) console.log(`  - ${key}`);
    }
    if (report.failed.length > 0) {
      console.log(`Write failed, left in plaintext (re-run): ${report.failed.length}`);
      for (const key of report.failed) console.log(`  - ${key}`);
    }
    process.exitCode = report.invalid.length + report.changedConcurrently.length + report.failed.length > 0 ? 1 : 0;
  } catch (err) {
    if (!(err instanceof EncryptSecretsRefused)) throw err;
    console.error(`Refused, nothing written: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
