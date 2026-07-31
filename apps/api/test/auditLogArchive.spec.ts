/**
 * Test unitari per `auditLogArchive.ts` — l'archivio NDJSON.gz scritto sul bucket
 * `backups` prima che `retentionScheduler.ts` cancelli le righe scadute.
 *
 * Decomprime davvero il buffer scritto dal mock storage: verificare solo "provider.put
 * è stato chiamato" testerebbe la wiring e non il contenuto, lasciando passare un bug
 * plausibile come un pipe rotto (`gzip` mai chiuso) o una serializzazione sbagliata.
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

/** Legge e decomprime il file scritto dal mock, restituendo le righe NDJSON parse-ate. */
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

    // Il cast riconosce che il mock copre solo `put` (unico metodo esercitato da
    // archiveAuditLogRows) e non l'intera IStorageProvider (capabilities/get/list).
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
        return mockStorage.put(params as any);
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
    // Deriva la soglia dalla stessa costante usata dal codice sotto test (condivisa con
    // retentionSweep.ts) invece di un numero fisso: se il batch size cambia, il test resta valido.
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

    // Due pagine: BATCH_SIZE + 1, non un'unica query con tutti gli id né un giro perso.
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
