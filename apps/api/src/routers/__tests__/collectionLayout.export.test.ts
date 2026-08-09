/**
 * Regression test for the export OOM hotfix (v2.0.0): `rowIds` must be pushed
 * into the Prisma query's nested `rows` relation instead of filtered in JS
 * after a full unfiltered fetch.
 */

import { describe, it, expect } from 'vitest';

import { buildExportInclude } from '../collectionLayout';

describe('buildExportInclude', () => {
  it('filters the rows relation by id when rowIds is provided', () => {
    const rowIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];

    const include = buildExportInclude(rowIds);

    expect(include.groups.include.rows.where).toEqual({ id: { in: rowIds } });
  });

  it('leaves the rows relation unfiltered when rowIds is omitted', () => {
    const include = buildExportInclude(undefined);

    expect(include.groups.include.rows.where).toBeUndefined();
  });

  it('leaves the rows relation unfiltered when rowIds is an empty array', () => {
    const include = buildExportInclude([]);

    expect(include.groups.include.rows.where).toBeUndefined();
  });
});
