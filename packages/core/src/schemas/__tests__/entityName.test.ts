/**
 * A brand, season or vendor name is trimmed before its length is checked. With `.min(1)` ahead of
 * `.trim()`, a name of only spaces passed the check and was stored as an empty string.
 */

import { describe, it, expect } from 'vitest';

import { BrandInputSchema, BrandUpdateInputSchema } from '../brand.js';
import { SeasonInputSchema, SeasonUpdateInputSchema } from '../season.js';
import { VendorInputSchema, VendorUpdateInputSchema } from '../vendor.js';

const ID = '00000000-0000-4000-8000-000000000000';

const nameOf = {
  'brand create': (name: string) => BrandInputSchema.safeParse({ code: 'ACME', name }),
  'brand update': (name: string) => BrandUpdateInputSchema.safeParse({ id: ID, data: { name } }),
  'season create': (name: string) => SeasonInputSchema.safeParse({ code: 'FW26', name }),
  'season update': (name: string) => SeasonUpdateInputSchema.safeParse({ id: ID, data: { name } }),
  'vendor create': (name: string) => VendorInputSchema.safeParse({ name }),
  'vendor update': (name: string) => VendorUpdateInputSchema.safeParse({ id: ID, data: { name } }),
};

describe.each(Object.entries(nameOf))('%s name', (_, parse) => {
  it('refuses a name of only spaces', () => {
    expect(parse('   ').success).toBe(false);
  });

  it('stores the name trimmed', () => {
    const result = parse('  Acme  ');
    expect(result.success).toBe(true);
    const data = result.data as { name?: string; data?: { name?: string } };
    expect(data.name ?? data.data?.name).toBe('Acme');
  });
});
