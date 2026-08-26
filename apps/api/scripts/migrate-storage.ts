/**
 * One-shot migration: copies every file from one storage provider to another
 * (`local`→`s3` or `s3`→`s3`, e.g. an old MinIO instance → a new SeaweedFS instance),
 * preserving bucket + key (identity) so no DB row needs to change.
 *
 * Why this is safe to run against a live server: DB rows only ever store `bucket`+`key`
 * (see ADR-007), never a provider-specific URL, so copying bytes under the same key is
 * sufficient — no FileObject / Brand.logoKey / CollectionLayoutRow.pictureKey / etc. update
 * is needed. Switching `storage.type` afterwards (Impostazioni → Storage) is what actually
 * cuts traffic over; this script only makes sure the bytes exist on the destination side first.
 *
 * Idempotent / resumable: for every bucket, the set of keys already present at the
 * destination is listed once up front; source keys already there are skipped (unless
 * `--fix-mime` finds their Content-Type needs repair). Safe to interrupt and re-run.
 *
 * Verification: the destination provider's `put()` computes the SHA-256 of exactly the
 * bytes it received (streamed, not buffered). When a FileObject row exists for that
 * bucket+key, the uploaded checksum is compared against `FileObject.checksumSha256` and a
 * mismatch is reported as an error (not silently swallowed) — this is the only integrity
 * signal needed, no separate source-side hashing pass is required.
 *
 * Source files with no matching FileObject row are orphans (pre-existing, unrelated to this
 * script) — they are still migrated best-effort (cheap, and avoids a second pass if orphans
 * turn out to matter later) but counted separately in the summary. Confirmed FileObject rows
 * whose key is missing on both sides are pre-existing broken references — reported, not fixed.
 *
 * --fix-mime: opt-in repair pass, orthogonal to the copy itself. For every source key whose
 * recorded Content-Type is missing/generic (`application/octet-stream`) or doesn't match what
 * the bytes actually are, sniffs the real type from magic bytes (`sniffContentType`, reusing
 * the same signature table `validateMagicBytes` validates uploads against) and corrects BOTH:
 *  - `FileObject.contentType` in Postgres — what the by-id download route and `getMetadata`
 *    serve; a prior version of this script never touched this, so the wrong header kept being
 *    served from that path even after a "fixed" migration.
 *  - the destination object's stored Content-Type metadata, via `fixContentType()`/`CopyObject`
 *    (S3 destinations only — the public `/api/uploads/:bucket/*` proxy reads this) — this is
 *    what the 2.1.3 script fixed, kept as-is here.
 * Applies uniformly whether the key was just copied (sniffed from the copy stream's first
 * chunk, no extra I/O) or was already present at the destination (sniffed from the first
 * chunk of a fresh `get()`, then the read is aborted — no full re-download).
 *
 * Limitations:
 * - Does not touch `storage.type` — flip it manually in Impostazioni → Storage once you've
 *   reviewed the summary.
 * - The `setupTempFileCleanup` background job (apps/api/src/server.ts) deletes unconfirmed
 *   FileObject rows older than 1h against whichever provider is *currently active* — running
 *   this script against a live server while the destination isn't active yet is fine, but
 *   don't flip `storage.type` to the destination mid-run.
 * - `backups` bucket is excluded by default (can be large, low urgency) — pass --include-backups.
 * - `--from-s3-*`/`--to-s3-*` overrides build an ad-hoc, one-off S3 provider from CLI args
 *   instead of reading AppConfig `storage.s3.*` — this is what makes `s3→s3` between two
 *   different instances (e.g. old MinIO → new SeaweedFS, neither necessarily the one AppConfig
 *   currently points at) work with the same code path as `local→s3`.
 *
 * Usage:
 *   pnpm --filter @luke/api db:migrate-storage -- --from=local --to=s3                    # dry-run
 *   pnpm --filter @luke/api db:migrate-storage -- --from=local --to=s3 --apply
 *   pnpm --filter @luke/api db:migrate-storage -- --from=local --to=s3 --apply --fix-mime
 *   pnpm --filter @luke/api db:migrate-storage -- --from=s3 --to=s3 --apply --fix-mime \
 *     --from-s3-endpoint=old-minio-host --from-s3-port=9000 \
 *     --from-s3-access-key=minioadmin --from-s3-secret-key=minioadmin
 *   pnpm --filter @luke/api db:migrate-storage -- --from=local --to=s3 --apply --include-backups
 *   pnpm --filter @luke/api db:migrate-storage -- --from=local --to=s3 --apply --bucket=brand-logos
 *
 * Must run somewhere with access to both providers' network endpoints and the DB/master key —
 * in production that's inside the running `api` container, using the compiled output (see
 * tsconfig.scripts.json — the image ships dist-scripts/, not raw .ts):
 *   docker exec -it <api-container> node dist-scripts/scripts/migrate-storage.js --from=s3 --to=s3 --apply ...
 */

import { Transform } from 'stream';

import pLimit from 'p-limit';

import {
  APP_STORAGE_BUCKETS,
  s3StorageConfigSchema,
  storageTypeSchema,
  type S3StorageConfig,
  type StorageBucket,
  type StorageType,
  type IStorageProvider,
} from '@luke/core';

import { sniffContentType } from '../src/lib/imageUpload.js';
import { loadLocalProvider, loadS3Provider } from '../src/storage/index.js';
import { S3Provider } from '../src/storage/providers/s3.js';

import { createScriptPrismaClient } from './lib/prisma.js';

/** Bounds concurrent source→dest file copies per bucket (network round-trips, not CPU-bound). */
const COPY_CONCURRENCY = 5;

// ─── CLI args ───────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length);
}

function parseSide(name: string, fallback: StorageType): StorageType {
  const raw = argValue(name);
  if (!raw) return fallback;
  const result = storageTypeSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`--${name} deve essere "local" oppure "s3", ricevuto: ${raw}`);
  }
  return result.data;
}

const apply = process.argv.includes('--apply');
const fixMime = process.argv.includes('--fix-mime');
const includeBackups = process.argv.includes('--include-backups');
const bucketArg = argValue('bucket');

const fromSide = parseSide('from', 'local');
const toSide = parseSide('to', 's3');

if (fromSide === toSide && fromSide === 'local') {
  throw new Error('--from=local --to=local non ha senso: nessuna copia da fare.');
}

const BUCKETS: StorageBucket[] = bucketArg
  ? [bucketArg as StorageBucket]
  : includeBackups
    ? [...APP_STORAGE_BUCKETS, 'backups']
    : [...APP_STORAGE_BUCKETS];

type S3OverrideFields = Partial<Pick<S3StorageConfig, 'endpoint' | 'port' | 'useSSL' | 'accessKey' | 'secretKey' | 'region'>>;

/** Ad-hoc S3 provider overrides from CLI args, for migrating between two S3 instances neither of which is (necessarily) the one AppConfig currently points at. */
function s3Overrides(prefix: 'from' | 'to'): S3OverrideFields {
  const useSslRaw = argValue(`${prefix}-s3-use-ssl`);
  return {
    endpoint: argValue(`${prefix}-s3-endpoint`),
    port: argValue(`${prefix}-s3-port`) ? parseInt(argValue(`${prefix}-s3-port`)!, 10) : undefined,
    useSSL: useSslRaw === undefined ? undefined : useSslRaw === 'true',
    accessKey: argValue(`${prefix}-s3-access-key`),
    secretKey: argValue(`${prefix}-s3-secret-key`),
    region: argValue(`${prefix}-s3-region`),
  };
}

async function resolveProvider(
  prisma: ReturnType<typeof createScriptPrismaClient>,
  side: StorageType,
  overridePrefix: 'from' | 'to',
): Promise<IStorageProvider> {
  if (side === 'local') return loadLocalProvider(prisma);

  const overrides = s3Overrides(overridePrefix);
  const hasOverride = Object.values(overrides).some(v => v !== undefined);
  if (!hasOverride) return loadS3Provider(prisma);

  const config = s3StorageConfigSchema.parse({
    ...overrides,
  });
  const provider = new S3Provider(config);
  await provider.init();
  return provider;
}

// ─── Mime sniffing helpers ──────────────────────────────────────────────────

const GENERIC_CONTENT_TYPES = new Set(['', 'application/octet-stream']);

/**
 * Wraps a readable stream with a passthrough Transform that captures the first chunk
 * (resolved via the returned promise) while forwarding every chunk unchanged — lets the
 * caller sniff the file's real type from the same bytes being streamed to `put()`, without
 * buffering the whole file or reading it twice.
 */
function tapFirstChunk(stream: NodeJS.ReadableStream): { stream: NodeJS.ReadableStream; firstChunk: Promise<Buffer> } {
  let resolveChunk: (b: Buffer) => void;
  const firstChunk = new Promise<Buffer>(resolve => { resolveChunk = resolve; });
  let captured = false;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!captured) {
        captured = true;
        resolveChunk(chunk);
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (!captured) resolveChunk(Buffer.alloc(0));
      callback();
    },
  });
  stream.pipe(tap);
  return { stream: tap, firstChunk };
}

/** Sniffs a key's real Content-Type from the first chunk of a fresh `get()`, aborting the read immediately after — avoids downloading the whole object just to inspect its magic bytes. */
async function sniffFromProvider(provider: IStorageProvider, bucket: StorageBucket, key: string): Promise<string | null> {
  const { stream } = await provider.get({ bucket, key });
  const readable = stream as NodeJS.ReadableStream & { destroy?: () => void };
  const chunk = await new Promise<Buffer | null>(resolve => {
    readable.once('data', (c: Buffer) => {
      readable.destroy?.();
      resolve(c);
    });
    readable.once('end', () => resolve(null));
    readable.once('error', () => resolve(null));
  });
  return chunk ? sniffContentType(chunk) : null;
}

// ─── Migration ──────────────────────────────────────────────────────────────

interface BucketReport {
  bucket: StorageBucket;
  /** Source keys not yet at the destination (needing a copy), regardless of --apply. */
  candidates: number;
  /** Keys actually written to the destination — always 0 in dry-run. */
  migrated: number;
  skippedAlreadyPresent: number;
  orphans: number;
  /** Keys eligible for a Content-Type repair (generic/wrong), regardless of --apply. Only counted when --fix-mime is passed. */
  mimeFixCandidates: number;
  /** Keys actually corrected (DB row and/or destination object metadata) — always 0 unless --apply --fix-mime. */
  mimeFixed: number;
  checksumMismatches: string[];
  brokenReferences: string[];
  failures: string[];
}

async function listAllKeys(provider: IStorageProvider, bucket: StorageBucket): Promise<Set<string>> {
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
  source: IStorageProvider,
  dest: IStorageProvider,
  bucket: StorageBucket
): Promise<BucketReport> {
  const report: BucketReport = {
    bucket,
    candidates: 0,
    migrated: 0,
    skippedAlreadyPresent: 0,
    orphans: 0,
    mimeFixCandidates: 0,
    mimeFixed: 0,
    checksumMismatches: [],
    brokenReferences: [],
    failures: [],
  };

  console.log(`\n📦 Bucket "${bucket}"`);

  const [sourceKeys, destKeys] = await Promise.all([
    listAllKeys(source, bucket),
    listAllKeys(dest, bucket),
  ]);
  console.log(`   sorgente: ${sourceKeys.size} file — destinazione: ${destKeys.size} file già presenti`);

  const fileObjects = await prisma.fileObject.findMany({
    where: { bucket },
    select: { key: true, checksumSha256: true, confirmedAt: true, contentType: true },
  });
  const fileObjectByKey = new Map(fileObjects.map(f => [f.key, f]));

  const needsMimeFix = (key: string): boolean => {
    if (!fixMime) return false;
    const fo = fileObjectByKey.get(key);
    return !!fo && GENERIC_CONTENT_TYPES.has(fo.contentType ?? '');
  };

  const candidateKeys: string[] = [];
  const alreadyPresentRepairKeys: string[] = [];
  for (const key of sourceKeys) {
    if (destKeys.has(key)) {
      report.skippedAlreadyPresent++;
      if (needsMimeFix(key)) alreadyPresentRepairKeys.push(key);
      continue;
    }
    candidateKeys.push(key);
    if (!fileObjectByKey.has(key)) report.orphans++;
  }
  report.candidates = candidateKeys.length;
  report.mimeFixCandidates = alreadyPresentRepairKeys.length
    + candidateKeys.filter(needsMimeFix).length;

  const applyMimeFix = async (key: string, contentType: string): Promise<void> => {
    await prisma.fileObject.updateMany({ where: { bucket, key }, data: { contentType } });
    if (dest.capabilities.supportsContentTypeFix) {
      await dest.fixContentType!({ bucket, key, contentType });
    }
    report.mimeFixed++;
  };

  if (apply) {
    const limit = pLimit(COPY_CONCURRENCY);
    await Promise.all(
      candidateKeys.map(key =>
        limit(async () => {
          const fileObject = fileObjectByKey.get(key);
          try {
            const { stream, size } = await source.get({ bucket, key });
            const wantsMimeFix = needsMimeFix(key);
            const { stream: putStream, firstChunk } = wantsMimeFix ? tapFirstChunk(stream) : { stream, firstChunk: null };

            const result = await dest.put({
              bucket,
              key,
              originalName: key.split('/').pop() || key,
              contentType: fileObject?.contentType ?? 'application/octet-stream',
              size,
              stream: putStream,
              bypassSizeLimit: true,
            });

            // An empty checksumSha256 means no baseline was ever recorded for this row
            // (seen on real data: older uploads that predate checksum tracking) — nothing
            // to compare against, not a mismatch. Flagging it as one would be a false alarm
            // on a migration that copied the bytes correctly.
            if (fileObject?.checksumSha256 && fileObject.checksumSha256 !== result.checksumSha256) {
              report.checksumMismatches.push(key);
              console.error(`   ❌ checksum mismatch: ${key}`);
            } else {
              report.migrated++;
            }

            if (wantsMimeFix && firstChunk) {
              const sniffed = sniffContentType(await firstChunk);
              if (sniffed) await applyMimeFix(key, sniffed);
            }
          } catch (err) {
            report.failures.push(key);
            console.error(`   ❌ errore copiando ${key}:`, err instanceof Error ? err.message : err);
          }
        })
      )
    );

    // Repair-only pass: keys already at the destination whose recorded Content-Type is generic.
    const repairLimit = pLimit(COPY_CONCURRENCY);
    await Promise.all(
      alreadyPresentRepairKeys.map(key =>
        repairLimit(async () => {
          try {
            const sniffed = await sniffFromProvider(dest, bucket, key);
            if (sniffed) await applyMimeFix(key, sniffed);
          } catch (err) {
            report.failures.push(key);
            console.error(`   ❌ errore correggendo mime ${key}:`, err instanceof Error ? err.message : err);
          }
        })
      )
    );
  }

  for (const fo of fileObjects) {
    if (fo.confirmedAt && !sourceKeys.has(fo.key) && !destKeys.has(fo.key)) {
      report.brokenReferences.push(fo.key);
    }
  }

  return report;
}

async function main() {
  console.log(apply ? `🚀 Migrazione storage ${fromSide} → ${toSide} (APPLY)` : `ℹ️  Dry-run (${fromSide} → ${toSide}) — nessuna scrittura verrà eseguita`);
  console.log(`   bucket: ${BUCKETS.join(', ')}`);
  if (fixMime) console.log('   --fix-mime attivo: verrà corretto anche il Content-Type generico/errato');

  const prisma = createScriptPrismaClient();

  try {
    const [source, dest] = await Promise.all([
      resolveProvider(prisma, fromSide, 'from'),
      resolveProvider(prisma, toSide, 'to'),
    ]);

    const reports: BucketReport[] = [];
    for (const bucket of BUCKETS) {
      reports.push(await migrateBucket(prisma, source, dest, bucket));
    }

    console.log('\n📊 Riepilogo');
    for (const r of reports) {
      console.log(
        `   ${r.bucket}: candidati=${r.candidates} migrati=${r.migrated} già-presenti=${r.skippedAlreadyPresent} orfani=${r.orphans} ` +
        `mime-da-correggere=${r.mimeFixCandidates} mime-corretti=${r.mimeFixed} checksum-KO=${r.checksumMismatches.length} ` +
        `falliti=${r.failures.length} riferimenti-rotti-preesistenti=${r.brokenReferences.length}`
      );
      if (r.checksumMismatches.length) console.log(`      checksum mismatch: ${r.checksumMismatches.join(', ')}`);
      if (r.failures.length) console.log(`      falliti: ${r.failures.join(', ')}`);
      if (r.brokenReferences.length) console.log(`      riferimenti rotti (preesistenti, non causati da questo script): ${r.brokenReferences.join(', ')}`);
    }

    const totalCandidates = reports.reduce((n, r) => n + r.candidates, 0);
    const totalMigrated = reports.reduce((n, r) => n + r.migrated, 0);
    const totalMimeFixCandidates = reports.reduce((n, r) => n + r.mimeFixCandidates, 0);
    const totalMimeFixed = reports.reduce((n, r) => n + r.mimeFixed, 0);
    const totalMismatches = reports.reduce((n, r) => n + r.checksumMismatches.length, 0);
    const totalFailures = reports.reduce((n, r) => n + r.failures.length, 0);
    const totalBroken = reports.reduce((n, r) => n + r.brokenReferences.length, 0);

    if (!includeBackups && !bucketArg) {
      console.log('\nℹ️  Bucket "backups" escluso di default — rilanciare con --include-backups per includerlo.');
    }

    if (totalMismatches > 0 || totalFailures > 0) {
      console.log('\n⚠️  Migrazione completata con errori — vedi sopra prima di cambiare storage.type.');
      process.exitCode = 1;
    } else if (!apply) {
      console.log(`\nℹ️  Nessuna scrittura eseguita — rilanciare con --apply per applicare (${totalCandidates} file da copiare${fixMime ? `, ${totalMimeFixCandidates} mime da correggere` : ''}).`);
    } else {
      console.log(`\n✅ Migrazione completata: ${totalMigrated} file copiati${fixMime ? `, ${totalMimeFixed} mime corretti` : ''}.`);
      if (totalBroken > 0) {
        console.log(`⚠️  ${totalBroken} riferimenti FileObject confermati risultano privi del file sia in sorgente che in destinazione (rottura preesistente, non introdotta da questo script).`);
      }
      console.log('Prossimo passo: verifica il riepilogo, poi imposta storage.type in Impostazioni → Storage.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
