/**
 * Unit tests for the generic helpers of `retentionSweep.ts` (paging with a cap,
 * chunking for the delete). Pure: no dependency on Prisma or on a specific
 * model, the caller provides the query/delete functions.
 */

import { describe, it, expect, vi } from 'vitest';

import { collectIdsOlderThan, deleteIdsInBatches } from '../src/lib/retentionSweep';

describe('collectIdsOlderThan', () => {
  it('si ferma quando la prima pagina è vuota', async () => {
    const findPage = vi.fn(async () => []);

    const ids = await collectIdsOlderThan(findPage, 100);

    expect(ids).toEqual([]);
    expect(findPage).toHaveBeenCalledTimes(1);
  });

  it('pagina finché il risultato non è vuoto, senza superare il cap', async () => {
    // 3 pages of 2 elements with pageSize=2, then one empty page.
    const pages = [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ];
    const findPage = vi.fn(async (skip: number, take: number) => {
      const page = pages[skip / take];
      return (page ?? []).map(id => ({ id }));
    });

    const ids = await collectIdsOlderThan(findPage, 100, 2);

    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // 3 full pages + 1 empty page to notice it's done.
    expect(findPage).toHaveBeenCalledTimes(4);
  });

  it('si ferma non appena una pagina torna più corta della take richiesta, senza un giro a vuoto in più', async () => {
    const findPage = vi.fn(async (skip: number) => {
      if (skip > 0) throw new Error('non dovrebbe pagare un secondo giro');
      // Partial page: 1 element on a take of 10 → end-of-data signal.
      return [{ id: 'only-one' }];
    });

    const ids = await collectIdsOlderThan(findPage, 100, 10);

    expect(ids).toEqual(['only-one']);
    expect(findPage).toHaveBeenCalledTimes(1);
  });

  it('non richiede mai più id di quanti ne mancano al cap (bug plausibile: take fisso ignora il cap)', async () => {
    const requestedTakes: number[] = [];
    const findPage = vi.fn(async (skip: number, take: number) => {
      requestedTakes.push(take);
      // Always-full pages: without the clamp on the cap, it would go beyond 5.
      return Array.from({ length: take }, (_, i) => ({ id: `${skip + i}` }));
    });

    const ids = await collectIdsOlderThan(findPage, 5, 3);

    expect(ids).toHaveLength(5);
    // Last page requested: only the 2 missing to reach the cap of 5, not 3.
    expect(requestedTakes).toEqual([3, 2]);
  });
});

describe('deleteIdsInBatches', () => {
  it('non chiama deleteMany se non ci sono id', async () => {
    const deleteMany = vi.fn(async () => 0);

    const deleted = await deleteIdsInBatches(deleteMany, []);

    expect(deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('spezza gli id in chunk di batchSize, ultimo chunk parziale incluso senza duplicati né perdite', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
    const seenChunks: string[][] = [];
    const deleteMany = vi.fn(async (chunk: string[]) => {
      seenChunks.push(chunk);
      return chunk.length;
    });

    const deleted = await deleteIdsInBatches(deleteMany, ids, 10);

    expect(seenChunks).toEqual([
      ids.slice(0, 10),
      ids.slice(10, 20),
      ids.slice(20, 25),
    ]);
    // No id repeated or missing across chunks (plausible bug: off-by-one on `i += batchSize`).
    expect(seenChunks.flat()).toEqual(ids);
    expect(deleted).toBe(25);
  });

  it('somma i conteggi restituiti da deleteMany, anche se diversi dalla dimensione del chunk richiesto', async () => {
    // Simulates rows already deleted by a previous tick: deleteMany counts fewer than the ids requested.
    const deleteMany = vi.fn(async (chunk: string[]) => Math.max(0, chunk.length - 1));

    const deleted = await deleteIdsInBatches(deleteMany, ['a', 'b', 'c'], 2);

    expect(deleted).toBe(1 + 0); // chunk1 [a,b] -> 1, chunk2 [c] -> 0
  });
});
