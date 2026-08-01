/**
 * Test unitari per gli schemi Zod aggiunti al salvataggio bufferizzato del drawer riga:
 * `CollectionRowQuotationDraftSchema` e il campo `phaseChangeNote` /`quotations` su
 * `CollectionLayoutRowInputSchema` (packages/core/src/schemas/collectionLayout.ts).
 */

import { describe, it, expect } from 'vitest';

import {
  CollectionLayoutRowInputSchema,
  CollectionRowQuotationDraftSchema,
} from '@luke/core';

/** Campi minimi richiesti da `CollectionLayoutRowInputSchema` — non l'oggetto sotto test qui,
 * serve solo a passare la validazione degli altri campi per isolare `quotations`/`phaseChangeNote`. */
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
  it('accetta un oggetto vuoto — tutti i campi opzionali, caso "nuova quotazione senza id"', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({}).success).toBe(true);
  });

  it('accetta un id uuid valido (quotazione esistente da aggiornare)', () => {
    const result = CollectionRowQuotationDraftSchema.safeParse({ id: '123e4567-e89b-12d3-a456-426614174000' });
    expect(result.success).toBe(true);
  });

  it('rifiuta un id non-uuid', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rifiuta sku non intero o minore di 1', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({ sku: 0 }).success).toBe(false);
    expect(CollectionRowQuotationDraftSchema.safeParse({ sku: 1.5 }).success).toBe(false);
    expect(CollectionRowQuotationDraftSchema.safeParse({ sku: 1 }).success).toBe(true);
  });

  it('rifiuta retailPrice/supplierQuotation non positivi', () => {
    expect(CollectionRowQuotationDraftSchema.safeParse({ retailPrice: 0 }).success).toBe(false);
    expect(CollectionRowQuotationDraftSchema.safeParse({ supplierQuotation: -1 }).success).toBe(false);
  });

  it('ignora silenziosamente `rowId` e `order` se presenti — sono stati omessi dallo schema, il server li ricalcola sempre', () => {
    const result = CollectionRowQuotationDraftSchema.safeParse({ rowId: 'whatever', order: 99 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('rowId');
      expect(result.data).not.toHaveProperty('order');
    }
  });
});

describe('CollectionLayoutRowInputSchema — quotations e phaseChangeNote', () => {
  it('accetta la riga senza quotations/phaseChangeNote (retrocompatibile con il flusso non bufferizzato)', () => {
    expect(CollectionLayoutRowInputSchema.safeParse(BASE_ROW).success).toBe(true);
  });

  it('accetta un array di draft quotazioni valide', () => {
    const result = CollectionLayoutRowInputSchema.safeParse({
      ...BASE_ROW,
      quotations: [{ notes: 'nuova' }, { id: '123e4567-e89b-12d3-a456-426614174000', notes: 'esistente' }],
    });
    expect(result.success).toBe(true);
  });

  it('rifiuta la riga se una delle draft quotazioni non è valida (propaga l\'errore dal nested schema)', () => {
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
