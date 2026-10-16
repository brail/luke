/**
 * A vendor's minimum order quantities, in pairs (#124): the colour minimum is required when a vendor
 * is created, the line and model minimums are optional, all three are whole numbers in range. An
 * update may leave them out but can never clear the colour minimum once recorded.
 */

import { describe, expect, it } from 'vitest';

import { VendorInputSchema, VendorSchema, VendorUpdateInputSchema } from '../vendor.js';

const ID = '00000000-0000-4000-8000-000000000000';
const message = (issues: { message: string }[]) => issues.map(issue => issue.message);

describe('vendor minimum order quantities', () => {
  it('requires the colour minimum on create, with one message for an empty field', () => {
    const missing = VendorInputSchema.safeParse({ name: 'Acme' });
    const emptied = VendorInputSchema.safeParse({ name: 'Acme', moqPerColor: Number.NaN });

    expect(missing.success).toBe(false);
    expect(emptied.success).toBe(false);
    expect(message(emptied.error!.issues)).toEqual([
      'Inserisci il minimo per colore: un numero intero di paia tra 1 e 100000',
    ]);
  });

  it('leaves the line and model minimums optional and clearable', () => {
    const parsed = VendorInputSchema.parse({ name: 'Acme', moqPerColor: 300, moqPerLine: null });

    expect(parsed).toMatchObject({ moqPerColor: 300, moqPerLine: null });
    expect(parsed.moqPerModel).toBeUndefined();
  });

  it.each([0, 100_001, 1.5])('refuses %s pairs', value => {
    for (const field of ['moqPerLine', 'moqPerModel', 'moqPerColor']) {
      expect(VendorInputSchema.safeParse({ name: 'Acme', moqPerColor: 300, [field]: value }).success, field).toBe(false);
    }
  });

  it('accepts the bounds', () => {
    expect(VendorInputSchema.safeParse({ name: 'Acme', moqPerColor: 1, moqPerLine: 100_000 }).success).toBe(true);
  });

  it('lets an update leave the minimums out, but never clear the colour minimum', () => {
    expect(VendorUpdateInputSchema.safeParse({ id: ID, data: { name: 'Acme' } }).success).toBe(true);
    expect(VendorUpdateInputSchema.safeParse({ id: ID, data: { moqPerColor: null } }).success).toBe(false);
    expect(VendorUpdateInputSchema.safeParse({ id: ID, data: { moqPerLine: null } }).success).toBe(true);
  });

  it('returns all three, unrecorded as null', () => {
    const vendor = {
      id: ID, name: 'Acme', countryCode: null, nickname: null, referente: null, email: null, phone: null,
      chat: null, notes: null, navVendorId: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
      moqPerLine: null, moqPerModel: null, moqPerColor: null,
    };

    expect(VendorSchema.parse(vendor)).toMatchObject({ moqPerLine: null, moqPerModel: null, moqPerColor: null });
  });
});
