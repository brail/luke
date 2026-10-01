/**
 * repair-auto-revision-photos.ts
 *
 * One-shot repair to run against production right after deploying the release in which automatic
 * Collection Layout revisions started copying row photos into the immutable revisions bucket. The
 * automatic revisions created by v2.0.0–v2.1.x hold the live row-picture key: no revision reader
 * looks there, and replacing a row photo deletes the object — so every photo replaced before this
 * runs is one more photo gone. See `src/services/autoRevisionPhotoRepair.service.ts`.
 *
 * Dry run by default: classifies every key and writes nothing. With `--apply` it copies each
 * recoverable photo, repoints the revision rows and writes one audit row per revision and key
 * (`COLLECTION_LAYOUT_REVISION_PHOTO_REPAIR`, with this run's id). Running it again is safe.
 *
 * Exits 0 only when nothing is left to repair, unrecoverable or in error.
 *
 * Usage:
 *   In production, inside the API container (the image ships `dist-scripts`, the working directory
 *   is `/app/apps/api` and `DATABASE_URL` is already set; the database publishes no port):
 *     node dist-scripts/scripts/repair-auto-revision-photos.js [--apply]
 *   Against a local or tunnelled database, with DATABASE_URL in apps/api/.env:
 *     pnpm --filter @luke/api db:repair-auto-revision-photos [--apply]
 */

import { randomUUID } from 'crypto';

import { repairAutoRevisionPhotos } from '../src/services/autoRevisionPhotoRepair.service.js';

import { createScriptPrismaClient } from './lib/prisma.js';
import { describeTarget } from './lib/target.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = createScriptPrismaClient();
  try {
    console.log(`Target database: ${describeTarget(process.env.DATABASE_URL)}`);
    const report = await repairAutoRevisionPhotos(prisma, { apply, runId: randomUUID() });
    console.log(`Run ${report.runId} — ${apply ? 'APPLY' : 'dry run, nothing written'}`);

    const count = (outcome: string) => report.keys.filter(k => k.outcome === outcome).length;
    console.log(`Photo keys of automatic revisions: ${report.keys.length}`);
    console.log(`  already immutable: ${count('immutable')}`);
    console.log(`  ${apply ? 'repaired' : 'repairable'}: ${count(apply ? 'repaired' : 'repairable')}`);
    console.log(`  not recoverable from current storage: ${count('not-recoverable')}`);
    console.log(`  error: ${count('error')}`);

    for (const k of report.keys) {
      if (k.outcome === 'not-recoverable') {
        console.log(`  - not recoverable ${k.key} (revisions ${k.revisionIds.join(', ')})`);
      } else if (k.outcome === 'error') {
        console.log(`  - error ${k.key}: ${k.reason} (revisions ${k.revisionIds.join(', ')})`);
      }
    }

    const pending = count('repairable') + count('not-recoverable') + count('error');
    process.exitCode = pending > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
