/**
 * Every catalog-backed field shows its item's label (#245), inactive items included, and a value no
 * item has as itself. A row keeps a deactivated item (#126): the picker lists it under its label,
 * marked, so the row shows what it holds and saves it unchanged; a new row gets no extra option.
 */

import { describe, expect, it } from 'vitest';

import { catalogLabeler, ordered, withHeldOption, type CatalogItem } from '../catalogOptions';

const item = (type: string, value: string, label: string, isActive = true): CatalogItem => ({ type, value, label, isActive });

const items = [
  item('productCategory', 'MULE', 'Mule'),
  item('productCategory', 'SANDALO', 'Sandalo', false),
  item('productCategory', 'BOOT', 'Stivale'),
  item('lineStatus', 'NEW', 'Nuovo'),
];
const catalog = catalogLabeler(items);

describe('catalogLabeler', () => {
  it('labels active and inactive items, and a value no item has as itself', () => {
    expect(catalog.label('productCategory', 'BOOT')).toBe('Stivale');
    expect(catalog.label('productCategory', 'SANDALO')).toBe('Sandalo');
    expect(catalog.label('productCategory', 'ZOCCOLO')).toBe('ZOCCOLO');
    // The same value under another type is another item.
    expect(catalog.label('lineStatus', 'BOOT')).toBe('BOOT');
  });

  it('offers active items to pickers and every item to filters, in catalog order', () => {
    expect(catalog.options('productCategory')?.map(i => i.value)).toEqual(['MULE', 'BOOT']);
    expect(catalog.all('productCategory').map(i => i.value)).toEqual(['MULE', 'SANDALO', 'BOOT']);
    expect(catalog.options('strategy')).toEqual([]);
  });

  it('has no options while loading, and labels by value', () => {
    const loading = catalogLabeler(undefined);
    expect(loading.options('productCategory')).toBeUndefined();
    expect(loading.all('productCategory')).toEqual([]);
    expect(loading.label('productCategory', 'BOOT')).toBe('BOOT');
  });

  it('orders the values present by catalog, then the values no item has, alphabetically', () => {
    expect(catalog.order('productCategory', ['ZOCCOLO', 'BOOT', 'SANDALO', 'ANFIBIO', 'BOOT'])).toEqual(['SANDALO', 'BOOT', 'ANFIBIO', 'ZOCCOLO']);
    expect(ordered(['WOMAN', 'MAN'], ['MAN', 'WOMAN'])).toEqual(['MAN', 'WOMAN']);
  });
});

describe('withHeldOption', () => {
  const active = catalog.options('productCategory');

  it('lists a held value no active item has under its label, marked as inactive', () => {
    expect(withHeldOption(catalog, 'productCategory', 'SANDALO')).toEqual([...active!, { value: 'SANDALO', label: 'Sandalo (non attiva)' }]);
    expect(withHeldOption(catalog, 'productCategory', 'ZOCCOLO').at(-1)).toEqual({ value: 'ZOCCOLO', label: 'ZOCCOLO (non attiva)' });
  });

  it('lists a held value unmarked while the catalog is still loading', () => {
    expect(withHeldOption(catalogLabeler(undefined), 'productCategory', 'BOOT')).toEqual([{ value: 'BOOT', label: 'BOOT' }]);
  });

  it('adds nothing for a held active value', () => {
    expect(withHeldOption(catalog, 'productCategory', 'MULE')).toBe(active);
  });

  it('adds nothing for a new row', () => {
    for (const held of ['', null, undefined]) expect(withHeldOption(catalog, 'productCategory', held)).toBe(active);
  });
});
