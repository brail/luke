/**
 * Test unitari per gli helper generici di `retentionSweep.ts` (paging con tetto,
 * chunking per il delete). Puri: nessuna dipendenza da Prisma o da un modello
 * specifico, il chiamante fornisce le funzioni di query/delete.
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
    // 3 pagine da 2 elementi con pageSize=2, poi una pagina vuota.
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
    // 3 pagine piene + 1 pagina vuota per accorgersi che è finita.
    expect(findPage).toHaveBeenCalledTimes(4);
  });

  it('si ferma non appena una pagina torna più corta della take richiesta, senza un giro a vuoto in più', async () => {
    const findPage = vi.fn(async (skip: number) => {
      if (skip > 0) throw new Error('non dovrebbe pagare un secondo giro');
      // Pagina parziale: 1 elemento su una take di 10 → segnale di fine dati.
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
      // Pagine sempre piene: senza il clamp sul cap, andrebbe avanti oltre 5.
      return Array.from({ length: take }, (_, i) => ({ id: `${skip + i}` }));
    });

    const ids = await collectIdsOlderThan(findPage, 5, 3);

    expect(ids).toHaveLength(5);
    // Ultima pagina richiesta: solo i 2 mancanti per arrivare al cap di 5, non 3.
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
    // Nessun id ripetuto o mancante fra i chunk (bug plausibile: off-by-one su `i += batchSize`).
    expect(seenChunks.flat()).toEqual(ids);
    expect(deleted).toBe(25);
  });

  it('somma i conteggi restituiti da deleteMany, anche se diversi dalla dimensione del chunk richiesto', async () => {
    // Simula righe già cancellate da un tick precedente: deleteMany conta meno di quanti id richiesti.
    const deleteMany = vi.fn(async (chunk: string[]) => Math.max(0, chunk.length - 1));

    const deleted = await deleteIdsInBatches(deleteMany, ['a', 'b', 'c'], 2);

    expect(deleted).toBe(1 + 0); // chunk1 [a,b] -> 1, chunk2 [c] -> 0
  });
});
