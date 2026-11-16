import { describe, expect, it, vi } from 'vitest';

import { bindInClause, buildNavSyncFilter, buildWhereClause, navDateOrNull, processInBatches } from '../utils.js';

import type mssql from 'mssql';
import type { Logger } from 'pino';

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger; // Only what the code calls.

/** A request that records its bound inputs. */
function fakeRequest() {
  const inputs: unknown[][] = [];
  const req = { input: (...args: unknown[]) => inputs.push(args) } as unknown as mssql.Request; // Only `input`.
  return { req, inputs };
}

describe('buildNavSyncFilter', () => {
  it('skips when no criterion is configured', () => {
    expect(buildNavSyncFilter(null, logger, 'vendor')).toEqual({ shouldSkip: true, filterMode: 'not_configured' });
  });

  it('skips an inactive entity, whatever its list', () => {
    expect(buildNavSyncFilter({ mode: 'whitelist', navNos: ['V1'], active: false }, logger, 'vendor')).toEqual({
      shouldSkip: true,
      filterMode: 'disabled',
    });
  });

  it('skips an empty whitelist: it admits no row', () => {
    expect(buildNavSyncFilter({ mode: 'whitelist', navNos: [], active: true }, logger, 'vendor')).toEqual({
      shouldSkip: true,
      filterMode: 'whitelist',
    });
  });

  it('turns a whitelist into IN with bound parameters, on the given code column', () => {
    const result = buildNavSyncFilter({ mode: 'whitelist', navNos: ['B1', 'B2'], active: true }, logger, 'brand', 'Code');
    if (result.shouldSkip) throw new Error('expected predicates');
    expect(result.filterPredicates).toEqual(['[Code] IN (@wl0, @wl1)']);
    const { req, inputs } = fakeRequest();
    result.bindParams(req);
    expect(inputs).toEqual([
      ['wl0', 'B1'],
      ['wl1', 'B2'],
    ]);
  });

  it('turns an exclude list into NOT IN on No_ by default', () => {
    const result = buildNavSyncFilter({ mode: 'exclude', navNos: ['V9'], active: true }, logger, 'vendor');
    if (result.shouldSkip) throw new Error('expected predicates');
    expect(result.filterPredicates).toEqual(['[No_] NOT IN (@ex0)']);
    const { req, inputs } = fakeRequest();
    result.bindParams(req);
    expect(inputs).toEqual([['ex0', 'V9']]);
  });

  it.each([
    ['all', ['V1']],
    ['exclude', []],
  ])('mode %s with %j reads the whole table', (mode, navNos) => {
    const result = buildNavSyncFilter({ mode, navNos, active: true }, logger, 'vendor');
    expect(result).toMatchObject({ shouldSkip: false, filterMode: mode, filterPredicates: [] });
  });
});

describe('buildWhereClause', () => {
  it('is empty without predicates', () => {
    expect(buildWhereClause([])).toBe('');
  });

  it('joins predicates with AND', () => {
    expect(buildWhereClause(['a = 1', 'b IN (@x0)'])).toBe('WHERE a = 1 AND b IN (@x0)');
  });
});

describe('navDateOrNull', () => {
  it.each([null, undefined])('reads %j as null', value => {
    expect(navDateOrNull(value)).toBeNull();
  });

  it("reads NAV's blank date 1753-01-01 as null", () => {
    expect(navDateOrNull(new Date(Date.UTC(1753, 0, 1)))).toBeNull();
  });

  it('keeps a real date', () => {
    const date = new Date(Date.UTC(2026, 10, 15));
    expect(navDateOrNull(date)).toBe(date);
  });
});

describe('bindInClause', () => {
  it('binds each value and returns the matching placeholders', () => {
    const { req, inputs } = fakeRequest();
    expect(bindInClause(req, 'sp', ['A', 'B'])).toBe('@sp0, @sp1');
    expect(inputs).toEqual([
      ['sp0', 'A'],
      ['sp1', 'B'],
    ]);
  });

  it('passes the SQL type when given', () => {
    const { req, inputs } = fakeRequest();
    const sqlType = (() => ({})) as unknown as mssql.ISqlType; // Opaque to the helper.
    bindInClause(req, 't', ['X'], sqlType);
    expect(inputs).toEqual([['t0', sqlType, 'X']]);
  });
});

describe('processInBatches', () => {
  it('handles every row, and starts a batch only after the previous one resolved', async () => {
    const events: string[] = [];
    await processInBatches([1, 2, 3, 4, 5], 2, async row => {
      events.push(`start ${row}`);
      await Promise.resolve();
      events.push(`end ${row}`);
    });
    expect(events).toEqual([
      'start 1',
      'start 2',
      'end 1',
      'end 2',
      'start 3',
      'start 4',
      'end 3',
      'end 4',
      'start 5',
      'end 5',
    ]);
  });

  it('does nothing for no rows', async () => {
    const fn = vi.fn();
    await processInBatches([], 100, fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
