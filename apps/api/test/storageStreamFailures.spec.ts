/**
 * A write whose source stream fails — before or while the provider reads it — rejects instead of
 * hanging or escaping as an uncaught exception, which the API's fatal handler turns into a process
 * exit (#87); the local provider still enforces its size limit and leaves no temporary file.
 */

import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough, Readable } from 'stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { archiveAuditLogRows } from '../src/lib/auditLogArchive';
import { LocalFsProvider } from '../src/storage/providers/local';
import { S3Provider } from '../src/storage/providers/s3';

const PUT = { bucket: 'backups', key: 'blob.bin', originalName: 'blob.bin', contentType: 'application/octet-stream', size: 0 } as const;

/** A source that sends one chunk, then fails. */
function failingSource(): Readable {
  return Readable.from((async function* () {
    yield Buffer.alloc(1024);
    throw new Error('source failed');
  })());
}

describe('LocalFsProvider.put', () => {
  let basePath: string;
  let provider: LocalFsProvider;
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'luke-storage-'));
    provider = new LocalFsProvider({ basePath, maxFileSizeMB: 1 });
    await provider.init();
  });
  afterEach(() => rm(basePath, { recursive: true, force: true }));

  const leftovers = async () => readdir(join(basePath, 'backups', '.tmp')).catch(() => []);

  it('rejects a source that has already failed, leaving no temporary file', async () => {
    const source = new PassThrough();
    source.destroy(new Error('source failed'));

    await expect(provider.put({ ...PUT, stream: source })).rejects.toThrow();
    expect(await leftovers()).toEqual([]);
  });

  it('rejects a source that fails while it is read', async () => {
    await expect(provider.put({ ...PUT, stream: failingSource() })).rejects.toThrow('source failed');
    expect(await leftovers()).toEqual([]);
  });

  it('still refuses a file over the size limit', async () => {
    const tooBig = Readable.from([Buffer.alloc(1024 * 1024), Buffer.alloc(1)]);

    await expect(provider.put({ ...PUT, stream: tooBig })).rejects.toThrow('File troppo grande (max 1048576 bytes)');
    expect(await leftovers()).toEqual([]);
  });

  it('archives no audit rows when reading them fails', async () => {
    // Only the call the archive makes; the rest of the client is never touched.
    const prisma = { auditLog: { findMany: async () => { throw new Error('database down'); } } } as unknown as PrismaClient;

    await expect(archiveAuditLogRows(provider, prisma, ['a'], 'tick', 'normal')).rejects.toThrow();
    expect(await leftovers()).toEqual([]);
  });
});

describe('S3Provider.put', () => {
  it('rejects a source that fails while it is uploaded', async () => {
    // Nothing listens on port 1: the failing source settles the upload before any request is sent.
    const provider = new S3Provider({
      endpoint: '127.0.0.1', port: 1, useSSL: false, accessKey: 'k', secretKey: 's', region: 'us-east-1',
      presignedPutTtl: 3600, presignedGetTtl: 3600,
    });

    await expect(provider.put({ ...PUT, stream: failingSource() })).rejects.toThrow('source failed');
  });
});
