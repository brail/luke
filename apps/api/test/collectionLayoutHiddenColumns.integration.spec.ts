/**
 * #118: a layout's hidden columns are the keys of `COLLECTION_TABLE_COLUMNS`, each once, leaving at
 * most `COLLECTION_COLUMNS_MAX_VISIBLE` visible. `updateSettings` refuses anything else, and a stored
 * value outside that rule reads as `null` (the defaults) instead of reaching the table.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_COLUMNS_DEFAULT_HIDDEN } from '@luke/core';
import { Prisma, type PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let asAdmin: ReturnType<typeof createCallerWithSession>;
let brandId: string;
let seasonId: string;
let layoutId: string;

/** The defaults leave the maximum visible. */
const MAX_HIDDEN = COLLECTION_COLUMNS_DEFAULT_HIDDEN;

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();
  asAdmin = createCallerWithSession((await createTestUser('admin')).session);
  brandId = (await prisma.brand.create({ data: { code: `HC${uid}`, name: `Hidden ${uid}`, isActive: true } })).id;
  seasonId = (await prisma.season.create({ data: { code: `H${uid}`, name: `Hidden ${uid}`, year: 2032, isActive: true } })).id;
  layoutId = (await prisma.collectionLayout.create({ data: { brandId, seasonId } })).id;
});

const save = (hiddenColumns: string[] | null) =>
  // The client is typed on the column keys; these calls send what an outdated or forged client could.
  asAdmin.collectionLayout.updateSettings({ collectionLayoutId: layoutId, hiddenColumns: hiddenColumns as never });
const read = async () => (await asAdmin.collectionLayout.get({ brandId, seasonId }))?.hiddenColumns;

describe('collectionLayout.updateSettings — hidden columns', () => {
  it('saves a list leaving the maximum visible', async () => {
    await save([...MAX_HIDDEN]);
    expect(await read()).toEqual(MAX_HIDDEN);
  });

  it('saves a reset to the defaults as SQL NULL, the one encoding of "no preference"', async () => {
    await save([...MAX_HIDDEN]);
    await save(null);
    expect(await read()).toBeNull();
    expect(await prisma.collectionLayout.count({ where: { id: layoutId, hiddenColumns: { equals: Prisma.DbNull } } })).toBe(1);
  });

  it('refuses an unknown key, a repeated key and one column too many, leaving the saved list', async () => {
    await save([...MAX_HIDDEN]);
    await expect(save([...MAX_HIDDEN.slice(1), 'dutyCategory'])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(save([...MAX_HIDDEN, 'article'])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(save([...MAX_HIDDEN.slice(1)])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await read()).toEqual(MAX_HIDDEN);
  });
});

describe('collectionLayout.get — stored hidden columns', () => {
  const store = (hiddenColumns: Prisma.InputJsonValue | typeof Prisma.DbNull | typeof Prisma.JsonNull) =>
    prisma.collectionLayout.update({ where: { id: layoutId }, data: { hiddenColumns } });

  it('drops the keys of columns that no longer exist, and repeats, keeping the rest', async () => {
    await store(['dutyCategory', ...MAX_HIDDEN, MAX_HIDDEN[0]]);
    expect(await read()).toEqual(MAX_HIDDEN);
  });

  it('reads as null, the defaults, what still leaves more than the maximum visible (AP E27 on prod)', async () => {
    await store(['gender', 'designer', 'dutyCategory', 'strategy']);
    expect(await read()).toBeNull();
  });

  it('reads SQL NULL and JSON null alike, as null', async () => {
    await store(Prisma.DbNull);
    expect(await read()).toBeNull();
    await store(Prisma.JsonNull);
    expect(await read()).toBeNull();
  });
});
