import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { partialWithoutDefaults } from '../zod.js';

describe('partialWithoutDefaults', () => {
  const base = z.object({
    top: z.string().default('top'),
    inOptional: z.string().default('opt').optional(),
    inNullable: z.number().default(1).nullable().optional(),
    stacked: z.boolean().default(true).optional().default(false),
    plain: z.string(),
    nested: z.object({ inner: z.string().default('inner') }),
  });
  const partial = partialWithoutDefaults(base);

  it('applies no default to an omitted key, wherever the default sits in its chain', () => {
    expect(partial.parse({})).toEqual({});
  });

  it('passes present values and null through', () => {
    expect(partial.parse({ top: 'a', inOptional: 'b', inNullable: null, stacked: false, plain: 'c' })).toEqual({
      top: 'a', inOptional: 'b', inNullable: null, stacked: false, plain: 'c',
    });
    expect(partial.parse({ inNullable: 5 })).toEqual({ inNullable: 5 });
  });

  it('keeps the defaults inside a provided nested object: it is a whole value', () => {
    expect(partial.parse({ nested: {} })).toEqual({ nested: { inner: 'inner' } });
  });

  it('leaves a wrapper with no default under it as it is', () => {
    const described = z.string().optional().describe('kept');
    expect(partialWithoutDefaults(z.object({ described })).shape.described.unwrap()).toBe(described);
  });

  it('still validates what is present', () => {
    expect(partial.safeParse({ inNullable: 'x' }).success).toBe(false);
  });

  it('infers every key as optional, with the default gone from the type', () => {
    expectTypeOf(partial.parse({})).toEqualTypeOf<{
      top?: string | undefined;
      inOptional?: string | undefined;
      inNullable?: number | null | undefined;
      stacked?: boolean | undefined;
      plain?: string | undefined;
      nested?: { inner: string } | undefined;
    }>();
  });
});
