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
 * The scenario is the one that was broken in production: take a backup, keep working, then
 * restore. Data must go back; the audit trail must not lose the events written in between.
 */

import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runPgBinary } from '../src/lib/backup/pgConnection';
import { mergeStashedAuditLog, restoreDatabaseFromFile, stashAuditLog } from '../src/lib/backup/restorePipeline';

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

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: `postgresql://${encodeURIComponent(scratchDb.user)}:${encodeURIComponent(scratchDb.password)}@${scratchDb.host}:${scratchDb.port}/${scratchName}`,
      }),
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
    // --- stato al momento del backup ---
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

    // --- il lavoro continua dopo il backup ---
    await prisma.user.update({ where: { id: 'u1' }, data: { firstName: 'New' } });
    await prisma.auditLog.create({
      data: { id: 'a2', actorId: 'u1', action: 'AFTER_BACKUP', targetType: 'User', result: 'SUCCESS' },
    });
    // Utente creato dopo il backup: il restore lo cancella, ma il suo evento deve sopravvivere.
    await prisma.user.create({
      data: { id: 'u2', email: 'new@x.it', username: 'newuser', firstName: 'After', role: 'editor' },
    });
    await prisma.auditLog.create({
      data: { id: 'a3', actorId: 'u2', action: 'BY_USER_NOT_IN_BACKUP', targetType: 'User', result: 'SUCCESS' },
    });

    // --- restore ---
    await stashAuditLog(prisma);
    await restoreDatabaseFromFile(backupPath, { db: scratchDb });
    const merged = await mergeStashedAuditLog(prisma);

    // I dati applicativi tornano allo snapshot. Questa è la regressione del restore parziale
    // silenzioso: escludendo audit_logs dal TOC, `users` non veniva ripristinata affatto.
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    expect(users.map(u => u.id)).toEqual(['u1']);
    expect(users[0].firstName).toBe('Old');

    // Il registro le conserva tutte, in entrambe le direzioni, senza duplicare a1.
    const audit = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(audit.map(a => a.action)).toEqual(['BEFORE_BACKUP', 'AFTER_BACKUP', 'BY_USER_NOT_IN_BACKUP']);
    expect(merged).toBe(2); // a1 esiste già nello snapshot ripristinato: ON CONFLICT DO NOTHING

    // Attribuzione: mantenuta dove l'utente esiste ancora, azzerata dove il restore l'ha rimosso.
    expect(audit.find(a => a.id === 'a2')?.actorId).toBe('u1');
    expect(audit.find(a => a.id === 'a3')?.actorId).toBeNull();

    const stage = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = '_luke_restore_stage') AS "exists"
    `;
    expect(stage[0].exists).toBe(false);
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

  it('scarta uno staging residuo che non contiene nulla di perduto', async () => {
    await stashAuditLog(prisma);
    const before = await prisma.auditLog.count();

    // Secondo stash sopra il primo: ogni riga messa da parte è ancora nella tabella viva, quindi
    // non c'è niente da salvare e il restore non deve incastrarsi.
    await expect(stashAuditLog(prisma)).resolves.toBeUndefined();

    const merged = await mergeStashedAuditLog(prisma);
    expect(merged).toBe(0);
    expect(await prisma.auditLog.count()).toBe(before);
  }, 60_000);

  it('rifiuta se lo staging è l\'unica copia di eventi che la tabella viva non ha più', async () => {
    await stashAuditLog(prisma);
    // Simula il caso pericoloso: il restore precedente ha sovrascritto audit_logs e uno degli
    // eventi messi da parte non esiste più nella tabella viva.
    const [survivor] = await prisma.auditLog.findMany({ take: 1, orderBy: { id: 'asc' } });
    await prisma.auditLog.delete({ where: { id: survivor.id } });

    await expect(stashAuditLog(prisma)).rejects.toThrow(/contiene 1 eventi/);

    // Lo staging è ancora lì, intatto: rifiutare non deve distruggere ciò che protegge.
    await expect(mergeStashedAuditLog(prisma)).resolves.toBe(1);
  }, 60_000);
});
