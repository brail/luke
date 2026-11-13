/**
 * Duplicating a collection row (#56): the copy takes the source row's quotations by default, as it
 * always did, and none when `includeQuotations` is false; the audit records which.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let groupId: string;

const asAdmin = () => createCallerWithSession(adminSession);

async function createRowWithQuotations() {
  const row = await asAdmin().collectionLayout.rows.create({
    groupId,
    gender: 'MAN',
    line: `Row ${randomUUID().slice(0, 8)}`,
    status: COLLECTION_STATUS[0],
    productCategory: 'TEST',
    skuForecast: 1,
    qtyForecast: 1,
  });
  await asAdmin().collectionLayout.rows.update({
    rowId: row.id,
    data: { quotations: [{ retailPrice: 100, notes: 'q1' }, { retailPrice: 200, notes: 'q2' }] },
  });
  return row;
}

const quotationNotes = async (rowId: string) =>
  (await prisma.collectionRowQuotation.findMany({ where: { rowId }, orderBy: { order: 'asc' } })).map(q => q.notes);

const duplicateAudit = (targetId: string) =>
  prisma.auditLog.findFirstOrThrow({ where: { action: 'COLLECTION_ROW_DUPLICATE', targetId } });

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();
  adminSession = (await createTestUser('admin')).session;

  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `DB${uid}`, name: `Duplicate Brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `DS${uid}`, name: `Duplicate Season ${uid}`, year: 2034, isActive: true } }),
  ]);
  const layout = await asAdmin().collectionLayout.getOrCreate({ brandId: brand.id, seasonId: season.id, availableGenders: ['MAN'] });
  groupId = (await asAdmin().collectionLayout.groups.create({ collectionLayoutId: layout.id, data: { name: 'Gruppo', order: 0 } })).id;
});

describe('rows.duplicate — quotations', () => {
  it('copies the quotations by default', async () => {
    const row = await createRowWithQuotations();

    const copy = await asAdmin().collectionLayout.rows.duplicate({ rowId: row.id });

    expect(await quotationNotes(copy.id)).toEqual(['q1', 'q2']);
    expect((await duplicateAudit(copy.id)).metadata).toMatchObject({ sourceRowId: row.id, includeQuotations: true });
  });

  it('copies none when includeQuotations is false, and leaves the source row its own', async () => {
    const row = await createRowWithQuotations();

    const copy = await asAdmin().collectionLayout.rows.duplicate({ rowId: row.id, includeQuotations: false });

    expect(await quotationNotes(copy.id)).toEqual([]);
    expect(await quotationNotes(row.id)).toEqual(['q1', 'q2']);
    expect(copy.line).toBe(row.line);
    expect((await duplicateAudit(copy.id)).metadata).toMatchObject({ sourceRowId: row.id, includeQuotations: false });
  });
});
