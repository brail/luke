/**
 * An update input fills in nothing the caller left out (#225): Zod applies a default (or a
 * `.catch()`/`.prefault()` value) even inside an optional field, so an update that omits the field
 * would write it over the stored value. Every exported schema named `…Update…` or `…Patch…` is
 * checked, at any depth.
 */

import { describe, expect, it } from 'vitest';
import {
  ZodArray, ZodCatch, ZodDefault, ZodIntersection, ZodNullable, ZodObject, ZodOptional, ZodPipe, ZodPrefault, ZodType, ZodUnion,
} from 'zod';

import * as core from '../../index.js';

/** The paths of the fields that fill in a missing value, at any depth. */
function defaultedFields(schema: unknown, path = ''): string[] {
  const at = path || '(root)';
  if (schema instanceof ZodDefault || schema instanceof ZodPrefault || schema instanceof ZodCatch) {
    return [at, ...defaultedFields(schema.def.innerType, path)];
  }
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) return defaultedFields(schema.unwrap(), path);
  if (schema instanceof ZodIntersection) return [...defaultedFields(schema.def.left, path), ...defaultedFields(schema.def.right, path)];
  if (schema instanceof ZodUnion) return schema.options.flatMap(option => defaultedFields(option, path));
  if (schema instanceof ZodPipe) return defaultedFields(schema.def.in, path);
  if (schema instanceof ZodArray) return defaultedFields(schema.element, `${at}[]`);
  if (schema instanceof ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, field]) => defaultedFields(field, path ? `${path}.${key}` : key));
  }
  return [];
}

const updateSchemas = Object.entries(core).flatMap(([name, value]) =>
  /Update|Patch/.test(name) && value instanceof ZodType ? [[name, value] as const] : []
);

describe('update input schemas', () => {
  it('are found', () => {
    expect(updateSchemas.map(([name]) => name)).toEqual(expect.arrayContaining(['CompanyFunctionUpdateInputSchema', 'CompanyTeamUpdateInputSchema']));
  });

  it.each(updateSchemas)('%s carries no default', (_name, schema) => {
    expect(defaultedFields(schema)).toEqual([]);
  });

  it('an omitted field stays omitted, an explicit one applies', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(core.CompanyFunctionUpdateInputSchema.parse({ id, name: 'Product' })).toEqual({ id, name: 'Product' });
    expect(core.CompanyTeamUpdateInputSchema.parse({ id, name: 'Team' })).toEqual({ id, name: 'Team' });
    expect(core.CompanyFunctionUpdateInputSchema.parse({ id, name: 'Product', order: 3 }))
      .toEqual({ id, name: 'Product', order: 3 });
    expect(core.CompanyTeamUpdateInputSchema.parse({ id, name: 'Team', isActive: false }))
      .toEqual({ id, name: 'Team', isActive: false });
  });

  it("a function's active state is not an update; null clears a description (#237)", () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(core.CompanyFunctionUpdateInputSchema.parse({ id, name: 'Product', isActive: false }))
      .toEqual({ id, name: 'Product' });
    expect(core.CompanyFunctionUpdateInputSchema.parse({ id, name: 'Product', description: null }))
      .toEqual({ id, name: 'Product', description: null });
    expect(core.CompanyTeamUpdateInputSchema.parse({ id, name: 'Team', description: null }))
      .toEqual({ id, name: 'Team', description: null });
    // A cleared field arrives as '' or blanks: no description is null, on create too.
    expect(core.CompanyFunctionInputSchema.parse({ slug: 'product', name: 'Product', description: '  ' }).description)
      .toBeNull();
  });
});
