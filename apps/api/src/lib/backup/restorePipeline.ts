/**
 * Full-system restore engine: streamed download from the "backups" bucket → AES-256-GCM decrypt
 * → gunzip → untar, staged entirely to local disk, then `pg_restore` + (optionally) file replay.
 *
 * Extraction is staged to local disk in full before any destructive step runs, for two reasons:
 * 1. The source blob stream (especially from MinIO) is not something we want to hold open for the
 *    full duration of a potentially multi-minute `pg_restore` — read it to completion promptly.
 * 2. It lets the DB restore run to completion (or fail) before any file is touched, so a failed
 *    `pg_restore` never leaves storage files partially overwritten — only the DB was touched.
 *
 * Unlike `runBackupJob`, this function DOES throw on failure — restore has no record of its own
 * to swallow errors into, and the caller (router) must know synchronously whether it succeeded,
 * e.g. to decide whether to keep Maintenance Mode active for the admin to investigate.
 *
 * Tar entry names are never trusted as filesystem paths (classic tar-extraction path-traversal
 * risk): the `db.dump` entry always stages to a fixed constant path, and `files/*` entries stage
 * under synthetic index-based filenames — the real bucket/key (parsed from the entry name) is only
 * ever used as the logical destination for the final, path-safety-checked `provider.put()` call.
 */

import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { finished, pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';

import { APP_STORAGE_BUCKETS, type IStorageProvider, type StorageBucket } from '@luke/core';

import { getStorageProvider } from '../../storage';

import { createArchiveExtractor, forEachArchiveEntry } from './archiveFormat';
import { createBackupDecipher, unwrapDek } from './crypto';
import { parseDatabaseUrl, runPgBinary } from './pgConnection';

import type { BackupLogger } from './dumpPipeline';
import type { PrismaClient } from '@prisma/client';

const TEMP_DIR = join(homedir(), '.luke', 'restore-tmp');

interface StagedFileEntry {
  bucket: StorageBucket;
  key: string;
  stagedPath: string;
  size: number;
}

/**
 * Runs `pg_restore` against the current database from a local dump file.
 * Deliberately strict: any non-zero exit (pg_restore can exit 1 even for warnings, e.g. skipped
 * GRANT/OWNER statements under --no-owner) is treated as failure. For a disaster-recovery tool, a
 * false "failed" that the admin has to double-check via stderr is far preferable to a false
 * "succeeded" on a restore that silently had issues.
 */
async function restoreDatabaseFromFile(dumpPath: string, excludeAuditLog: boolean): Promise<void> {
  const db = parseDatabaseUrl();
  await runPgBinary('pg_restore', [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--host', db.host,
    '--port', db.port,
    '--username', db.user,
    '--dbname', db.database,
    ...(excludeAuditLog ? ['--exclude-table=public.audit_logs'] : []),
    dumpPath,
  ], db.password);
}

/** Parses a `files/<bucket>/<key...>` tar entry name. Returns `null` if the bucket isn't recognized. */
function parseFileEntryName(name: string): { bucket: StorageBucket; key: string } | null {
  const match = /^files\/([^/]+)\/(.+)$/.exec(name);
  if (!match) return null;
  const [, bucket, key] = match;
  if (!(APP_STORAGE_BUCKETS as readonly string[]).includes(bucket)) return null;
  return { bucket: bucket as StorageBucket, key };
}

export interface RunRestoreJobParams {
  prisma: PrismaClient;
  /** Storage key of the encrypted blob in the "backups" bucket. */
  filename: string;
  /** Crypto metadata, resolved by the caller from either `BackupRecord` or a sidecar `.meta.json`. */
  ivHex: string;
  authTagHex: string;
  wrappedDekHex: string;
  /** If true, `audit_logs` is excluded from the restore — the current audit trail is preserved untouched. */
  preserveAuditLog: boolean;
  /** Whether to also replay `files/*` entries back into the storage provider. */
  restoreFiles: boolean;
  logger: BackupLogger;
}

export async function runRestoreJob(params: RunRestoreJobParams): Promise<void> {
  const { filename, ivHex, authTagHex, wrappedDekHex, preserveAuditLog, restoreFiles, logger } = params;
  const jobId = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const workDir = join(TEMP_DIR, jobId);
  const dumpPath = join(workDir, 'db.dump');
  const filesDir = join(workDir, 'files');

  try {
    await mkdir(filesDir, { recursive: true, mode: 0o700 });

    const provider = await getStorageProvider(params.prisma);

    logger.info({ filename }, 'Restore: download e decifratura archivio');
    const { stream: blobStream } = await provider.get({ bucket: 'backups', key: filename });

    const dek = unwrapDek(wrappedDekHex);
    const decipher = createBackupDecipher(dek, ivHex, authTagHex);
    const gunzip = createGunzip();
    const extract = createArchiveExtractor();

    blobStream.pipe(decipher);
    decipher.pipe(gunzip);
    gunzip.pipe(extract);

    const stagedFiles: StagedFileEntry[] = [];
    let fileIndex = 0;

    await forEachArchiveEntry(extract, async (header, entryStream) => {
      if (header.name === 'db.dump') {
        await pipeline(entryStream, createWriteStream(dumpPath));
        return;
      }

      const parsed = parseFileEntryName(header.name);
      if (!parsed || !restoreFiles) {
        // Unknown/unsupported entry, or file restore not requested — drain and discard.
        entryStream.resume();
        await finished(entryStream);
        return;
      }

      const stagedPath = join(filesDir, String(fileIndex++));
      await pipeline(entryStream, createWriteStream(stagedPath));
      stagedFiles.push({ bucket: parsed.bucket, key: parsed.key, stagedPath, size: header.size ?? 0 });
    });

    logger.info({ filename }, 'Restore: avvio pg_restore');
    await restoreDatabaseFromFile(dumpPath, preserveAuditLog);
    logger.info({ filename }, 'Restore: database ripristinato, replay file storage');

    if (restoreFiles) {
      await replayStagedFiles(provider, stagedFiles);
    }

    logger.info({ filename, restoredFiles: stagedFiles.length }, 'Restore: completato');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}

async function replayStagedFiles(provider: IStorageProvider, files: StagedFileEntry[]): Promise<void> {
  for (const file of files) {
    await provider.put({
      bucket: file.bucket,
      key: file.key,
      originalName: file.key,
      contentType: 'application/octet-stream',
      size: file.size,
      stream: createReadStream(file.stagedPath),
      bypassSizeLimit: true,
    });
  }
}
