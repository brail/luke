/**
 * Full-system backup engine: pg_dump (+ optionally storage files) → tar → gzip → AES-256-GCM
 * envelope encryption → streamed upload to the "backups" bucket.
 *
 * Pure engine layer: takes a PrismaClient and a pre-created `BackupRecord` id (status PENDING),
 * does the work, and leaves the record COMPLETED or FAILED. No tRPC Context, no audit logging —
 * callers (routers, scheduler) own request context and are responsible for `logAudit`. This keeps
 * the engine runnable standalone (CLI/script) and testable without fabricating a fake request.
 */

import { randomUUID } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { createGzip } from 'zlib';

import { APP_STORAGE_BUCKETS, type IStorageProvider } from '@luke/core';

import { getStorageProvider } from '../../storage';
import { getBackupRetentionDays } from '../configManager';

import { addFileEntry, addStreamEntry, createArchivePacker } from './archiveFormat';
import { createBackupCipher, generateDek, wrapDek } from './crypto';
import { parseDatabaseUrl, runPgBinary } from './pgConnection';

import type { BackupScope, BackupTrigger, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

/** Matches both `ctx.logger` (router callers) and `fastify.log` (scheduler callers). */
export type BackupLogger = FastifyBaseLogger;

const TEMP_DIR = join(homedir(), '.luke', 'backup-tmp');

/** Storage key of a backup's encrypted blob — the writer (here) and the deleter (router) must agree on this. */
export function backupBlobKey(backupId: string): string {
  return `${backupId}.enc`;
}

/** Storage key of a backup's sidecar metadata — see module docstring on `BackupSidecarMeta`. */
export function backupMetaKey(backupId: string): string {
  return `${backupId}.meta.json`;
}

/**
 * Deletes a backup's encrypted blob + sidecar metadata from storage (both keys, in parallel).
 * Does not touch the `BackupRecord` row — callers decide whether/when to remove that, and
 * whether a storage-delete failure should still be treated as best-effort (manual delete) or
 * should abort so the row survives for a retry (scheduled retention pruning).
 */
export async function deleteBackupBlob(provider: IStorageProvider, backupId: string): Promise<void> {
  await Promise.all([
    provider.delete({ bucket: 'backups', key: backupBlobKey(backupId) }),
    provider.delete({ bucket: 'backups', key: backupMetaKey(backupId) }),
  ]);
}

/** Sidecar metadata written next to the encrypted blob — the disaster-recovery safety net if `BackupRecord` itself is lost. */
export interface BackupSidecarMeta {
  version: 1;
  backupId: string;
  scope: BackupScope;
  algorithm: 'aes-256-gcm';
  ivHex: string;
  authTagHex: string;
  wrappedDekHex: string;
  checksumSha256: string;
  appVersion: string | null;
  schemaMigrationName: string | null;
  createdAt: string;
}

/** Runs `pg_dump` (custom format, compressed) directly to a local file via `--file`. */
async function dumpDatabaseToFile(destPath: string): Promise<void> {
  const db = parseDatabaseUrl();
  await runPgBinary('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--host', db.host,
    '--port', db.port,
    '--username', db.user,
    '--dbname', db.database,
    '--file', destPath,
  ], db.password);
}

/** Appends every object from every app-facing bucket (never `backups` itself) as `files/<bucket>/<key>` tar entries. */
async function addAllStorageFiles(
  pack: ReturnType<typeof createArchivePacker>,
  provider: IStorageProvider
): Promise<number> {
  let fileCount = 0;
  for (const bucket of APP_STORAGE_BUCKETS) {
    let cursor: string | undefined;
    do {
      const page = await provider.list({ bucket, cursor, limit: 200 });
      for (const item of page.items) {
        const { stream } = await provider.get({ bucket, key: item.key });
        await addStreamEntry(pack, `files/${bucket}/${item.key}`, item.size, stream);
        fileCount += 1;
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return fileCount;
}

/** Reads the name of the most recently applied Prisma migration, or `null` if unavailable. */
async function getLatestMigrationName(prisma: PrismaClient): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return rows[0]?.migration_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Creates a PENDING `BackupRecord` ready for `runBackupJob` — shared by manual `create`, the
 * pre-restore safety snapshot, and the scheduler's automatic runs. `expiresAt` is frozen at the
 * retention window in effect right now, so a later change to `backup.retentionDays` only affects
 * backups created after the change.
 *
 * `PRE_RESTORE_SAFETY` snapshots are the exception: `expiresAt` stays `null` (never auto-expires).
 * It's a disaster-recovery safety net for one specific restore, not a routine backup — if an
 * admin lowers `backup.retentionDays` for cost/space reasons, that shouldn't silently shorten the
 * window in which a bad restore can still be undone. It's only ever removed by an explicit
 * manual delete.
 */
export async function createPendingBackupRecord(
  prisma: PrismaClient,
  params: { scope: BackupScope; trigger: BackupTrigger; createdById?: string }
): Promise<{ id: string }> {
  const expiresAt = params.trigger === 'PRE_RESTORE_SAFETY'
    ? null
    : new Date(Date.now() + (await getBackupRetentionDays(prisma)) * 24 * 60 * 60 * 1000);

  return prisma.backupRecord.create({
    data: {
      id: randomUUID(),
      filename: '', // popolato da runBackupJob al completamento
      scope: params.scope,
      trigger: params.trigger,
      status: 'PENDING',
      createdById: params.createdById ?? null,
      expiresAt,
    },
    select: { id: true },
  });
}

export interface RunBackupJobParams {
  prisma: PrismaClient;
  backupId: string;
  scope: BackupScope;
  logger: BackupLogger;
}

/**
 * Executes a backup job end-to-end for a pre-created `BackupRecord` (status PENDING).
 * Never throws — all failures are captured on the record itself (status FAILED, errorMessage)
 * so a fire-and-forget caller doesn't need to handle rejections.
 */
export async function runBackupJob(params: RunBackupJobParams): Promise<void> {
  const { prisma, backupId, scope, logger } = params;
  const workDir = join(TEMP_DIR, backupId);

  try {
    await prisma.backupRecord.update({ where: { id: backupId }, data: { status: 'RUNNING' } });
    await mkdir(workDir, { recursive: true, mode: 0o700 });

    const dumpPath = join(workDir, 'db.dump');
    logger.info({ backupId }, 'Backup: avvio pg_dump');
    await dumpDatabaseToFile(dumpPath);

    const provider = await getStorageProvider(prisma);
    const pack = createArchivePacker();
    const dek = generateDek();
    const { iv, cipher } = createBackupCipher(dek);
    const gzip = createGzip();

    pack.pipe(gzip);
    gzip.pipe(cipher);

    const blobKey = backupBlobKey(backupId);
    const uploadPromise = provider.put({
      bucket: 'backups',
      key: blobKey,
      originalName: blobKey,
      contentType: 'application/octet-stream',
      size: 0, // unknown ahead of time — neither provider relies on this for correctness
      stream: cipher,
      bypassSizeLimit: true,
    });

    logger.info({ backupId, scope }, 'Backup: assemblaggio archivio tar');
    let fileCount = 0;
    const packPromise = (async () => {
      await addFileEntry(pack, 'db.dump', dumpPath);
      if (scope === 'DB_AND_FILES') {
        fileCount = await addAllStorageFiles(pack, provider);
      }
      pack.finalize();
    })();

    const [, uploadResult] = await Promise.all([packPromise, uploadPromise]);

    // Only safe to read now: getAuthTag() requires cipher.final() to have run, which happens
    // once the upload has consumed the cipher's entire output (its readable side has ended).
    const authTag = cipher.getAuthTag();

    const appVersion = process.env.APP_VERSION ?? null;
    const schemaMigrationName = await getLatestMigrationName(prisma);

    const sidecar: BackupSidecarMeta = {
      version: 1,
      backupId,
      scope,
      algorithm: 'aes-256-gcm',
      ivHex: iv.toString('hex'),
      authTagHex: authTag.toString('hex'),
      wrappedDekHex: wrapDek(dek),
      checksumSha256: uploadResult.checksumSha256,
      appVersion,
      schemaMigrationName,
      createdAt: new Date().toISOString(),
    };

    const sidecarBuffer = Buffer.from(JSON.stringify(sidecar, null, 2), 'utf8');
    const metaKey = backupMetaKey(backupId);
    await provider.put({
      bucket: 'backups',
      key: metaKey,
      originalName: metaKey,
      contentType: 'application/json',
      size: sidecarBuffer.length,
      stream: Readable.from(sidecarBuffer),
    });

    await prisma.backupRecord.update({
      where: { id: backupId },
      data: {
        status: 'COMPLETED',
        filename: blobKey,
        sizeBytesEncrypted: BigInt(uploadResult.size),
        checksumSha256: uploadResult.checksumSha256,
        ivHex: sidecar.ivHex,
        authTagHex: sidecar.authTagHex,
        wrappedDekHex: sidecar.wrappedDekHex,
        appVersion,
        schemaMigrationName,
        completedAt: new Date(),
      },
    });

    logger.info({ backupId, fileCount, sizeBytes: uploadResult.size }, 'Backup: completato');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ backupId, err: message }, 'Backup: fallito');
    await prisma.backupRecord.update({
      where: { id: backupId },
      data: { status: 'FAILED', errorMessage: message.slice(0, 2000) },
    }).catch(() => { /* best-effort — the record row itself may be the source of the failure */ });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}
