/**
 * Unit tests for the Zod schemas added for the row drawer's buffered save:
 * `CollectionRowQuotationDraftSchema` and the `phaseChangeNote`/`quotations` field on
 * `CollectionLayoutRowInputSchema` (packages/core/src/schemas/collectionLayout.ts).
 */

import { describe, it, expect } from 'vitest';

import {
  CollectionLayoutRowInputSchema,
  CollectionRowQuotationDraftSchema,
} from '@luke/core';

/** Minimal fields required by `CollectionLayoutRowInputSchema` — not the object under test here,
 * just enough to pass validation of the other fields so `quotations`/`phaseChangeNote` stay isolated. */
const BASE_ROW = {
  groupId: 'group-1',
  gender: 'MAN',
  line: 'Linea test',
  status: 'ATTIVO',
  skuForecast: 10,
  qtyForecast: 100,
  productCategory: 'SHOES',
};

describe('CollectionRowQuotationDraftSchema', () => {
  it('accepts an empty object — every field optional, the "new quotation without id" case', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a valid uuid id (an existing quotation to update)', () => {
    const result = CollectionRowQuotationDraftSchema.safeParse({ id: '123e4567-e89b-12d3-a456-426614174000' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an sku that is not an integer or is below 1', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({ sku: 0 }).success).toBe(false);
    expect(CollectionRowQuotationDraftSchema.safeParse({ sku: 1.5 }).success).toBe(false);
    expect(CollectionRowQuotationDraftSchema.safeParse({ sku: 1 }).success).toBe(true);
  });

  it('rejects non-positive retailPrice/supplierQuotation', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({ retailPrice: 0 }).success).toBe(false);
    expect(CollectionRowQuotationDraftSchema.safeParse({ supplierQuotation: -1 }).success).toBe(false);
  });

  it('silently ignores `rowId` and `order` if present — they were left out of the schema, the server always recomputes them', () => {
    const result = CollectionRowQuotationDraftSchema.safeParse({ rowId: 'whatever', order: 99 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('rowId');
      expect(result.data).not.toHaveProperty('order');
    }
  });
});

describe('CollectionLayoutRowInputSchema — quotations e phaseChangeNote', () => {
  it('accepts the row without quotations/phaseChangeNote (backward compatible with the unbuffered flow)', () => {
    expect(CollectionLayoutRowInputSchema.safeParse(BASE_ROW).success).toBe(true);
  });

  it('accepts an array of valid draft quotations', () => {
    const result = CollectionLayoutRowInputSchema.safeParse({
      ...BASE_ROW,
      quotations: [{ notes: 'nuova' }, { id: '123e4567-e89b-12d3-a456-426614174000', notes: 'esistente' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects the row if one of the draft quotations is invalid (propagates the error from the nested schema)', () => {
    const result = CollectionLayoutRowInputSchema.safeParse({
      ...BASE_ROW,
      quotations: [{ id: 'not-a-uuid' }],
    });
    expect(result.success).toBe(false);
  });

  it('accetta phaseChangeNote fino a 500 caratteri', () => {
    expect(CollectionLayoutRowInputSchema.safeParse({ ...BASE_ROW, phaseChangeNote: 'x'.repeat(500) }).success).toBe(true);
  });

  it('rifiuta phaseChangeNote oltre 500 caratteri', () => {
    expect(CollectionLayoutRowInputSchema.safeParse({ ...BASE_ROW, phaseChangeNote: 'x'.repeat(501) }).success).toBe(false);
  });

  it('accetta phaseChangeNote null/assente (nota facoltativa)', () => {
    expect(CollectionLayoutRowInputSchema.safeParse({ ...BASE_ROW, phaseChangeNote: null }).success).toBe(true);
    expect(CollectionLayoutRowInputSchema.safeParse(BASE_ROW).success).toBe(true);
  });
});
