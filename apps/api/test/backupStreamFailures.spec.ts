/**
 * A backup or restore whose stream chain fails at any stage settles as a failure instead of
 * escaping as an uncaught exception, which the API's fatal handler turns into a process exit (#87).
 *
 * Unit project on purpose: the integration setup loads the app graph before any `vi.mock` applies.
 */

import { randomBytes } from 'crypto';
import { writeFile } from 'fs/promises';
import { Readable, Writable } from 'stream';
import { buffer } from 'stream/consumers';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';

import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createArchivePacker } from '../src/lib/backup/archiveFormat';
import { createBackupCipher } from '../src/lib/backup/crypto';
import { runBackupJob } from '../src/lib/backup/dumpPipeline';
import { stageBackupArchive } from '../src/lib/backup/restorePipeline';
import { getStorageProvider } from '../src/storage';

import { createSilentLogger } from './helpers/logger';
import { partialProvider } from './helpers/storageProvider';

const { DEK } = vi.hoisted(() => ({ DEK: Buffer.alloc(32, 7) }));

vi.mock('../src/storage', () => ({ getStorageProvider: vi.fn() }));
// The real one reads, or creates, the master key under the user's home.
vi.mock('../src/lib/backup/crypto', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/backup/crypto')>()),
  unwrapDek: () => DEK,
}));
// `pg_dump` writes a dump of 400 KB to its `--file` argument: enough chunks for a failure to land
// while the tar entry is still being written.
vi.mock('../src/lib/backup/pgConnection', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/backup/pgConnection')>()),
  runPgBinary: async (_binary: string, args: string[]) => {
    await writeFile(args[args.indexOf('--file') + 1]!, randomBytes(400_000));
  },
}));

const logger = createSilentLogger();
const SOURCE = { host: 'db', port: '5432', user: 'luke', password: 'x', database: 'luke' };

/** An encrypted backup blob holding one `db.dump` entry, as the dump pipeline writes it. */
async function encryptedArchive() {
  const pack = createArchivePacker();
  const { iv, cipher } = createBackupCipher(DEK);
  const bytes = buffer(cipher);
  const written = pipeline(pack, createGzip(), cipher);
  pack.entry({ name: 'db.dump' }, randomBytes(1000));
  pack.finalize();
  await written;
  return { bytes: await bytes, ivHex: iv.toString('hex'), authTagHex: cipher.getAuthTag().toString('hex') };
}

/** A client whose `backupRecord.update` only records its calls. */
function prismaRecordingUpdates() {
  const update = vi.fn(async () => ({}));
  // Only the call the backup job makes; the rest of the client is never touched.
  return { prisma: { backupRecord: { update } } as unknown as PrismaClient, update };
}

describe('stageBackupArchive', () => {
  it('rejects a backup whose auth tag does not match', async () => {
    const { bytes, ivHex, authTagHex } = await encryptedArchive();
    const tampered = `${authTagHex[0] === '0' ? '1' : '0'}${authTagHex.slice(1)}`;
    vi.mocked(getStorageProvider).mockResolvedValue(partialProvider({
      get: async () => ({ stream: Readable.from([bytes]) }),
    }));

    await expect(stageBackupArchive({
      prisma: {} as PrismaClient, // reaches only the mocked storage provider
      filename: `tampered-${randomBytes(4).toString('hex')}.bin`,
      ivHex,
      authTagHex: tampered,
      wrappedDekHex: 'unused',
      restoreFiles: false,
      logger,
    })).rejects.toThrow();
  });
});

describe('runBackupJob', () => {
  it('fails the job when the upload breaks while a tar entry is being written', async () => {
    const { prisma, update } = prismaRecordingUpdates();
    vi.mocked(getStorageProvider).mockResolvedValue(partialProvider({
      put: async ({ stream }: { stream: Readable }) => {
        for await (const _chunk of stream) stream.destroy(new Error('upload failed'));
      },
    }));

    await runBackupJob({ prisma, backupId: `test-${randomBytes(4).toString('hex')}`, scope: 'DB', logger, sourceConnection: SOURCE });

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });

  it('fails the job and closes the upload when a storage file cannot be read', async () => {
    const { prisma, update } = prismaRecordingUpdates();
    let uploaded: Readable | undefined;
    vi.mocked(getStorageProvider).mockResolvedValue(partialProvider({
      put: async ({ stream }: { stream: Readable }) => {
        uploaded = stream;
        // Drains like a real upload: held back, the `db.dump` entry would never finish.
        await pipeline(stream, new Writable({ write: (_chunk, _encoding, callback) => callback() }));
      },
      list: async () => ({ items: [{ key: 'a.png', size: 10 }], nextCursor: undefined }),
      get: async () => { throw new Error('storage read failed'); },
    }));

    await runBackupJob({ prisma, backupId: `test-${randomBytes(4).toString('hex')}`, scope: 'DB_AND_FILES', logger, sourceConnection: SOURCE });

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(uploaded?.destroyed).toBe(true);
  });
});
