/**
 * Migration bridge: brings a backup whose schema predates this instance's current one up to
 * date, entirely on a disposable temp database, so it can then go through the normal restore
 * flow unchanged.
 *
 * Prisma migrations are forward-only in this repo (no maintained "down" SQL), and several are
 * structurally destructive (column/table removals) — replaying them is exactly their intended
 * use case, but only ever forward. A backup newer than (or unrelated to) this instance's bundled
 * migration history has no safe path at all; see `classifySchemaCompatibility`.
 *
 * Pure engine layer, same as `dumpPipeline`/`restorePipeline`/`importPipeline`: no tRPC Context,
 * no audit logging — the caller (router) owns that. `runMigrationBridgeJob` never throws, mirroring
 * `runBackupJob`'s fire-and-forget contract: every failure, at any stage, is captured on the
 * `migratedBackupId` record (status FAILED, errorMessage). Production is never touched — only the
 * temp database's DATABASE_URL — and the temp database is always dropped in a `finally`, success
 * or failure.
 */

import { createWriteStream } from 'fs';
import { mkdir, readdir, rm } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { finished, pipeline } from 'stream/promises';

import { Client } from 'pg';

import type { SchemaCompatibility, SchemaCompatibilityResult } from '@luke/core';
import { PRISMA_MIGRATIONS_DIR, PRISMA_PACKAGE_ROOT } from '@luke/db';
import type { PrismaClient } from '@luke/db';

import { forEachArchiveEntry } from './archiveFormat';
import { createPendingBackupRecord, getLatestMigrationName, runBackupJob, type BackupLogger } from './dumpPipeline';
import { buildPostgresUrl, parseDatabaseUrl, runCommand, runPgBinary } from './pgConnection';
import { openBackupArchiveStream, restoreDatabaseFromFile } from './restorePipeline';

import type { PgConnectionParts } from './pgConnection';

const BRIDGE_TEMP_DIR = join(homedir(), '.luke', 'bridge-tmp');

function tempDatabaseNameFor(sourceBackupId: string): string {
  return `luke_bridge_${sourceBackupId.replace(/-/g, '')}`;
}

// Both this instance's bundled migration folder and its own applied-migrations state are fixed
// for the lifetime of the process: the folder is baked into the deployed image, and the main
// database's applied set only ever advances at boot (entrypoint.sh's `migrate deploy`, before the
// server starts) — nothing in-app migrates it at runtime. Safe to cache indefinitely per process.
let cachedBundledMigrationNames: string[] | undefined;

/** Reads `@luke/db`'s migration folder as bundled with this instance (folder names are timestamp-prefixed, so lexical sort = chronological order). */
async function listBundledMigrationNames(): Promise<string[]> {
  if (cachedBundledMigrationNames) return cachedBundledMigrationNames;
  const entries = await readdir(PRISMA_MIGRATIONS_DIR, { withFileTypes: true });
  cachedBundledMigrationNames = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  return cachedBundledMigrationNames;
}

/**
 * Classifies a backup's `schemaMigrationName` against this instance's current one by POSITION in
 * the bundled migration list — not by string/date comparison, since a backup name might not even
 * be present in this instance's history at all.
 *
 * Missing data (either side `null`) never blocks — only a known, positively-identified mismatch
 * does. This mirrors the pre-existing soft-check's behavior for backups predating schema tracking.
 */
export async function classifySchemaCompatibility(
  prisma: PrismaClient,
  backupSchemaMigrationName: string | null
): Promise<SchemaCompatibilityResult> {
  const currentSchemaMigrationName = await getLatestMigrationName(prisma);

  if (
    backupSchemaMigrationName === null ||
    currentSchemaMigrationName === null ||
    backupSchemaMigrationName === currentSchemaMigrationName
  ) {
    return { classification: 'SAME', currentSchemaMigrationName, pendingMigrations: [] };
  }

  const bundled = await listBundledMigrationNames();
  const targetIndex = bundled.indexOf(backupSchemaMigrationName);
  const currentIndex = bundled.indexOf(currentSchemaMigrationName);

  // Not found at all (newer Luke version, or unrelated schema), or current instance somehow
  // hasn't applied all its own bundled migrations (shouldn't happen — entrypoint.sh always runs
  // `migrate deploy` before the server starts) — either way, no safe way to reason forward.
  const classification: SchemaCompatibility =
    targetIndex === -1 || currentIndex === -1 || targetIndex > currentIndex ? 'NEWER_OR_UNKNOWN' : 'OLDER';

  return {
    classification,
    currentSchemaMigrationName,
    pendingMigrations: classification === 'OLDER' ? bundled.slice(targetIndex + 1, currentIndex + 1) : [],
  };
}

/** Downloads+decrypts a backup's blob and stages just its `db.dump` tar entry to local disk — the bridge never touches storage files (`files/*` entries are drained and discarded). */
async function stageOldDumpFromBackup(params: {
  prisma: PrismaClient;
  sourceBackup: { filename: string; ivHex: string; authTagHex: string; wrappedDekHex: string };
  destPath: string;
}): Promise<void> {
  const { prisma, sourceBackup, destPath } = params;
  const extract = await openBackupArchiveStream({ prisma, ...sourceBackup });

  let dbDumpFound = false;
  await forEachArchiveEntry(extract, async (header, entryStream) => {
    if (header.name === 'db.dump') {
      dbDumpFound = true;
      await pipeline(entryStream, createWriteStream(destPath));
      return;
    }
    entryStream.resume();
    await finished(entryStream);
  });

  if (!dbDumpFound) throw new Error('Pacchetto di backup senza voce db.dump');
}

/** Preflight: a backup taken mid-migration (interrupted `migrate deploy`) can't be bridged safely — fail closed rather than let `migrate deploy` behave unpredictably against it. */
async function countUnfinishedMigrations(db: PgConnectionParts): Promise<number> {
  const client = new Client({
    host: db.host, port: Number(db.port), user: db.user, password: db.password, database: db.database,
  });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL'
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

/** Runs the exact same command `entrypoint.sh` runs at boot, pointed at the temp DB via an overridden `DATABASE_URL`. */
async function runMigrateDeploy(db: PgConnectionParts): Promise<void> {
  // `@luke/db` is where `prisma.config.ts`, the schema and the migrations live — the
  // same directory entrypoint.sh runs the CLI from.
  await runCommand('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: PRISMA_PACKAGE_ROOT,
    env: { DATABASE_URL: buildPostgresUrl(db) },
  });
}

async function dropTempDatabase(mainDb: PgConnectionParts, tempDbName: string, logger: BackupLogger): Promise<void> {
  await runPgBinary(
    'dropdb',
    ['--if-exists', '--host', mainDb.host, '--port', mainDb.port, '--username', mainDb.user, tempDbName],
    mainDb.password
  ).catch(err => {
    logger.error({ err, tempDatabase: tempDbName }, 'Migration bridge: drop del DB temporaneo fallito — richiede pulizia manuale');
  });
}

export interface RunMigrationBridgeJobParams {
  prisma: PrismaClient;
  /** Id of the MIGRATED `BackupRecord`, already created PENDING by the caller — the router needs
   *  to return this id immediately, before the bridge (which can take minutes) has even started. */
  migratedBackupId: string;
  sourceBackup: {
    id: string;
    filename: string;
    ivHex: string;
    authTagHex: string;
    wrappedDekHex: string;
    /** Non-null — the caller has already validated `classification === 'OLDER'`. */
    schemaMigrationName: string;
  };
  /** From `classifySchemaCompatibility` — guaranteed non-empty for an `OLDER` classification. */
  pendingMigrations: string[];
  currentSchemaMigrationName: string;
  /** The admin who requested the bridge — attributed to the PRE_MIGRATION_SAFETY snapshot, same as `PRE_RESTORE_SAFETY` attributes to the admin who requested the restore. */
  createdById: string;
  logger: BackupLogger;
}

export async function runMigrationBridgeJob(params: RunMigrationBridgeJobParams): Promise<void> {
  const { prisma, migratedBackupId, sourceBackup, pendingMigrations, currentSchemaMigrationName, createdById, logger } = params;

  if (pendingMigrations.length === 0) {
    // Defensive: shouldn't happen (migration names = unique timestamps, OLDER always implies
    // at least one element in the slice) — a safety net against a future refactor silently
    // breaking this invariant.
    logger.error({ migratedBackupId }, 'Migration bridge: pendingMigrations vuoto, abort');
    await prisma.backupRecord.update({
      where: { id: migratedBackupId },
      data: { status: 'FAILED', errorMessage: 'Nessuna migrazione da applicare (stato inatteso)' },
    }).catch(() => { /* best-effort */ });
    return;
  }

  const mainDb = parseDatabaseUrl();
  const tempDbName = tempDatabaseNameFor(sourceBackup.id);
  const tempDb: PgConnectionParts = { ...mainDb, database: tempDbName };
  const stagingDir = join(BRIDGE_TEMP_DIR, sourceBackup.id);
  const dumpPath = join(stagingDir, 'db.dump');

  try {
    await prisma.backupRecord.update({ where: { id: migratedBackupId }, data: { status: 'RUNNING' } });

    logger.info({ migratedBackupId, sourceBackupId: sourceBackup.id }, 'Migration bridge: preparo DB temporaneo e stage backup');
    // The temp DB (idempotent drop-then-create — self-heals from a previously crashed run) and
    // staging the old backup (download+decrypt) touch independent resources — neither depends
    // on the other, only the subsequent pg_restore needs both.
    await Promise.all([
      (async () => {
        await dropTempDatabase(mainDb, tempDbName, logger);
        await runPgBinary(
          'createdb',
          ['--host', mainDb.host, '--port', mainDb.port, '--username', mainDb.user, tempDbName],
          mainDb.password
        );
      })(),
      (async () => {
        await mkdir(stagingDir, { recursive: true, mode: 0o700 });
        await stageOldDumpFromBackup({ prisma, sourceBackup, destPath: dumpPath });
      })(),
    ]);

    await restoreDatabaseFromFile(dumpPath, { db: tempDb, clean: false });

    const unfinished = await countUnfinishedMigrations(tempDb);
    if (unfinished > 0) {
      throw new Error(`Il backup contiene ${unfinished} migrazione/i interrotta/e a metà — impossibile procedere in sicurezza`);
    }

    logger.info({ migratedBackupId }, 'Migration bridge: snapshot pre-migrazione');
    const preMigSafety = await createPendingBackupRecord(prisma, {
      scope: 'DB', trigger: 'PRE_MIGRATION_SAFETY', sourceBackupId: sourceBackup.id, createdById,
    });
    await runBackupJob({
      prisma, backupId: preMigSafety.id, scope: 'DB', logger,
      sourceConnection: tempDb, schemaMigrationNameOverride: sourceBackup.schemaMigrationName,
    });
    const preMigSafetyResult = await prisma.backupRecord.findUnique({
      where: { id: preMigSafety.id }, select: { status: true, errorMessage: true },
    });
    if (preMigSafetyResult?.status !== 'COMPLETED') {
      throw new Error(`Snapshot pre-migrazione fallito: ${preMigSafetyResult?.errorMessage ?? 'errore sconosciuto'}`);
    }

    logger.info({ migratedBackupId, migrations: pendingMigrations.length }, 'Migration bridge: applico le migrazioni mancanti');
    await runMigrateDeploy(tempDb);

    logger.info({ migratedBackupId }, 'Migration bridge: salvo il risultato migrato');
    await runBackupJob({
      prisma, backupId: migratedBackupId, scope: 'DB', logger,
      sourceConnection: tempDb, schemaMigrationNameOverride: currentSchemaMigrationName,
    });
    // runBackupJob handles COMPLETED/FAILED on this record by itself.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ migratedBackupId, err: message }, 'Migration bridge: fallito');
    await prisma.backupRecord.update({
      where: { id: migratedBackupId },
      data: { status: 'FAILED', errorMessage: message.slice(0, 2000) },
    }).catch(() => { /* best-effort — the record row itself may be the source of the failure */ });
  } finally {
    await dropTempDatabase(mainDb, tempDbName, logger);
    await rm(stagingDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}
