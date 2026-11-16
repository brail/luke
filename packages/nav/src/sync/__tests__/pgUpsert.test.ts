import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { PgParams } from '../../queries/pgParams.js';
import { bulkUpsert } from '../pgUpsert.js';

/** A Prisma client that records each raw statement and its parameters. */
function fakePrisma() {
  const executeRawUnsafe = vi.fn(async (_sql: string, ..._params: unknown[]) => 0);
  return { prisma: { $executeRawUnsafe: executeRawUnsafe } as unknown as PrismaClient, executeRawUnsafe }; // Only the method bulkUpsert calls.
}

describe('bulkUpsert', () => {
  it('inserts every column and updates only the non-key ones', async () => {
    const { prisma, executeRawUnsafe } = fakePrisma();
    await bulkUpsert(prisma, 'nav_pf_items', ['no'], [
      { no: 'A1', description: 'Coat', navRowversion: '42' },
      { no: 'A2', description: null, navRowversion: 43 },
    ]);

    expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...params] = executeRawUnsafe.mock.calls[0]!;
    expect(sql).toBe(
      'INSERT INTO "nav_pf_items" ("no", "description", "navRowversion") VALUES ($1, $2, $3), ($4, $5, $6) ' +
        'ON CONFLICT ("no") DO UPDATE SET "description" = EXCLUDED."description", "navRowversion" = EXCLUDED."navRowversion"'
    );
    // Values are always bound, never inlined; bigint columns are converted, missing values are null.
    expect(params).toEqual(['A1', 'Coat', 42n, 'A2', null, 43n]);
  });

  it('converts the bigint columns the caller declares', async () => {
    const { prisma, executeRawUnsafe } = fakePrisma();
    await bulkUpsert(prisma, 't', ['entryNo'], [{ entryNo: '7', headerEntryNo: 8, name: 'x' }], ['entryNo', 'headerEntryNo']);
    expect(executeRawUnsafe.mock.calls[0]!.slice(1)).toEqual([7n, 8n, 'x']);
  });

  it('splits more than 500 rows into several statements', async () => {
    const { prisma, executeRawUnsafe } = fakePrisma();
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i, value: `v${i}` }));
    await bulkUpsert(prisma, 't', ['id'], rows, []);
    expect(executeRawUnsafe.mock.calls.map(call => call.length - 1)).toEqual([1000, 1000, 2]);
  });

  it('writes nothing for no rows', async () => {
    const { prisma, executeRawUnsafe } = fakePrisma();
    await bulkUpsert(prisma, 't', ['id'], []);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('PgParams', () => {
  it('numbers placeholders after the base values', () => {
    const params = new PgParams(['season', 'brand']);
    expect(params.add('X')).toBe('$3');
    expect(params.add(4)).toBe('$4');
    expect(params.values).toEqual(['season', 'brand', 'X', 4]);
  });
});
