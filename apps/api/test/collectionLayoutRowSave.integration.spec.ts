/**
 * Deferred commit of the collection row drawer: `rows.create`/`rows.update` now
 * sync quotations + phase + planning group within the same row transaction,
 * with a single consolidated audit for the row (plus one for each quotation
 * touched, as before) — instead of the immediate mutations
 * (`quotations.create/update/delete`, `rows.changePhase`, removed) that wrote
 * to the DB regardless of the drawer's Save/Cancel.
 *
 * Covers: quotation sync (create/update/delete by diff), a quotation id
 * foreign to the row (BAD_REQUEST, rollback of the entire transaction), phase/
 * group diff in the metadata only when they actually change, phase-change note
 * never written if the phase doesn't change, and the idempotency of
 * `bulkAssignPlanningGroup` (collateral fix in `collectionLayout.service.ts`:
 * reassigning to the same group must not touch the row).
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let groupId: string;
let phase1Id: string;
let phase2Id: string;

const asAdmin = () => createCallerWithSession(adminSession);

async function createBaseRow() {
  return asAdmin().collectionLayout.rows.create({
    groupId,
    gender: 'UOMO',
    line: `Riga ${randomUUID().slice(0, 8)}`,
    status: COLLECTION_STATUS[0],
    productCategory: 'TEST',
    skuForecast: null,
    qtyForecast: null,
  });
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();

  const admin = await createTestUser('admin');
  adminSession = admin.session;

  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `RB${uid}`, name: `Row Brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `RS${uid}`, name: `Row Season ${uid}`, year: 2033, isActive: true } }),
  ]);

  const layout = await asAdmin().collectionLayout.getOrCreate({
    brandId: brand.id,
    seasonId: season.id,
    availableGenders: ['UOMO'],
  });
  const group = await asAdmin().collectionLayout.groups.create({
    collectionLayoutId: layout.id,
    data: { name: 'Gruppo', order: 0 },
  });
  groupId = group.id;

  const [phase1, phase2] = await Promise.all([
    prisma.phase.create({ data: { value: `PH1_${uid}`, label: 'Fase 1', order: 100, isActive: true } }),
    prisma.phase.create({ data: { value: `PH2_${uid}`, label: 'Fase 2', order: 101, isActive: true } }),
  ]);
  phase1Id = phase1.id;
  phase2Id = phase2.id;
});

describe('rows.update — sync quotazioni', () => {
  it('crea, aggiorna ed elimina quotazioni in un solo salvataggio, con audit per-quotazione', async () => {
    const row = await createBaseRow();

    await asAdmin().collectionLayout.rows.update({
      rowId: row.id,
      data: {
        quotations: [
          { retailPrice: 100, notes: 'q1' },
          { retailPrice: 200, notes: 'q2' },
        ],
      },
    });

    const stored = await prisma.collectionRowQuotation.findMany({
      where: { rowId: row.id },
      orderBy: { order: 'asc' },
    });
    expect(stored).toHaveLength(2);
    expect(stored.map(q => q.notes)).toEqual(['q1', 'q2']);

    const createAudits = await prisma.auditLog.findMany({
      where: { action: 'COLLECTION_QUOTATION_CREATE', targetId: { in: stored.map(q => q.id) } },
    });
    expect(createAudits).toHaveLength(2);

    const q1Id = stored.find(q => q.notes === 'q1')!.id;
    const q2Id = stored.find(q => q.notes === 'q2')!.id;

    await asAdmin().collectionLayout.rows.update({
      rowId: row.id,
      data: {
        quotations: [
          { id: q1Id, retailPrice: 150, notes: 'q1-updated' },
          { retailPrice: 300, notes: 'q3' },
        ],
      },
    });

    const after = await prisma.collectionRowQuotation.findMany({
      where: { rowId: row.id },
      orderBy: { order: 'asc' },
    });
    expect(after).toHaveLength(2);
    expect(after.map(q => q.notes).sort()).toEqual(['q1-updated', 'q3']);
    expect(after.find(q => q.id === q1Id)?.retailPrice).toBe(150);

    expect(
      await prisma.auditLog.findFirst({ where: { action: 'COLLECTION_QUOTATION_UPDATE', targetId: q1Id } })
    ).not.toBeNull();
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'COLLECTION_QUOTATION_DELETE', targetId: q2Id } })
    ).not.toBeNull();
    expect(await prisma.collectionRowQuotation.findUnique({ where: { id: q2Id } })).toBeNull();
  });

  it('un id di quotazione di un\'altra riga → BAD_REQUEST, transazione intera annullata', async () => {
    const rowA = await createBaseRow();
    const rowB = await createBaseRow();

    await asAdmin().collectionLayout.rows.update({
      rowId: rowB.id,
      data: { quotations: [{ retailPrice: 50 }] },
    });
    const foreign = await prisma.collectionRowQuotation.findFirstOrThrow({ where: { rowId: rowB.id } });

    await expect(
      asAdmin().collectionLayout.rows.update({
        rowId: rowA.id,
        // The change to `line` in the same request must not survive: the
        // quotation sync fails inside the same transaction as the row update.
        data: { line: 'NON DEVE SALVARSI', quotations: [{ id: foreign.id, retailPrice: 999 }] },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const stillForeign = await prisma.collectionRowQuotation.findUnique({ where: { id: foreign.id } });
    expect(stillForeign?.rowId).toBe(rowB.id);
    expect(stillForeign?.retailPrice).toBe(50);
    expect(await prisma.collectionRowQuotation.count({ where: { rowId: rowA.id } })).toBe(0);

    const rowAAfter = await prisma.collectionLayoutRow.findUniqueOrThrow({ where: { id: rowA.id } });
    expect(rowAAfter.line).not.toBe('NON DEVE SALVARSI');
  });
});

describe('rows.create — quotazioni al volo', () => {
  it('crea la riga con le quotazioni nella stessa richiesta, con audit per-quotazione', async () => {
    const row = await asAdmin().collectionLayout.rows.create({
      groupId,
      gender: 'UOMO',
      line: `Riga con preventivo ${randomUUID().slice(0, 8)}`,
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
      quotations: [{ retailPrice: 42 }],
    });

    const stored = await prisma.collectionRowQuotation.findMany({ where: { rowId: row.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].retailPrice).toBe(42);
    expect(
      await prisma.auditLog.count({ where: { action: 'COLLECTION_QUOTATION_CREATE', targetId: stored[0].id } })
    ).toBe(1);
  });
});

describe('rows.update — diff fase consolidato nell\'audit', () => {
  it('cambio fase reale produce un solo COLLECTION_ROW_UPDATE con old/new/nota, nessun evento separato', async () => {
    const row = await createBaseRow();

    await asAdmin().collectionLayout.rows.update({
      rowId: row.id,
      data: { phaseId: phase1Id },
    });
    const firstAudit = await prisma.auditLog.findFirst({
      where: { action: 'COLLECTION_ROW_UPDATE', targetId: row.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(firstAudit?.metadata).toMatchObject({ oldPhaseId: null, newPhaseId: phase1Id });

    await asAdmin().collectionLayout.rows.update({
      rowId: row.id,
      data: { phaseId: phase2Id, phaseChangeNote: 'motivazione del cambio' },
    });
    const secondAudit = await prisma.auditLog.findFirst({
      where: { action: 'COLLECTION_ROW_UPDATE', targetId: row.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(secondAudit?.metadata).toMatchObject({
      oldPhaseId: phase1Id,
      newPhaseId: phase2Id,
      phaseChangeNote: 'motivazione del cambio',
    });

    // The dedicated `rows.changePhase` procedure has been removed (absorbed by `rows.update`):
    // no record should ever appear with that action for rows created in this session.
    expect(
      await prisma.auditLog.count({ where: { action: 'COLLECTION_ROW_PHASE_CHANGE', targetId: row.id } })
    ).toBe(0);
  });

  it('rinviare la stessa fase non produce diff né nota in audit — anche se una nota è presente nel payload', async () => {
    const row = await createBaseRow();
    await asAdmin().collectionLayout.rows.update({ rowId: row.id, data: { phaseId: phase1Id } });

    await asAdmin().collectionLayout.rows.update({
      rowId: row.id,
      data: { phaseId: phase1Id, phaseChangeNote: 'nota orfana: non deve finire in audit' },
    });

    const latest = await prisma.auditLog.findFirst({
      where: { action: 'COLLECTION_ROW_UPDATE', targetId: row.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(latest?.metadata).not.toHaveProperty('oldPhaseId');
    expect(latest?.metadata).not.toHaveProperty('phaseChangeNote');
  });
});

describe('rows.bulkAssignPlanningGroup — idempotenza', () => {
  it('riassegnare righe già nel gruppo target non le tocca (count 0, updatedAt invariato)', async () => {
    const row = await createBaseRow();
    const before = await prisma.collectionLayoutRow.findUniqueOrThrow({
      where: { id: row.id },
      select: { planningGroupId: true, updatedAt: true },
    });

    const result = await asAdmin().collectionLayout.rows.bulkAssignPlanningGroup({
      rowIds: [row.id],
      planningGroupId: before.planningGroupId,
    });
    expect(result.count).toBe(0);

    const after = await prisma.collectionLayoutRow.findUniqueOrThrow({
      where: { id: row.id },
      select: { updatedAt: true },
    });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('riassegnare a un gruppo diverso aggiorna la riga (count 1)', async () => {
    const row = await createBaseRow();
    const before = await prisma.collectionLayoutRow.findUniqueOrThrow({
      where: { id: row.id },
      select: { planningGroupId: true },
    });
    const currentGroup = await prisma.planningGroup.findUniqueOrThrow({
      where: { id: before.planningGroupId },
      select: { calendarId: true },
    });
    const otherGroup = await prisma.planningGroup.create({
      data: { calendarId: currentGroup.calendarId, name: `Altro ${randomUUID().slice(0, 6)}`, isDefault: false },
    });

    const result = await asAdmin().collectionLayout.rows.bulkAssignPlanningGroup({
      rowIds: [row.id],
      planningGroupId: otherGroup.id,
    });
    expect(result.count).toBe(1);

    const after = await prisma.collectionLayoutRow.findUniqueOrThrow({
      where: { id: row.id },
      select: { planningGroupId: true },
    });
    expect(after.planningGroupId).toBe(otherGroup.id);
  });
});
