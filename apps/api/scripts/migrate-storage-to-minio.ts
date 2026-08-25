/**
 * One-shot migration: copies every file from the local filesystem storage provider
 * to the MinIO provider, preserving bucket + key (identity) so no DB row needs to change.
 *
 * Why this is safe to run against a live server: DB rows only ever store `bucket`+`key`
 * (see ADR-007), never a provider-specific URL, so copying bytes under the same key is
 * sufficient — no FileObject / Brand.logoKey / CollectionLayoutRow.pictureKey / etc. update
 * is needed. Switching `storage.type` to `minio` afterwards (Impostazioni → Storage) is what
 * actually cuts traffic over; this script only makes sure the bytes exist on the MinIO side
 * first.
 *
 * Idempotent / resumable: for every bucket, the set of keys already present in MinIO is
 * listed once up front; local files whose key is already there are skipped. Safe to
 * interrupt and re-run.
 *
 * Verification: MinioProvider.put() computes the SHA-256 of exactly the bytes it received
 * (streamed, not buffered). When a FileObject row exists for that bucket+key, the uploaded
 * checksum is compared against `FileObject.checksumSha256` and a mismatch is reported as an
 * error (not silently swallowed) — this is the only integrity signal needed, no separate
 * local-side hashing pass is required.
 *
 * Local files with no matching FileObject row are orphans (pre-existing, unrelated to this
 * script) — they are still migrated best-effort (cheap, and avoids a second pass if orphans
 * turn out to matter later) but counted separately in the summary. Confirmed FileObject rows
 * whose key is missing on disk are pre-existing broken references — reported, not fixed here.
 *
 * Limitations:
 * - Does not touch `storage.type` — flip it manually in Impostazioni → Storage once you've
 *   reviewed the summary.
 * - The `setupTempFileCleanup` background job (apps/api/src/server.ts) deletes unconfirmed
 *   FileObject rows older than 1h against whichever provider is *currently active* — running
 *   this script against a live server while it's still on `local` is fine (cleanup targets
 *   local), but don't flip `storage.type` to `minio` mid-run.
 * - `backups` bucket is excluded by default (can be large, low urgency) — pass --include-backups.
 * - Content-Type is not preserved: LocalFsProvider never recorded it, so every migrated
 *   object is uploaded as `application/octet-stream` (matches existing readFileBuffer/get
 *   behavior — not a regression introduced by this script).
 *
 * Usage:
 *   pnpm --filter @luke/api db:migrate-storage-to-minio                    # dry-run
 *   pnpm --filter @luke/api db:migrate-storage-to-minio -- --apply         # actually copies
 *   pnpm --filter @luke/api db:migrate-storage-to-minio -- --apply --include-backups
 *   pnpm --filter @luke/api db:migrate-storage-to-minio -- --apply --bucket=brand-logos
 *
 * Must run somewhere with access to both the local storage volume (`storage.local.basePath`)
 * and the DB/master key — in production that's inside the running `api` container:
 *   docker exec -it <api-container> node_modules/.bin/tsx scripts/migrate-storage-to-minio.ts --apply
 */

import pLimit from 'p-limit';

import { APP_STORAGE_BUCKETS, type StorageBucket } from '@luke/core';

import { loadLocalProvider, loadMinioProvider } from '../src/storage';

import { createScriptPrismaClient } from './lib/prisma';

import type { LocalFsProvider } from '../src/storage/providers/local';
import type { MinioProvider } from '../src/storage/providers/minio';

/** Bounds concurrent local→MinIO file copies per bucket (network round-trips, not CPU-bound). */
const COPY_CONCURRENCY = 5;

const apply = process.argv.includes('--apply');
const includeBackups = process.argv.includes('--include-backups');
const bucketArg = process.argv.find(a => a.startsWith('--bucket='))?.split('=')[1];

const BUCKETS: StorageBucket[] = bucketArg
  ? [bucketArg as StorageBucket]
  : includeBackups
    ? [...APP_STORAGE_BUCKETS, 'backups']
    : [...APP_STORAGE_BUCKETS];

interface BucketReport {
  bucket: StorageBucket;
  /** Local keys not yet in MinIO (needing a copy), regardless of --apply. */
  candidates: number;
  /** Keys actually written to MinIO — always 0 in dry-run. */
  migrated: number;
  skippedAlreadyPresent: number;
  orphans: number;
  checksumMismatches: string[];
  brokenReferences: string[];
  failures: string[];
}

async function listAllKeys(
  provider: LocalFsProvider | MinioProvider,
  bucket: StorageBucket
): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await provider.list({ bucket, cursor, limit: 1000 });
    for (const item of page.items) keys.add(item.key);
    cursor = page.nextCursor;
  } while (cursor);
  return keys;
}

async function migrateBucket(
  prisma: ReturnType<typeof createScriptPrismaClient>,
  local: LocalFsProvider,
  minio: MinioProvider,
  bucket: StorageBucket
): Promise<BucketReport> {
  const report: BucketReport = {
    bucket,
    candidates: 0,
    migrated: 0,
    skippedAlreadyPresent: 0,
    orphans: 0,
    checksumMismatches: [],
    brokenReferences: [],
    failures: [],
  };

  console.log(`\n📦 Bucket "${bucket}"`);

  const [localKeys, minioKeys] = await Promise.all([
    listAllKeys(local, bucket),
    listAllKeys(minio, bucket),
  ]);
  console.log(`   locale: ${localKeys.size} file — minio: ${minioKeys.size} file già presenti`);

  const fileObjects = await prisma.fileObject.findMany({
    where: { bucket },
    select: { key: true, checksumSha256: true, confirmedAt: true },
  });
  const fileObjectByKey = new Map(fileObjects.map(f => [f.key, f]));

  const candidateKeys: string[] = [];
  for (const key of localKeys) {
    if (minioKeys.has(key)) {
      report.skippedAlreadyPresent++;
      continue;
    }
    candidateKeys.push(key);
    if (!fileObjectByKey.has(key)) report.orphans++;
  }
  report.candidates = candidateKeys.length;

  if (apply) {
    const limit = pLimit(COPY_CONCURRENCY);
    await Promise.all(
      candidateKeys.map(key =>
        limit(async () => {
          const fileObject = fileObjectByKey.get(key);
          try {
            const { stream, size } = await local.get({ bucket, key });
            const result = await minio.put({
              bucket,
              key,
              originalName: key.split('/').pop() || key,
              contentType: 'application/octet-stream',
              size,
              stream,
              bypassSizeLimit: true,
            });

            if (fileObject && fileObject.checksumSha256 !== result.checksumSha256) {
              report.checksumMismatches.push(key);
              console.error(`   ❌ checksum mismatch: ${key}`);
            } else {
              report.migrated++;
            }
          } catch (err) {
            report.failures.push(key);
            console.error(`   ❌ errore copiando ${key}:`, err instanceof Error ? err.message : err);
          }
        })
      )
    );
  }

  for (const fo of fileObjects) {
    if (fo.confirmedAt && !localKeys.has(fo.key) && !minioKeys.has(fo.key)) {
      report.brokenReferences.push(fo.key);
    }
  }

  return report;
}

async function main() {
  console.log(apply ? '🚀 Migrazione storage locale → MinIO (APPLY)' : 'ℹ️  Dry-run — nessuna scrittura verrà eseguita');
  console.log(`   bucket: ${BUCKETS.join(', ')}`);

  const prisma = createScriptPrismaClient();

  try {
    const local = await loadLocalProvider(prisma);
    const minio = await loadMinioProvider(prisma);

    const reports: BucketReport[] = [];
    for (const bucket of BUCKETS) {
      reports.push(await migrateBucket(prisma, local, minio, bucket));
    }

    console.log('\n📊 Riepilogo');
    for (const r of reports) {
      console.log(
        `   ${r.bucket}: candidati=${r.candidates} migrati=${r.migrated} già-presenti=${r.skippedAlreadyPresent} orfani=${r.orphans} ` +
        `checksum-KO=${r.checksumMismatches.length} falliti=${r.failures.length} riferimenti-rotti-preesistenti=${r.brokenReferences.length}`
      );
      if (r.checksumMismatches.length) console.log(`      checksum mismatch: ${r.checksumMismatches.join(', ')}`);
      if (r.failures.length) console.log(`      falliti: ${r.failures.join(', ')}`);
      if (r.brokenReferences.length) console.log(`      riferimenti rotti (preesistenti, non causati da questo script): ${r.brokenReferences.join(', ')}`);
    }

    const totalCandidates = reports.reduce((n, r) => n + r.candidates, 0);
    const totalMigrated = reports.reduce((n, r) => n + r.migrated, 0);
    const totalMismatches = reports.reduce((n, r) => n + r.checksumMismatches.length, 0);
    const totalFailures = reports.reduce((n, r) => n + r.failures.length, 0);
    const totalBroken = reports.reduce((n, r) => n + r.brokenReferences.length, 0);

    if (!includeBackups && !bucketArg) {
      console.log('\nℹ️  Bucket "backups" escluso di default — rilanciare con --include-backups per includerlo.');
    }

    if (totalMismatches > 0 || totalFailures > 0) {
      console.log('\n⚠️  Migrazione completata con errori — vedi sopra prima di cambiare storage.type su minio.');
      process.exitCode = 1;
    } else if (!apply) {
      console.log(`\nℹ️  Nessuna scrittura eseguita — rilanciare con --apply per applicare (${totalCandidates} file da copiare).`);
    } else {
      console.log(`\n✅ Migrazione completata: ${totalMigrated} file copiati su MinIO.`);
      if (totalBroken > 0) {
        console.log(`⚠️  ${totalBroken} riferimenti FileObject confermati risultano privi del file sia in locale che su MinIO (rottura preesistente, non introdotta da questo script).`);
      }
      console.log('Prossimo passo: verifica il riepilogo, poi imposta storage.type=minio in Impostazioni → Storage.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
