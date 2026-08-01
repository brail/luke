/**
 * Invarianti del seed del catalogo `revisionType` (`prisma/seeds/collectionCatalog.ts`).
 *
 * Il catalogo contiene solo i tipi che l'utente sceglie a mano: le revisioni automatiche
 * stampano la propria etichetta senza passare da qui, quindi non c'è nessun valore che debba
 * esistere a DB perché qualcosa funzioni. Restano due proprietà del seed che nessun tipo
 * garantisce: che ogni voce rispetti il contratto del catalogo, e che non ce ne siano due
 * uguali.
 *
 * Prisma è mockato col solo `collectionCatalogItem.upsert` che il seed tocca: l'oggetto del
 * test è *cosa* viene seminato, non che Prisma scriva.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

import { CollectionCatalogItemInputSchema } from '@luke/core';

import { seedCollectionCatalog } from '../prisma/seeds/collectionCatalog';

import type { PrismaClient } from '@prisma/client';

type SeededItem = {
  type: string;
  value: string;
  label: string;
  iso9001Categories: string[];
  order: number;
};

let seeded: SeededItem[];

beforeAll(async () => {
  // Il parametro è tipizzato per poter leggere `create` dalle chiamate registrate.
  const upsert = vi.fn(async (_args: { create: SeededItem }) => ({}));
  await seedCollectionCatalog({ collectionCatalogItem: { upsert } } as unknown as PrismaClient);

  seeded = upsert.mock.calls.map(([args]) => args.create);
});

describe('seedCollectionCatalog — catalogo revisionType', () => {
  it('semina almeno una voce, altrimenti la tendina delle revisioni nasce vuota', () => {
    expect(seeded.length).toBeGreaterThan(0);
  });

  it('ogni voce seminata rispetta il contratto CollectionCatalogItemInputSchema', () => {
    // Copre l'enum delle categorie ISO e i limiti di lunghezza: una categoria scritta male nel
    // seed fallisce qui invece che a runtime, quando il router serve il catalogo.
    for (const item of seeded) {
      const parsed = CollectionCatalogItemInputSchema.safeParse(item);
      expect(parsed.success, `voce non valida: ${item.value} — ${parsed.error?.message}`).toBe(true);
    }
  });

  it('non semina due voci con lo stesso value', () => {
    // La chiave dell'upsert è (type, value): un duplicato non fallirebbe, sovrascriverebbe
    // in silenzio la voce precedente.
    const values = seeded.map(i => `${i.type}:${i.value}`);
    expect(new Set(values).size).toBe(values.length);
  });
});
