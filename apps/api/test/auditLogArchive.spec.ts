/**
 * Unit tests for `auditLogArchive.ts` — the NDJSON.gz archive written to the
 * `backups` bucket before `retentionScheduler.ts` deletes the expired rows.
 *
 * Actually decompresses the buffer written by the mock storage: checking only that "provider.put
 * was called" would test the wiring and not the content, letting through a
 * plausible bug like a broken pipe (`gzip` never closed) or bad serialization.
 */

import { gunzipSync } from 'zlib';

import { describe, it, expect, beforeEach } from 'vitest';

import type { IStorageProvider } from '@luke/core';

import { archiveAuditLogRows, auditLogArchiveKey } from '../src/lib/auditLogArchive';
import { BATCH_SIZE } from '../src/lib/retentionSweep';

import { MockStorageProvider } from './helpers/storageTestHelper';

function fakeRow(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    actorId: 'user-1',
    action: 'BRAND_CREATE',
    targetType: 'Brand',
    targetId: 'brand-1',
    result: 'SUCCESS',
    metadata: null,
    traceId: 'trace-1',
    ip: '127.0.0.1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Reads and decompresses the file written by the mock, returning the parsed NDJSON rows. */
function readArchivedRows(mockStorage: MockStorageProvider, key: string): unknown[] {
  const file = mockStorage.getFilesByBucket('backups').find(f => f.key === key);
  if (!file) throw new Error(`Nessun file archiviato con key ${key}`);
  const text = gunzipSync(file.data).toString('utf8');
  return text
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line));
}

describe('auditLogArchiveKey', () => {
  it('include anno, tickId e tier, termina in .ndjson.gz', () => {
    const key = auditLogArchiveKey('tick-abc', 'normal');

    expect(key).toMatch(/^audit-archive\/\d{4}\/tick-abc-normal\.ndjson\.gz$/);
  });

  it('produces different keys for different tiers on the same tick (plausible bug: a collision between the two files of one tick)', () => {
    const normalKey = auditLogArchiveKey('tick-xyz', 'normal');
    const criticalKey = auditLogArchiveKey('tick-xyz', 'critical');

    expect(normalKey).not.toBe(criticalKey);
  });
});

describe('archiveAuditLogRows', () => {
  let mockStorage: MockStorageProvider;

  beforeEach(() => {
    mockStorage = new MockStorageProvider();
  });

  it('writes a single .ndjson.gz file to the backups bucket, with the expected rows decompressible in order', async () => {
    const rows = [fakeRow('audit-1'), fakeRow('audit-2', { action: 'CONFIG_UPSERT' })];
    const prisma = {
      auditLog: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          rows.filter(r => where.id.in.includes(r.id)),
      },
    } as any;

    // The cast acknowledges that the mock covers only `put` (the only method exercised by
    // archiveAuditLogRows) and not the entire IStorageProvider (capabilities/get/list).
    const { key } = await archiveAuditLogRows(
      mockStorage as unknown as IStorageProvider,
      prisma,
      ['audit-1', 'audit-2'],
      'tick-1',
      'normal',
    );

    expect(key).toBe(auditLogArchiveKey('tick-1', 'normal'));
    expect(mockStorage.getFileCount()).toBe(1);

    const archived = readArchivedRows(mockStorage, key);
    expect(archived).toEqual([
      expect.objectContaining({ id: 'audit-1' }),
      expect.objectContaining({ id: 'audit-2', action: 'CONFIG_UPSERT' }),
    ]);
  });

  it('passes the correct bucket/contentType/bypassSizeLimit to the provider (a private write, not a user upload)', async () => {
    const prisma = {
      auditLog: { findMany: async () => [fakeRow('audit-1')] },
    } as any;
    let putParams: Record<string, unknown> | undefined;
    const spyingProvider: Partial<IStorageProvider> = {
      put: async params => {
        putParams = params as unknown as Record<string, unknown>;
        // Consume the stream (otherwise the upstream gzip never closes) without needing to
        // decompress it: the content is already covered by the previous test.
        for await (const _chunk of params.stream) { /* drain */ }
        return { key: params.key ?? 'unused', checksumSha256: 'unused', size: 0 };
      },
    };

    await archiveAuditLogRows(spyingProvider as IStorageProvider, prisma, ['audit-1'], 'tick-2', 'critical');

    expect(putParams).toMatchObject({
      bucket: 'backups',
      contentType: 'application/gzip',
      bypassSizeLimit: true,
    });
  });

  it('pages row retrieval beyond the fetch batch, without losing or duplicating rows (plausible bug: off-by-one in id chunking)', async () => {
    // Derives the threshold from the same constant used by the code under test (shared with
    // retentionSweep.ts) instead of a fixed number: if the batch size changes, the test stays valid.
    const ids = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => `audit-${i}`);
    const rows = ids.map(id => fakeRow(id));
    const findManyCalls: string[][] = [];
    const prisma = {
      auditLog: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          findManyCalls.push(where.id.in);
          return rows.filter(r => where.id.in.includes(r.id));
        },
      },
    } as any;

    const { key } = await archiveAuditLogRows(
      mockStorage as unknown as IStorageProvider,
      prisma,
      ids,
      'tick-3',
      'normal',
    );

    // Two pages: BATCH_SIZE + 1, not a single query with all the ids nor a lost round.
    expect(findManyCalls).toHaveLength(2);
    expect(findManyCalls[0]).toHaveLength(BATCH_SIZE);
    expect(findManyCalls[1]).toHaveLength(1);

    const archived = readArchivedRows(mockStorage, key);
    expect(archived.map((r: any) => r.id)).toEqual(ids);
  });

  it('does not fail on an empty id array (produces an empty but valid archive)', async () => {
    const prisma = { auditLog: { findMany: async () => [] } } as any;

    const { key } = await archiveAuditLogRows(
      mockStorage as unknown as IStorageProvider,
      prisma,
      [],
      'tick-4',
      'normal',
    );

    expect(readArchivedRows(mockStorage, key)).toEqual([]);
  });
});
