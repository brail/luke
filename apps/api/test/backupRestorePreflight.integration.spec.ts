/**
 * The restore preflight tells a refusal the admin can act on from a server fault.
 *
 * A `RestorePreconditionError` (toolchain skew, an archive from a newer pg_dump, no dump in the
 * archive) carries text written for the admin and goes out as a 412. Anything else the preflight
 * catches — a driver error, a filesystem error with a local path, a pg_restore that could not
 * start — is a 500, which `trpcErrorFormatter` masks in production. Before this split, every one
 * of them went out as a 412 carrying the caught message verbatim.
 */

import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACKUP_RESTORE_CONFIRM_PHRASE } from '@luke/core';

import { getLatestMigrationName } from '../src/lib/backup/dumpPipeline';
import * as restorePipeline from '../src/lib/backup/restorePipeline';
import { assertDumpReadable, RestorePreconditionError } from '../src/lib/backup/restorePipeline';

import { createCallerAs, createSilentLogger, setupTestDb } from './helpers';

// Spies, not `vi.mock`: `test/setup.procedureUsage.ts` loads `appRouter` before a hoisted mock in
// this file could apply, so the router would keep the real module. A spy replaces the export on
// the module the router already holds.
describe('backup.restore preflight', () => {
  let prisma: Awaited<ReturnType<typeof setupTestDb>>;
  let backupId: string;
  let toolchainCheck: ReturnType<typeof vi.spyOn>;
  let staging: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    prisma = await setupTestDb();
    // Same schema as the running database, so the compatibility gate lets the call reach the
    // preflight. The crypto metadata only has to be present: nothing is decrypted.
    const record = await prisma.backupRecord.create({
      data: {
        filename: 'preflight-test.lukebak',
        scope: 'DB',
        trigger: 'MANUAL',
        status: 'COMPLETED',
        ivHex: '00',
        authTagHex: '00',
        wrappedDekHex: '00',
        schemaMigrationName: await getLatestMigrationName(prisma),
      },
    });
    backupId = record.id;
    toolchainCheck = vi.spyOn(restorePipeline, 'assertPgToolchainCompatible').mockResolvedValue(undefined);
    staging = vi.spyOn(restorePipeline, 'stageBackupArchive');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The audit row carries a stable code, never the caught message. */
  async function failedRestoreAuditMetadata() {
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'BACKUP_RESTORE', targetId: backupId, result: 'FAILURE' },
    });
    return row.metadata;
  }

  async function restore() {
    const caller = await createCallerAs('admin');
    return caller.maintenance.backup.restore({
      id: backupId,
      preserveAuditLog: true,
      restoreFiles: false,
      confirmPhrase: BACKUP_RESTORE_CONFIRM_PHRASE,
    });
  }

  it('keeps a toolchain refusal as a 412 with its own text', async () => {
    toolchainCheck.mockRejectedValue(
      new RestorePreconditionError('pg_restore è alla major 18, il server PostgreSQL alla 16')
    );

    await expect(restore()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'pg_restore è alla major 18, il server PostgreSQL alla 16',
    });
  });

  it('reports any other toolchain-check failure as a server fault', async () => {
    toolchainCheck.mockRejectedValue(
      new Error('connect ECONNREFUSED /var/run/postgresql/.s.PGSQL.5432')
    );

    await expect(restore()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('keeps a staging refusal as a 412', async () => {
    staging.mockRejectedValue(
      new RestorePreconditionError('L\'archivio del backup non contiene il dump del database')
    );

    await expect(restore()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Backup non ripristinabile: L\'archivio del backup non contiene il dump del database',
    });
    expect(await failedRestoreAuditMetadata()).toMatchObject({ errorCode: 'PRECONDITION_FAILED' });
  });

  it('reports a staging failure it does not recognise as a server fault', async () => {
    staging.mockRejectedValue(
      new Error("EACCES: permission denied, mkdir '/home/node/.luke/restore-tmp/x'")
    );

    await expect(restore()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    const metadata = await failedRestoreAuditMetadata();
    expect(metadata).toMatchObject({ errorCode: 'INTERNAL_SERVER_ERROR' });
    expect(JSON.stringify(metadata)).not.toContain('/home/node');
  });
});

// Goes through the real `catch` of `assertDumpReadable`, with the real `pg_restore`.
describe('assertDumpReadable', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'luke-dump-probe-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('recognises an archive written by a newer pg_dump', async () => {
    // A custom-format header is the "PGDMP" magic followed by the format version; 1.99 is newer
    // than any pg_restore reads. The probe must match it even where pg_restore is localised.
    const dumpPath = join(dir, 'newer.dump');
    await writeFile(dumpPath, Buffer.concat([Buffer.from('PGDMP'), Buffer.from([1, 99, 0])]));

    const error = await assertDumpReadable(dumpPath, createSilentLogger()).catch(e => e);

    expect(error).toBeInstanceOf(RestorePreconditionError);
    expect(error.message).toContain('1.99');
    expect(error.message).not.toContain(dumpPath);
  });

  it('does not treat a file pg_restore cannot open as a refusal', async () => {
    const error = await assertDumpReadable(join(dir, 'missing.dump'), createSilentLogger()).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RestorePreconditionError);
  });

  it('does not treat a pg_restore that cannot start as a refusal', async () => {
    vi.stubEnv('PATH', '');

    const error = await assertDumpReadable(join(dir, 'any.dump'), createSilentLogger()).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RestorePreconditionError);
  });
});
