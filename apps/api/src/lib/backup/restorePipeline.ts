/**
 * Full-system restore engine: streamed download from the "backups" bucket → AES-256-GCM decrypt
 * → gunzip → untar, staged entirely to local disk, then `pg_restore` + (optionally) file replay.
 *
 * Extraction is staged to local disk in full before any destructive step runs, for two reasons:
 * 1. The source blob stream (especially from S3-compatible storage) is not something we want to hold open for the
 *    full duration of a potentially multi-minute `pg_restore` — read it to completion promptly.
 * 2. It lets the DB restore run to completion (or fail) before any file is touched, so a failed
 *    `pg_restore` never leaves storage files partially overwritten — only the DB was touched.
 *
 * Unlike `runBackupJob`, this function DOES throw on failure — restore has no record of its own
 * to swallow errors into, and the caller (router) must know synchronously whether it succeeded,
 * e.g. to decide whether to keep Maintenance Mode active for the admin to investigate.
 *
 * Preserving the current audit trail is a stash-then-merge around the restore, not an exclusion
 * from it — `pg_restore` cannot skip a table, and skipping one via its TOC breaks the restore of
 * everything referencing it. See `stashAuditLog`.
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

import { Prisma } from '@prisma/client';

import { APP_STORAGE_BUCKETS, type IStorageProvider, type StorageBucket } from '@luke/core';

import { getStorageProvider } from '../../storage';

import { createArchiveExtractor, forEachArchiveEntry } from './archiveFormat';
import { createBackupDecipher, unwrapDek } from './crypto';
import { parseDatabaseUrl, pgBinaryMajorVersion, runPgBinary } from './pgConnection';

import type { BackupLogger } from './dumpPipeline';
import type { PgConnectionParts } from './pgConnection';
import type { PrismaClient } from '@prisma/client';

const TEMP_DIR = join(homedir(), '.luke', 'restore-tmp');

interface StagedFileEntry {
  bucket: StorageBucket;
  key: string;
  stagedPath: string;
  size: number;
}

export interface RestoreDatabaseFromFileOptions {
  /** DB to `pg_restore` into. Default: this instance's own database. The migration bridge
   *  overrides this to point at its disposable temp database instead. */
  db?: PgConnectionParts;
  /** Whether to pass `--clean --if-exists` (drop existing objects before recreating them).
   *  Default `true` — a real restore overwrites an already-populated database. The migration
   *  bridge sets this `false`: its temp database is freshly created and already empty. */
  clean?: boolean;
}

/**
 * Runs `pg_restore` from a local dump file into `options.db` (default: this instance's own
 * database). Restores the dump whole — selecting what to keep is not expressible here (see
 * `stashAuditLog`), so this function has exactly one job.
 *
 * Deliberately strict, in two ways. Any non-zero exit is a failure (pg_restore can exit 1 even
 * for warnings, e.g. skipped GRANT/OWNER statements under --no-owner). And `--exit-on-error`
 * turns pg_restore's *default* behaviour — log the error, carry on, exit 0 with a
 * "warning: errors ignored on restore: N" line nobody reads — into a hard stop. Without it a
 * restore that silently skipped half the tables reports success, which for a disaster-recovery
 * tool is the worst possible outcome: a false "failed" costs an admin a look at stderr, a false
 * "succeeded" costs the data.
 *
 * Note this makes the restore intolerant of a `pg_dump` newer than the destination server (a
 * dump from pg_dump >= 17 carries `SET transaction_timeout`, unknown to a <= 16 server). That
 * skew does not exist in the deployed setup — apps/api/Dockerfile pins postgresql16-client and
 * every docker-compose file runs postgres:16-alpine — and tolerating it is not worth reopening
 * the silent-partial-restore hole.
 */
export async function restoreDatabaseFromFile(
  dumpPath: string,
  options: RestoreDatabaseFromFileOptions = {}
): Promise<void> {
  const { db = parseDatabaseUrl(), clean = true } = options;
  await runPgBinary('pg_restore', [
    ...(clean ? ['--clean', '--if-exists'] : []),
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    '--host', db.host,
    '--port', db.port,
    '--username', db.user,
    '--dbname', db.database,
    dumpPath,
  ], db.password);
}

/**
 * Fails unless `pg_restore` and the PostgreSQL server share a major version.
 *
 * `pg_restore` writes its own prologue into the stream it replays, and that prologue tracks the
 * *client's* version: from 18 it emits `SET transaction_timeout = 0`, a parameter a 16 server does
 * not know. With `--exit-on-error` that aborts the restore. Harmless in itself — it aborts on the
 * prologue, before any DROP, so the database is left untouched — but it means the restore simply
 * cannot run, and the error it surfaces ("unrecognized configuration parameter") says nothing
 * about the actual cause.
 *
 * So it is checked up front, by the callers, before a safety snapshot is taken and Maintenance
 * Mode is switched on. Failing here costs nothing; failing three steps later leaves an admin to
 * undo the maintenance state by hand.
 *
 * Deployed instances always match — apps/api/Dockerfile installs postgresql16-client alongside
 * the postgres:16-alpine service. A local `pnpm dev` does not: it spawns whatever `pg_restore` is
 * on the developer's PATH, which is how this surfaced.
 */
export async function assertPgToolchainCompatible(prisma: PrismaClient): Promise<void> {
  const [clientMajor, rows] = await Promise.all([
    pgBinaryMajorVersion('pg_restore'),
    prisma.$queryRaw<{ server_version: string }[]>(Prisma.sql`SHOW server_version`),
  ]);

  const serverMajor = Number.parseInt(rows[0]?.server_version ?? '', 10);
  if (!Number.isFinite(serverMajor)) {
    throw new Error(`Impossibile determinare la versione del server PostgreSQL ("${rows[0]?.server_version}")`);
  }
  if (clientMajor === serverMajor) return;

  throw new Error(
    `pg_restore è alla major ${clientMajor}, il server PostgreSQL alla ${serverMajor}: un restore ` +
    'con versioni disallineate fallisce a metà. Usa i binari client della stessa major del server ' +
    `(in produzione l'immagine API installa postgresql${serverMajor}-client). In sviluppo locale ` +
    `metti in PATH il client ${serverMajor} prima di quello di sistema.`
  );
}

/** Schema holding the copy of the audit trail taken before a restore. */
const AUDIT_STAGE_SCHEMA = '_luke_restore_stage';

/**
 * The staging schema as a SQL identifier.
 *
 * `Prisma.sql` parameterizes values, and a schema name is not one, so this is the one place that
 * has to bypass it. Safe because `AUDIT_STAGE_SCHEMA` is a compile-time constant in this file:
 * nothing reaches `Prisma.raw` that a caller can influence. Do not extend this pattern to a name
 * derived from input — that is a SQL injection, and the quoting here does not prevent it.
 */
const AUDIT_STAGE_IDENT = Prisma.raw(`"${AUDIT_STAGE_SCHEMA}"`);

/**
 * Copies the current audit trail aside so a restore can put it back afterwards.
 *
 * Excluding `audit_logs` from the restore itself is not possible: `pg_restore` has no
 * `--exclude-table` (that is a `pg_dump` flag), and filtering its TOC with `-L` instead leaves
 * the table in place, whose `audit_logs_actorId_fkey` then blocks the `DROP TABLE public.users`
 * that `--clean` needs — pg_restore logs that, carries on, and silently skips restoring the users
 * table. So the trail goes to a staging schema instead, and the restore runs untouched.
 *
 * `CREATE TABLE ... AS SELECT` deliberately copies rows without constraints or foreign keys, so
 * the copy survives the `users` drop; and the staging schema is absent from the archive's TOC, so
 * `--clean` never sees it.
 *
 * A leftover staging schema means a previous restore died between stash and merge. Whether that
 * copy still matters is a question with an answer, so it gets asked rather than assumed: if every
 * row in it is already in `public.audit_logs`, the earlier restore never got as far as touching
 * the table (a `pg_restore` that aborts on its prologue, say) and the copy is redundant — it is
 * dropped and the restore proceeds. If it holds rows the live table does not, the previous run
 * did wipe the trail and this copy is the only one left; that refuses, because clearing it to
 * make room would destroy exactly what it exists to protect.
 */
export async function stashAuditLog(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.schemata WHERE schema_name = ${AUDIT_STAGE_SCHEMA}
    ) AS "exists"
  `);
  if (existing[0]?.exists) {
    const [{ orphaned }] = await prisma.$queryRaw<{ orphaned: bigint }[]>(Prisma.sql`
      SELECT count(*) AS orphaned
      FROM ${AUDIT_STAGE_IDENT}.audit_logs s
      WHERE NOT EXISTS (SELECT 1 FROM public.audit_logs p WHERE p.id = s.id)
    `);

    if (orphaned > 0n) {
      throw new Error(
        `Lo schema "${AUDIT_STAGE_SCHEMA}" contiene ${orphaned} eventi che il registro attività ` +
        'corrente non ha: un restore precedente si è interrotto dopo averlo sovrascritto, e quella ' +
        'copia è l\'unica rimasta. Reinnestala o mettila al sicuro (in alternativa ripristina lo ' +
        'snapshot di sicurezza pre-restore), poi elimina lo schema a mano prima di riprovare.'
      );
    }

    // Nothing in the copy that the live table has lost: the earlier restore never reached
    // audit_logs. Clear it and carry on rather than dead-ending an operator over a redundant copy.
    await prisma.$executeRaw(Prisma.sql`DROP SCHEMA ${AUDIT_STAGE_IDENT} CASCADE`);
  }

  // Raw SQL: a staging schema plus CREATE TABLE AS SELECT has no Prisma ORM equivalent.
  // Parameterized `Prisma.sql` throughout, never $executeRawUnsafe.
  await prisma.$executeRaw(Prisma.sql`CREATE SCHEMA ${AUDIT_STAGE_IDENT}`);
  await prisma.$executeRaw(
    Prisma.sql`CREATE TABLE ${AUDIT_STAGE_IDENT}.audit_logs AS SELECT * FROM public.audit_logs`
  );
}

/**
 * Merges the stashed audit trail back after a restore, then drops the staging schema.
 * Returns how many rows were reinstated.
 *
 * Union, not replacement: the restored snapshot's own entries stay, and `ON CONFLICT (id) DO
 * NOTHING` keeps a row present in both from being duplicated. Excluding the table outright would
 * have been the narrower promise and the worse one — it would discard every event written *after*
 * the backup, which is most of what an admin wants to still be able to read afterwards.
 *
 * An `actorId` pointing at a user the restored snapshot does not contain is set to NULL rather
 * than dropping the row: the same trade the schema already makes with `onDelete: SetNull` on
 * `AuditLog.actor`, and the FK would reject the row otherwise. The event survives without its
 * attribution.
 */
export async function mergeStashedAuditLog(prisma: PrismaClient): Promise<number> {
  const merged = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public.audit_logs
      (id, "actorId", action, "targetType", "targetId", result, metadata, "traceId", ip, "createdAt")
    SELECT s.id,
           CASE WHEN u.id IS NULL THEN NULL ELSE s."actorId" END,
           s.action, s."targetType", s."targetId", s.result,
           s.metadata, s."traceId", s.ip, s."createdAt"
    FROM ${AUDIT_STAGE_IDENT}.audit_logs s
    LEFT JOIN public.users u ON u.id = s."actorId"
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRaw(Prisma.sql`DROP SCHEMA ${AUDIT_STAGE_IDENT} CASCADE`);
  return merged;
}

/**
 * Downloads + decrypts a backup's blob into a ready-to-iterate tar extraction stream — shared by
 * a real restore (which also replays `files/*`) and the migration bridge (which only wants
 * `db.dump`, discarding everything else).
 */
export async function openBackupArchiveStream(params: {
  prisma: PrismaClient;
  filename: string;
  ivHex: string;
  authTagHex: string;
  wrappedDekHex: string;
}): Promise<ReturnType<typeof createArchiveExtractor>> {
  const provider = await getStorageProvider(params.prisma);
  const { stream: blobStream } = await provider.get({ bucket: 'backups', key: params.filename });

  const dek = unwrapDek(params.wrappedDekHex);
  const decipher = createBackupDecipher(dek, params.ivHex, params.authTagHex);
  const gunzip = createGunzip();
  const extract = createArchiveExtractor();

  blobStream.pipe(decipher);
  decipher.pipe(gunzip);
  gunzip.pipe(extract);

  return extract;
}

/** Parses a `files/<bucket>/<key...>` tar entry name. Returns `null` if the bucket isn't recognized. */
function parseFileEntryName(name: string): { bucket: StorageBucket; key: string } | null {
  const match = /^files\/([^/]+)\/(.+)$/.exec(name);
  if (!match) return null;
  const [, bucket, key] = match;
  if (!(APP_STORAGE_BUCKETS as readonly string[]).includes(bucket)) return null;
  return { bucket: bucket as StorageBucket, key };
}

export interface StageBackupArchiveParams {
  prisma: PrismaClient;
  /** Storage key of the encrypted blob in the "backups" bucket. */
  filename: string;
  /** Crypto metadata, resolved by the caller from either `BackupRecord` or a sidecar `.meta.json`. */
  ivHex: string;
  authTagHex: string;
  wrappedDekHex: string;
  /** Whether `files/*` entries should be kept for replay, or drained and discarded. */
  restoreFiles: boolean;
  logger: BackupLogger;
}

/** A backup unpacked on local disk, verified restorable, and not yet applied to anything. */
export interface StagedRestore {
  workDir: string;
  dumpPath: string;
  stagedFiles: StagedFileEntry[];
}

/**
 * Verifies `pg_restore` can actually read a staged dump, by asking it to list the archive's
 * contents — no connection, no writes.
 *
 * A custom-format archive carries a format version tied to the `pg_dump` that wrote it (16 writes
 * 1.15, 18 writes 1.16), and `pg_restore` reads its own version and older, never newer. The raw
 * refusal is "unsupported version (1.16) in the file header", which names neither the tool that
 * wrote the archive nor the one that cannot read it.
 *
 * Deployed instances never see this: the same pinned client writes and reads every backup. It
 * shows up when the toolchain changes underneath existing backups — a developer's PATH, or an
 * image whose client major moved — and on `.lukebak` packages imported from an instance that ran
 * a different one.
 */
async function assertDumpReadable(dumpPath: string, logger: BackupLogger): Promise<void> {
  try {
    await runPgBinary('pg_restore', ['--list', dumpPath], '');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ dumpPath, err: detail }, 'Restore: dump illeggibile');

    const clientMajor = await pgBinaryMajorVersion('pg_restore').catch(() => null);
    throw new Error(
      'Il dump contenuto nel backup non è leggibile da questo pg_restore' +
      (clientMajor ? ` (major ${clientMajor})` : '') +
      '. Se il messaggio parla di versione non supportata nell\'intestazione, il backup è stato ' +
      'creato da un pg_dump più recente: serve un pg_restore almeno di pari major, che a sua volta ' +
      `deve coincidere con quella del server. Dettaglio: ${detail}`,
      { cause: err }
    );
  }
}

/**
 * Downloads, decrypts and unpacks a backup onto local disk, then checks the dump is restorable.
 *
 * Nothing here touches the database or the storage provider, which is the point: the caller runs
 * this *before* taking the instance down for maintenance, so a backup that turns out to be
 * unreadable — or a download that fails halfway — costs nothing but a temp directory. Staging to
 * disk in full also means the (possibly S3-backed) blob stream is not held open across a
 * multi-minute `pg_restore`, and that a failing restore cannot leave storage files half-replaced.
 *
 * The caller owns the returned directory and must pass it to `discardStagedRestore`.
 */
export async function stageBackupArchive(params: StageBackupArchiveParams): Promise<StagedRestore> {
  const { filename, ivHex, authTagHex, wrappedDekHex, restoreFiles, logger } = params;
  const jobId = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const workDir = join(TEMP_DIR, jobId);
  const dumpPath = join(workDir, 'db.dump');
  const filesDir = join(workDir, 'files');

  try {
    await mkdir(filesDir, { recursive: true, mode: 0o700 });

    logger.info({ filename }, 'Restore: download e decifratura archivio');
    const extract = await openBackupArchiveStream({ prisma: params.prisma, filename, ivHex, authTagHex, wrappedDekHex });

    const stagedFiles: StagedFileEntry[] = [];
    let fileIndex = 0;
    let dumpFound = false;

    await forEachArchiveEntry(extract, async (header, entryStream) => {
      if (header.name === 'db.dump') {
        dumpFound = true;
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

    if (!dumpFound) {
      throw new Error("L'archivio del backup non contiene il dump del database (voce \"db.dump\" assente)");
    }
    await assertDumpReadable(dumpPath, logger);

    logger.info({ filename, files: stagedFiles.length }, 'Restore: archivio estratto e verificato');
    return { workDir, dumpPath, stagedFiles };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
    throw err;
  }
}

export interface ApplyStagedRestoreParams {
  prisma: PrismaClient;
  staged: StagedRestore;
  /** If true, the current audit trail is stashed before the restore and merged back after, so no
   *  event is lost in either direction. See `stashAuditLog`. */
  preserveAuditLog: boolean;
  /** Whether to also replay `files/*` entries back into the storage provider. */
  restoreFiles: boolean;
  logger: BackupLogger;
}

/**
 * Applies a staged backup: this is the destructive half, and the only one.
 *
 * The database goes first and the storage files second, so a failing `pg_restore` leaves the
 * files untouched rather than half-replaced.
 */
export async function applyStagedRestore(params: ApplyStagedRestoreParams): Promise<void> {
  const { prisma, staged, preserveAuditLog, restoreFiles, logger } = params;

  if (preserveAuditLog) {
    await stashAuditLog(prisma);
    logger.info('Restore: registro attività messo da parte');
  }

  logger.info('Restore: avvio pg_restore');
  await restoreDatabaseFromFile(staged.dumpPath);

  if (preserveAuditLog) {
    const mergedRows = await mergeStashedAuditLog(prisma);
    logger.info({ mergedRows }, 'Restore: registro attività reinnestato');
  }

  if (restoreFiles) {
    logger.info('Restore: database ripristinato, replay file storage');
    await replayStagedFiles(await getStorageProvider(prisma), staged.stagedFiles);
  }

  logger.info({ restoredFiles: staged.stagedFiles.length }, 'Restore: completato');
}

/** Removes a staged restore's working directory. Safe to call more than once. */
export async function discardStagedRestore(staged: StagedRestore): Promise<void> {
  await rm(staged.workDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
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
