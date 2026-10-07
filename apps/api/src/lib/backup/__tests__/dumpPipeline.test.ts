import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getStorageProvider } from '../../../storage';
import { runBackupJob, type BackupLogger } from '../dumpPipeline';

/**
 * A failed backup records why. Node's dual-stack connect failure (storage down) is an
 * `AggregateError` with an empty `message`: two backups were recorded `FAILED` with an empty
 * `errorMessage` and logged nothing more (#49).
 */

vi.mock('../pgConnection', () => ({
  parseDatabaseUrl: () => ({ host: 'db', port: '5432', user: 'luke', database: 'luke', password: 'unused' }),
  runPgBinary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../storage', () => ({ getStorageProvider: vi.fn() }));

function errno(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('runBackupJob failure', () => {
  it('records and logs the reasons of an error whose own message is empty', async () => {
    const refused = new AggregateError(
      [errno('connect ECONNREFUSED ::1:8333', 'ECONNREFUSED'), errno('connect ECONNREFUSED 127.0.0.1:8333', 'ECONNREFUSED')],
      '',
    );
    vi.mocked(getStorageProvider).mockRejectedValue(refused);
    const update = vi.fn().mockResolvedValue({});
    const error = vi.fn();
    // Only the members runBackupJob touches before the storage step fails.
    const prisma = { backupRecord: { update } } as unknown as PrismaClient;
    const logger = { info: vi.fn(), warn: vi.fn(), error } as unknown as BackupLogger;

    await runBackupJob({ prisma, backupId: `test-${crypto.randomUUID()}`, scope: 'DB', logger });

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { status: 'FAILED', errorMessage: expect.stringContaining('connect ECONNREFUSED ::1:8333') },
    }));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: refused }), 'Backup: failed');
  });
});
