/**
 * Covers the restore engine's audit-trail preservation against a real PostgreSQL.
 *
 * Runs on a throwaway database created per file, never on `TEST_DATABASE_URL` itself. That is
 * what makes this testable at all: the reason `procedure-coverage.ts` gives for leaving the
 * whole `maintenance` router uncovered — "destructive by construction" — is about the tRPC
 * procedures, which activate Maintenance Mode and would wreck the specs that follow. The engine
 * layer under them was deliberately built to run standalone (see the docstring on
 * `dumpPipeline.ts`), and a scratch database has nothing to wreck.
 *
 * Spawning pg_dump/pg_restore makes this suite sensitive to libpq's GSSAPI probe: on a machine
 * whose Kerberos config declares no default realm, each connection stalls for minutes before
 * falling back, which is long enough to blow the hook timeouts here while the same spec run on
 * its own looks fine. `PGGSSENCMODE=disable` avoids it, and `turbo.json` declares that variable on
 * `test:integration` so it survives the env filtering turbo applies to task environments.
 *
 * The scenario is the one that was broken in production: take a backup, keep working, then
 * restore. Data must go back; the audit trail must not lose the events written in between.
 */

import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '@luke/db';

import { runPgBinary } from '../src/lib/backup/pgConnection';
import {
  dropAuditStage,
  mergeStashedAuditLog,
  restoreDatabaseFromFile,
  restoreStashedBackupRecords,
  stashPreservedTables,
} from '../src/lib/backup/restorePipeline';

import { ensureTestSchema, getTestPrismaClient } from './helpers/database';

import type { PgConnectionParts } from '../src/lib/backup/pgConnection';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function partsFrom(url: string, database?: string): PgConnectionParts {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: database ?? decodeURIComponent(parsed.pathname.slice(1)),
  };
}

function majorOf(version: string): number {
  return Number.parseInt(version.trim().split('.')[0], 10);
}

/**
 * True when the local `pg_dump` is newer than the server. Such a dump carries statements the
 * server rejects (`SET transaction_timeout`, emitted from pg_dump 17 on), and `--exit-on-error`
 * correctly refuses it — so the suite would be measuring a toolchain mismatch, not the code.
 * The deployed setup cannot hit this: postgresql16-client against postgres:16-alpine.
 */
function toolchainSkew(): string | null {
  if (!TEST_DATABASE_URL) return null;
  try {
    const clientMajor = majorOf(execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }).replace(/^\D+/, ''));
    const db = partsFrom(TEST_DATABASE_URL);
    const serverVersion = execFileSync(
      'psql',
      ['--tuples-only', '--no-align', '--command', 'SHOW server_version', TEST_DATABASE_URL],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: db.password } }
    );
    const serverMajor = majorOf(serverVersion.replace(/^\D*/, ''));
    return clientMajor === serverMajor
      ? null
      : `client pg_dump ${clientMajor} vs server PostgreSQL ${serverMajor} — in produzione sono entrambi 16`;
  } catch (err) {
    return `impossibile determinare le versioni PostgreSQL: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const skew = toolchainSkew();

// Locally the toolchain varies per machine, so a skew is a skip. In CI it is a failure: a suite
// that quietly never runs protects nothing, which is how the bug it covers reached production in
// the first place. If this fires, pin the runner's client to the major the service container runs
// (production pairs postgresql16-client with postgres:16-alpine) rather than widening the skip.
if (skew && process.env.CI) {
  throw new Error(
    `[backupRestoreAudit] la suite non può saltare in CI: ${skew}. ` +
    'Allinea il client PostgreSQL del runner alla major del service container.'
  );
}
if (skew) console.warn(`[backupRestoreAudit] suite saltata: ${skew}`);

describe.skipIf(!TEST_DATABASE_URL || skew !== null)('restore: preservazione audit log', () => {
  const scratchName = `luke_test_restore_${randomBytes(6).toString('hex')}`;
  let scratchDb: PgConnectionParts;
  let prisma: PrismaClient;
  let workDir: string;
  let backupPath: string;

  beforeAll(async () => {
    // The scratch database is seeded from TEST_DATABASE_URL's schema, so that schema has to be
    // there. It is not a given: `pnpm test:db:down` runs `down -v`, which drops the volume, and a
    // spec run on its own right afterwards would otherwise dump an empty database and fail later
    // with a puzzling "table public.users does not exist".
    await ensureTestSchema(getTestPrismaClient());

    const admin = partsFrom(TEST_DATABASE_URL!);
    scratchDb = { ...admin, database: scratchName };
    workDir = await mkdtemp(join(tmpdir(), 'luke-restore-spec-'));
    backupPath = join(workDir, 'backup.dump');

    await runPgBinary(
      'createdb',
      ['--host', admin.host, '--port', admin.port, '--username', admin.user, scratchName],
      admin.password
    );

    // Schema only: the scratch DB gets the real shape (FKs included — audit_logs -> users is the
    // whole point) without inheriting whatever rows other specs left behind.
    const schemaPath = join(workDir, 'schema.dump');
    await runPgBinary('pg_dump', [
      '--schema-only', '--format=custom', '--no-owner', '--no-privileges',
      '--host', admin.host, '--port', admin.port, '--username', admin.user,
      '--dbname', admin.database, '--file', schemaPath,
    ], admin.password);
    await restoreDatabaseFromFile(schemaPath, { db: scratchDb, clean: false });

    prisma = createPrismaClient({
      connectionString: `postgresql://${encodeURIComponent(scratchDb.user)}:${encodeURIComponent(scratchDb.password)}@${scratchDb.host}:${scratchDb.port}/${scratchName}`,
    });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const admin = partsFrom(TEST_DATABASE_URL!);
    await runPgBinary(
      'dropdb',
      ['--host', admin.host, '--port', admin.port, '--username', admin.user, '--if-exists', scratchName],
      admin.password
    ).catch(() => { /* best-effort: a leftover scratch DB is noise, not a failure */ });
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  });

  it('riporta i dati al backup e non perde nessun evento del registro', async () => {
    // --- state at the moment of the backup ---
    await prisma.user.create({
      data: { id: 'u1', email: 'old@x.it', username: 'olduser', firstName: 'Old', role: 'admin' },
    });
    await prisma.auditLog.create({
      data: { id: 'a1', actorId: 'u1', action: 'BEFORE_BACKUP', targetType: 'User', result: 'SUCCESS' },
    });

    await runPgBinary('pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges',
      '--host', scratchDb.host, '--port', scratchDb.port, '--username', scratchDb.user,
      '--dbname', scratchName, '--file', backupPath,
    ], scratchDb.password);

    // --- work carries on after the backup ---
    await prisma.user.update({ where: { id: 'u1' }, data: { firstName: 'New' } });
    await prisma.auditLog.create({
      data: { id: 'a2', actorId: 'u1', action: 'AFTER_BACKUP', targetType: 'User', result: 'SUCCESS' },
    });
    // A user created after the backup: the restore deletes them, but their event must survive.
    await prisma.user.create({
      data: { id: 'u2', email: 'new@x.it', username: 'newuser', firstName: 'After', role: 'editor' },
    });
    await prisma.auditLog.create({
      data: { id: 'a3', actorId: 'u2', action: 'BY_USER_NOT_IN_BACKUP', targetType: 'User', result: 'SUCCESS' },
    });

    // --- restore ---
    const stage = await stashPreservedTables(prisma);
    await restoreDatabaseFromFile(backupPath, { db: scratchDb });
    const merged = await mergeStashedAuditLog(prisma, stage);
    await restoreStashedBackupRecords(prisma, stage);
    await dropAuditStage(prisma, stage);

    // Application data goes back to the snapshot. This is the silent-partial-restore regression:
    // excluding audit_logs via the TOC left `users` unrestored altogether.
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    expect(users.map(u => u.id)).toEqual(['u1']);
    expect(users[0].firstName).toBe('Old');

    // The trail keeps them all, in both directions, without duplicating a1.
    const audit = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(audit.map(a => a.action)).toEqual(['BEFORE_BACKUP', 'AFTER_BACKUP', 'BY_USER_NOT_IN_BACKUP']);
    expect(merged).toBe(2); // a1 esiste già nello snapshot ripristinato: ON CONFLICT DO NOTHING

    // Attribution: kept where the user still exists, nulled where the restore removed them.
    expect(audit.find(a => a.id === 'a2')?.actorId).toBe('u1');
    expect(audit.find(a => a.id === 'a3')?.actorId).toBeNull();

    const leftovers = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.schemata WHERE schema_name LIKE '_luke_restore_stage%'
    `;
    expect(Number(leftovers[0].n)).toBe(0);
  }, 120_000);

  it('rifiuta un archivio che pg_restore non sa leggere, senza toccare il database', async () => {
    const { readFileSync, writeFileSync } = await import('fs');
    const badPath = join(workDir, 'unreadable.dump');

    // A custom-format archive stores its format version at bytes 5-6 (after the "PGDMP" magic).
    // Bumping the minor past what this pg_restore supports reproduces exactly what a dump written
    // by a newer pg_dump looks like to it, without needing that pg_dump installed.
    const archive = readFileSync(backupPath);
    archive[6] = archive[6] + 4;
    writeFileSync(badPath, archive);

    const usersBefore = await prisma.user.count();
    await expect(
      restoreDatabaseFromFile(badPath, { db: scratchDb })
    ).rejects.toThrow(/versione|version/i);
    expect(await prisma.user.count()).toBe(usersBefore);
  }, 60_000);

  it('conserva l\'inventario dei backup invece di riportarlo indietro', async () => {
    // The scenario that left a backup stuck at "In corso…" forever and made the safety snapshot
    // vanish: the dump photographs backup_records while the backup itself is RUNNING, and records
    // created after the dump (the pre-restore snapshot among them) are not in it at all.
    const dumpedAt = new Date();
    await prisma.backupRecord.create({
      data: { id: 'in-corso', filename: '', scope: 'DB', trigger: 'MANUAL', status: 'RUNNING', startedAt: dumpedAt },
    });
    const inventoryDump = join(workDir, 'inventario.dump');
    await runPgBinary('pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges', '--exclude-schema=_luke_restore_stage*',
      '--host', scratchDb.host, '--port', scratchDb.port, '--username', scratchDb.user,
      '--dbname', scratchName, '--file', inventoryDump,
    ], scratchDb.password);

    // The world moves on: that backup finishes, the safety snapshot is born from it, an old one
    // is deleted.
    await prisma.backupRecord.update({
      where: { id: 'in-corso' },
      data: { status: 'COMPLETED', completedAt: new Date(), filename: 'in-corso.enc' },
    });
    await prisma.backupRecord.create({
      data: { id: 'safety', filename: 'safety.enc', scope: 'DB', trigger: 'PRE_RESTORE_SAFETY', status: 'COMPLETED' },
    });

    const stage = await stashPreservedTables(prisma);
    await restoreDatabaseFromFile(inventoryDump, { db: scratchDb });
    await restoreStashedBackupRecords(prisma, stage);
    await dropAuditStage(prisma, stage);

    // No phantom: the record does not go back to RUNNING.
    expect((await prisma.backupRecord.findUnique({ where: { id: 'in-corso' } }))?.status).toBe('COMPLETED');
    // And the safety snapshot, created after the dump, is still reachable from the UI.
    expect(await prisma.backupRecord.count({ where: { trigger: 'PRE_RESTORE_SAFETY' } })).toBe(1);
  }, 90_000);

  it('riporta indietro app_configs, che è perché la manutenzione va riaffermata dopo', async () => {
    // The fact the router's fix rests on: Maintenance Mode state lives in app_configs, which the
    // restore overwrites with the snapshot's copy. Activating it before pg_restore is not enough —
    // it has to be rewritten afterwards, or the instance reopens to everyone at the exact moment
    // the restore lands and the admin verifies nothing.
    await prisma.appConfig.create({ data: { key: 'test.maintenance.probe', value: 'PRIMA' } });
    const configDump = join(workDir, 'config.dump');
    await runPgBinary('pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges', '--exclude-schema=_luke_restore_stage*',
      '--host', scratchDb.host, '--port', scratchDb.port, '--username', scratchDb.user,
      '--dbname', scratchName, '--file', configDump,
    ], scratchDb.password);

    await prisma.appConfig.update({ where: { key: 'test.maintenance.probe' }, data: { value: 'DOPO' } });

    const stage = await stashPreservedTables(prisma);
    await restoreDatabaseFromFile(configDump, { db: scratchDb });
    await restoreStashedBackupRecords(prisma, stage);
    await dropAuditStage(prisma, stage);

    const probe = await prisma.appConfig.findUnique({ where: { key: 'test.maintenance.probe' } });
    expect(probe?.value).toBe('PRIMA');
  }, 90_000);

  it('sopravvive a un backup che contiene già uno schema di staging', async () => {
    // The real regression: an interrupted restore leaves its staging schema in the database, a
    // later backup captures it, and restoring that backup had `pg_restore --clean` overwrite the
    // live staging schema with the archive's copy — erasing the events it existed to protect
    // before the merge ever read them, and reporting mergedRows: 0.
    const leftover = await stashPreservedTables(prisma);
    const archiveWithStage = join(workDir, 'con-staging.dump');
    await runPgBinary('pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges',
      '--host', scratchDb.host, '--port', scratchDb.port, '--username', scratchDb.user,
      '--dbname', scratchName, '--file', archiveWithStage,
    ], scratchDb.password);
    expect(leftover).toMatch(/^_luke_restore_stage_/);

    await prisma.auditLog.create({
      data: { id: 'dopo-archivio', action: 'DOPO_ARCHIVIO', targetType: 'Test', result: 'SUCCESS' },
    });

    const stage = await stashPreservedTables(prisma);
    expect(stage).not.toBe(leftover); // one name per run: the archive cannot already contain it
    await restoreDatabaseFromFile(archiveWithStage, { db: scratchDb });
    expect(await mergeStashedAuditLog(prisma, stage)).toBe(1);

    expect(await prisma.auditLog.count({ where: { id: 'dopo-archivio' } })).toBe(1);
  }, 90_000);

  it('scarta uno staging residuo che non contiene nulla di perduto', async () => {
    await stashPreservedTables(prisma);
    const before = await prisma.auditLog.count();

    // A second stash on top of the first: every stashed row is still in the live table, so there
    // is nothing to save and the restore must not wedge.
    const stage = await stashPreservedTables(prisma);

    const merged = await mergeStashedAuditLog(prisma, stage);
    expect(merged).toBe(0);
    expect(await prisma.auditLog.count()).toBe(before);
  }, 60_000);

  it('rifiuta se lo staging è l\'unica copia di eventi che la tabella viva non ha più', async () => {
    const stage = await stashPreservedTables(prisma);
    // Simulates the dangerous case: the previous restore overwrote audit_logs and one of the
    // stashed events no longer exists in the live table.
    const [survivor] = await prisma.auditLog.findMany({ take: 1, orderBy: { id: 'asc' } });
    await prisma.auditLog.delete({ where: { id: survivor.id } });

    await expect(stashPreservedTables(prisma)).rejects.toThrow(/contiene 1 eventi/);

    // The staging schema is still there, intact: refusing must not destroy what it protects.
    await expect(mergeStashedAuditLog(prisma, stage)).resolves.toBe(1);
  }, 60_000);
});
