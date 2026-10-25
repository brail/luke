/**
 * The pure halves of `copyFromSeason`: a copied quotation keeps an amount only in its own currency
 * (`copiedQuotation`), and a copy refused by the database gets an answer, not a 500 (`copyFailure`).
 */

import { describe, expect, it } from 'vitest';


import { copiedQuotation, copyFailure } from '../src/services/collectionLayout.service';

import { prismaKnownError } from './helpers/prismaError';

const NOW = new Date('2026-10-16T00:00:00.000Z');
const quotation = (pricingParameterSet: { name: string; purchaseCurrency: string; sellingCurrency: string } | null) => ({
  id: 'q1', rowId: 'source-row', order: 2, notes: 'n', sku: 4, createdAt: NOW, updatedAt: NOW,
  pricingParameterSetId: pricingParameterSet ? 'source-set' : null,
  supplierQuotation: 100,
  retailPrice: 300,
  pricingParameterSet,
});
const TARGET = new Map([
  ['Pelle', { id: 'pelle', purchaseCurrency: 'USD', sellingCurrency: 'EUR' }],
  ['Tessuto', { id: 'tessuto', purchaseCurrency: 'EUR', sellingCurrency: 'EUR' }],
]);

describe('copiedQuotation', () => {
  it('takes the target set of the same name and keeps amounts in unchanged currencies', () => {
    expect(copiedQuotation(quotation({ name: 'Pelle', purchaseCurrency: 'USD', sellingCurrency: 'EUR' }), 'row', TARGET)).toEqual({
      rowId: 'row', order: 2, notes: 'n', sku: 4, pricingParameterSetId: 'pelle', supplierQuotation: 100, retailPrice: 300,
    });
  });

  it('clears an amount whose currency the target set changes', () => {
    expect(copiedQuotation(quotation({ name: 'Tessuto', purchaseCurrency: 'USD', sellingCurrency: 'EUR' }), 'row', TARGET)).toMatchObject({
      pricingParameterSetId: 'tessuto', supplierQuotation: null, retailPrice: 300,
    });
  });

  it('leaves no set and no amounts when no target set has the name', () => {
    expect(copiedQuotation(quotation({ name: 'Solo origine', purchaseCurrency: 'EUR', sellingCurrency: 'EUR' }), 'row', TARGET)).toMatchObject({
      pricingParameterSetId: null, supplierQuotation: null, retailPrice: null, notes: 'n', sku: 4,
    });
  });

  it('keeps a quotation with no set as it is', () => {
    expect(copiedQuotation(quotation(null), 'row', TARGET)).toMatchObject({
      pricingParameterSetId: null, supplierQuotation: 100, retailPrice: 300,
    });
  });
});

describe('copyFailure', () => {
  const error = prismaKnownError;

  it.each(['collection_layout_rows_planningGroupId_fkey', 'collection_row_quotations_pricingParameterSetId_fkey'])(
    'answers CONFLICT when a target reference went away (%s)',
    index => {
      expect(copyFailure(error('P2003', index))).toMatchObject({ code: 'CONFLICT' });
    },
  );

  it('answers TIMEOUT when the copy ran past its limit', () => {
    expect(copyFailure(error('P2028'))).toMatchObject({ code: 'TIMEOUT' });
  });

  it('leaves any other failure to the caller', () => {
    expect(copyFailure(error('P2003', 'collection_layout_rows_vendorId_fkey'))).toBeNull();
    expect(copyFailure(error('P2002'))).toBeNull();
    expect(copyFailure(new Error('boom'))).toBeNull();
  });
});
