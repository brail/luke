/**
 * The constraint a write broke, read from a real PostgreSQL refusal.
 *
 * With the driver adapter, Prisma reports the constraint of a unique (P2002) or foreign-key (P2003)
 * violation under `meta.driverAdapterError.cause.constraint.index`, not the legacy `meta.target`.
 * These run the two refusals against the database, so a driver upgrade that moves the field fails
 * here rather than turning every named check into "not this constraint" — and every constraint the
 * code names must exist, or its refusal reaches the caller as a 500 with no test failing.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { isForeignKeyViolation, isUniqueViolation } from '../src/lib/error';

import { setupTestDb } from './helpers/database';

const SRC = join(import.meta.dirname, '..', 'src');

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

describe('constraint violations', () => {
  it('a duplicate is a unique violation naming its constraint', async () => {
    await prisma.brand.create({ data: { code: 'DUP', name: 'First' } });

    const err = await prisma.brand.create({ data: { code: 'DUP', name: 'Second' } }).catch((e: unknown) => e);

    expect(isUniqueViolation(err, 'brands_code_key')).toBe(true);
    expect(isUniqueViolation(err, 'brands_navBrandId_key')).toBe(false);
    expect(isForeignKeyViolation(err, 'brands_code_key')).toBe(false);
  });

  it('a missing reference is a foreign-key violation naming its constraint', async () => {
    const err = await prisma.season
      .create({ data: { code: 'S1', name: 'S1', navSeasonId: 'NO-SUCH-NAV-SEASON' } })
      .catch((e: unknown) => e);

    expect(isForeignKeyViolation(err, 'seasons_navSeasonId_fkey')).toBe(true);
    expect(isUniqueViolation(err, 'seasons_navSeasonId_fkey')).toBe(false);
  });

  it('every constraint the code names exists in the migrated schema', async () => {
    const named = new Set<string>();
    for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
      // Production code only: a unit test names constraints inside nested fixture calls.
      if (!file.endsWith('.ts') || file.includes('__tests__')) continue;
      for (const call of readFileSync(join(SRC, file), 'utf8').matchAll(/is(?:Unique|ForeignKey)Violation\(([^)]*)\)/g)) {
        for (const literal of call[1].matchAll(/'([^']+)'/g)) named.add(literal[1]);
      }
    }
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint UNION SELECT indexname FROM pg_indexes`;
    const existing = new Set(rows.map(row => row.name));

    expect(named.size).toBeGreaterThan(10);
    expect([...named].filter(name => !existing.has(name))).toEqual([]);
  });
});
