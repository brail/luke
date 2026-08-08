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

  it('produce key diverse per tier diversi sullo stesso tick (bug plausibile: collisione fra i due file di un tick)', () => {
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

  it('scrive un unico file .ndjson.gz nel bucket backups, con le righe attese decomprimibili in ordine', async () => {
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

  it('passa bucket/contentType/bypassSizeLimit corretti al provider (scrittura privata, non un upload utente)', async () => {
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

  it('pagina il recupero delle righe oltre il batch di fetch, senza perdere né duplicare righe (bug plausibile: off-by-one sul chunking degli id)', async () => {
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

  it('non va in errore con un array di id vuoto (produce un archivio vuoto ma valido)', async () => {
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
