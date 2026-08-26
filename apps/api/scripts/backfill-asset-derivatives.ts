/**
 * backfill-asset-derivatives.ts
 *
 * Drives generation of thumb/card/export derivatives for image masters uploaded
 * before the asset pipeline existed. No separate marking step is needed: the
 * `derivativesStatus` column was added with `DEFAULT 'PENDING'`, so every
 * pre-existing row already qualifies — the periodic reconcile tick in
 * `lib/assets/derivativeWorker.ts` would pick all of them up on its own, 200 every
 * 5 minutes. This script exists to (a) report the backlog size up front, so a
 * large unknown production volume can be sized before enabling the pipeline, and
 * (b) drive it faster than the passive tick when explicitly asked to.
 *
 * Reuses `processMaster` directly — the exact function the reconcile tick and
 * every upload's `enqueueDerivatives` call — so there is no second implementation
 * of the pipeline to keep in sync.
 *
 * Usage:
 *   pnpm --filter @luke/api db:backfill-asset-derivatives [--dry-run]
 */

import { BUCKET_TO_ASSET_KIND, IMAGE_BUCKETS, type StorageBucket } from '@luke/core';

import { processMaster } from '../src/lib/assets/derivativeWorker.js';

import { createScriptPrismaClient } from './lib/prisma.js';

const MAX_ATTEMPTS = 5;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();

  try {
    const backlog = await prisma.fileObject.findMany({
      where: {
        parentId: null,
        bucket: { in: IMAGE_BUCKETS as string[] },
        derivativesStatus: { in: ['PENDING', 'FAILED'] },
        derivativeAttempts: { lt: MAX_ATTEMPTS },
      },
      select: { id: true, bucket: true, size: true },
    });

    if (backlog.length === 0) {
      console.log('✅ Nessun master in attesa di derivate: niente da fare.');
      return;
    }

    const totalSize = backlog.reduce((sum, f) => sum + f.size, 0);
    const byBucket = new Map<string, number>();
    for (const f of backlog) byBucket.set(f.bucket, (byBucket.get(f.bucket) ?? 0) + 1);

    console.log(`🔍 ${backlog.length} master in attesa di derivate (${formatBytes(totalSize)} totali):`);
    for (const [bucket, count] of byBucket) {
      console.log(`  ${bucket}: ${count}`);
    }

    if (dryRun) {
      console.log('\n🧪 Dry run: nessuna elaborazione. Rilanciare senza --dry-run per generare le derivate.');
      return;
    }

    console.log('');
    let done = 0;
    let failed = 0;
    for (const file of backlog) {
      try {
        await processMaster(prisma, file.id, console);
        done++;
      } catch (err) {
        failed++;
        console.error(`  ❌ ${BUCKET_TO_ASSET_KIND[file.bucket as StorageBucket] ?? file.bucket}/${file.id}:`, err);
      }
      if ((done + failed) % 50 === 0) {
        console.log(`  … ${done + failed}/${backlog.length}`);
      }
    }

    console.log(`\n✅ ${done} master elaborati, ${failed} falliti su ${backlog.length}.`);
    console.log('Lo stato finale di ciascun master (READY / PENDING / FAILED) è in FileObject.derivativesStatus.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
