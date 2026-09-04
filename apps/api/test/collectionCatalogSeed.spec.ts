/**
 * Invariants of the `revisionType` catalog seed (`prisma/seeds/collectionCatalog.ts`).
 *
 * The catalog only contains the types the user picks by hand: automatic revisions print
 * their own label without going through this, so there's no value that needs to exist in
 * the DB for anything to work. Two properties of the seed remain that no type guarantees:
 * that every entry respects the catalog contract, and that there are no duplicates.
 *
 * Prisma is mocked with only the `collectionCatalogItem.upsert` that the seed touches: the
 * object of the test is *what* gets seeded, not that Prisma writes.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

import { CollectionCatalogItemInputSchema } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { seedCollectionCatalog } from '../prisma/seeds/collectionCatalog';


type SeededItem = {
  type: string;
  value: string;
  label: string;
  iso9001Categories: string[];
  order: number;
};

let seeded: SeededItem[];

beforeAll(async () => {
  // The parameter is typed so we can read `create` from the recorded calls.
  const upsert = vi.fn(async (_args: { create: SeededItem }) => ({}));
  await seedCollectionCatalog({ collectionCatalogItem: { upsert } } as unknown as PrismaClient);

  seeded = upsert.mock.calls.map(([args]) => args.create);
});

describe('seedCollectionCatalog — catalogo revisionType', () => {
  it('semina almeno una voce, altrimenti la tendina delle revisioni nasce vuota', () => {
    expect(seeded.length).toBeGreaterThan(0);
  });

  it('ogni voce seminata rispetta il contratto CollectionCatalogItemInputSchema', () => {
    // Covers the ISO categories enum and the length limits: a mistyped category in the seed
    // fails here instead of at runtime, when the router serves the catalog.
    for (const item of seeded) {
      const parsed = CollectionCatalogItemInputSchema.safeParse(item);
      expect(parsed.success, `voce non valida: ${item.value} — ${parsed.error?.message}`).toBe(true);
    }
  });

  it('non semina due voci con lo stesso value', () => {
    // The upsert key is (type, value): a duplicate wouldn't fail, it would silently overwrite
    // the previous entry.
    const values = seeded.map(i => `${i.type}:${i.value}`);
    expect(new Set(values).size).toBe(values.length);
  });
});
