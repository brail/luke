/**
 * Unit tests for `syncRowQuotations` (collectionRow.quotation.service.ts) — the buffered
 * create/update/delete reconciliation used by the row save in the drawer. Prisma is mocked with
 * only the methods the function touches (findMany, deleteMany, update, create) — see
 * `.claude/skills/luke-test/SKILL.md` §2. The row's existence and its brand/season scope are the
 * caller's responsibility (`resolveRowBrandAccess`/`resolveGroupBrandAccess` in the router), no
 * longer this function's — see `layoutScope` passed explicitly.
 */

import { describe, it, expect, vi } from 'vitest';

import type { CollectionRowQuotationDraft } from '@luke/core';

import { syncRowQuotations } from '../src/services/collectionRow.quotation.service';

import { expectToThrow } from './helpers';

const ROW_ID = 'row-1';
const BRAND_ID = 'brand-1';
const SEASON_ID = 'season-1';
const LAYOUT_SCOPE = { brandId: BRAND_ID, seasonId: SEASON_ID };

interface FakePrismaOpts {
  existingQuotationIds?: string[];
  paramSets?: { id: string; brandId: string; seasonId: string }[];
}

function buildFakePrisma(opts: FakePrismaOpts = {}) {
  const calls = {
    deleteMany: [] as any[],
    update: [] as any[],
    create: [] as any[],
  };

  const fake = {
    collectionRowQuotation: {
      findMany: vi.fn(async () => (opts.existingQuotationIds ?? []).map(id => ({ id }))),
      deleteMany: vi.fn(async (args: any) => {
        calls.deleteMany.push(args);
        return { count: args.where.id.in.length };
      }),
      update: vi.fn(async (args: any) => {
        calls.update.push(args);
        return { id: args.where.id, ...args.data, pricingParameterSet: null };
      }),
      create: vi.fn(async (args: any) => {
        calls.create.push(args);
        return { id: `new-${calls.create.length}`, ...args.data, pricingParameterSet: null };
      }),
    },
    pricingParameterSet: {
      findMany: vi.fn(async () => opts.paramSets ?? []),
    },
  };

  // Cast: subset of PrismaClient used by syncRowQuotations, not the entire client.
  return { prisma: fake as unknown as Parameters<typeof syncRowQuotations>[3], calls };
}

describe('syncRowQuotations', () => {
  it('lancia BAD_REQUEST se un draft porta un id non appartenente a questa riga (id stale/estraneo)', async () => {
    const { prisma } = buildFakePrisma({ existingQuotationIds: ['q-1'] });
    const drafts: CollectionRowQuotationDraft[] = [{ id: 'q-from-another-row' }];

    await expectToThrow(syncRowQuotations(ROW_ID, drafts, LAYOUT_SCOPE, prisma), {
      code: 'BAD_REQUEST',
      message: 'Quotazione non trovata per questa riga',
    });
  });

  it('lancia BAD_REQUEST se il pricingParameterSetId non appartiene al brand/stagione della riga', async () => {
    const { prisma } = buildFakePrisma({
      paramSets: [{ id: 'ps-1', brandId: 'other-brand', seasonId: SEASON_ID }],
    });
    const drafts: CollectionRowQuotationDraft[] = [{ pricingParameterSetId: 'ps-1' }];

    await expectToThrow(syncRowQuotations(ROW_ID, drafts, LAYOUT_SCOPE, prisma), { code: 'BAD_REQUEST' });
  });

  it('crea i draft senza id, aggiorna quelli con id, elimina gli esistenti non più presenti', async () => {
    const { prisma, calls } = buildFakePrisma({ existingQuotationIds: ['q-keep', 'q-remove'] });
    const drafts: CollectionRowQuotationDraft[] = [
      { id: 'q-keep', notes: 'aggiornata' },
      { notes: 'nuova' },
    ];

    const result = await syncRowQuotations(ROW_ID, drafts, LAYOUT_SCOPE, prisma);

    expect(calls.deleteMany).toHaveLength(1);
    expect(calls.deleteMany[0].where.id.in).toEqual(['q-remove']);

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].where.id).toBe('q-keep');
    expect(result.updated).toHaveLength(1);

    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].data.rowId).toBe(ROW_ID);
    expect(result.created).toHaveLength(1);

    expect(result.deletedIds).toEqual(['q-remove']);
  });

  it('ricalcola `order` dalla posizione nell\'array inviato, non da un valore lato client (bug plausibile: order non risincronizzato dopo un riordino/cancellazione)', async () => {
    const { prisma, calls } = buildFakePrisma({ existingQuotationIds: ['q-a'] });
    const drafts: CollectionRowQuotationDraft[] = [
      { id: 'q-a' }, // index 0 → order atteso 0
      {}, // index 1 → order atteso 1
    ];

    await syncRowQuotations(ROW_ID, drafts, LAYOUT_SCOPE, prisma);

    expect(calls.update[0].data.order).toBe(0);
    expect(calls.create[0].data.order).toBe(1);
  });

  it('con lista vuota elimina tutte le quotazioni esistenti e non crea/aggiorna nulla', async () => {
    const { prisma, calls } = buildFakePrisma({ existingQuotationIds: ['q-1', 'q-2'] });

    const result = await syncRowQuotations(ROW_ID, [], LAYOUT_SCOPE, prisma);

    expect(calls.deleteMany[0].where.id.in.sort()).toEqual(['q-1', 'q-2']);
    expect(calls.update).toHaveLength(0);
    expect(calls.create).toHaveLength(0);
    expect(result).toEqual({ created: [], updated: [], deletedIds: ['q-1', 'q-2'] });
  });
});
