/**
 * Concurrent merchandising writes hold what they read (#249, rule 3): a BOM save replaces the lines
 * of the save that committed before it, never merges with them; an assignment notifies from the
 * assignee it actually replaced. Each test holds the row the writer locks, commits a competing write
 * while the writer waits on it, and checks the writer acted on what committed.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerAs, createTestUser, setupTestDb } from './helpers';
import { holdRow, whileHeld } from './helpers/heldTransaction';

let prisma: PrismaClient;
let brandId: string;
let seasonId: string;

beforeEach(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `MC${uid}`, name: `Merch ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `M${uid}`, name: `Season ${uid}`, year: 2035, isActive: true } }),
  ]);
  brandId = brand.id;
  seasonId = season.id;
});

async function planRow() {
  const admin = await createCallerAs('admin');
  const plan = await admin.merchandisingPlan.getOrCreate({ brandId, seasonId });
  const row = await admin.merchandisingPlan.createRow({
    planId: plan.id, articleCode: 'ART-C6', styleDescription: 'Style', colorCode: 'C1', colorDescription: 'Black',
    gender: 'MAN', productCategory: 'SNEAKER',
  });
  return { admin, row };
}

describe('merchandisingPlan.upsertComponents under a concurrent save', () => {
  it('waits for the save holding the specsheet, then replaces its lines', async () => {
    const { admin, row } = await planRow();
    const specsheet = await admin.merchandisingPlan.upsertSpecsheet({ rowId: row.id });

    const outcome = await whileHeld(
      holdRow('merchandising_specsheets', specsheet.id),
      () => admin.merchandisingPlan.upsertComponents({
        specsheetId: specsheet.id,
        components: [{ component: 'Mine', section: 'UPPER', order: 0 }],
      }),
      // The other save commits its line while this one waits.
      holder => holder.query(
        `INSERT INTO merchandising_components (id, "specsheetId", "order", section, component, "updatedAt")
         VALUES ($1, $2, 0, 'UPPER', 'Theirs', now())`,
        [randomUUID(), specsheet.id]
      )
    );

    expect(outcome.status).toBe('fulfilled');
    const lines = await prisma.merchandisingComponent.findMany({ where: { specsheetId: specsheet.id } });
    expect(lines.map(l => l.component)).toEqual(['Mine']);
    const audit = await prisma.auditLog.findMany({ where: { action: 'MERCHANDISING_COMPONENTS_UPSERT', targetId: specsheet.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({ count: 1 });
  });

  it('answers NOT_FOUND for a specsheet deleted while it waited, and writes nothing', async () => {
    const { admin, row } = await planRow();
    const specsheet = await admin.merchandisingPlan.upsertSpecsheet({ rowId: row.id });

    const outcome = await whileHeld(
      holdRow('merchandising_specsheets', specsheet.id),
      () => admin.merchandisingPlan.upsertComponents({
        specsheetId: specsheet.id,
        components: [{ component: 'Mine', section: 'UPPER', order: 0 }],
      }),
      holder => holder.query('DELETE FROM merchandising_specsheets WHERE id = $1', [specsheet.id])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    expect(await prisma.auditLog.count({ where: { action: 'MERCHANDISING_COMPONENTS_UPSERT', targetId: specsheet.id } })).toBe(0);
  });
});

describe('merchandisingPlan.assignUser under a concurrent assignment', () => {
  it('notifies the assignee it actually replaced (owner #63 a: A → B tells A too)', async () => {
    const { admin, row } = await planRow();
    // Admins: every brand is theirs, so the assignee check passes without a brand grant.
    const [a, b] = await Promise.all([createTestUser('admin'), createTestUser('admin')]);

    // A's assignment commits while B's waits: B's then replaces A, not the empty row it saw first.
    const outcome = await whileHeld(
      holdRow('merchandising_plan_rows', row.id),
      () => admin.merchandisingPlan.assignUser({ rowId: row.id, userId: b.user.id }),
      holder => holder.query('UPDATE merchandising_plan_rows SET "assignedUserId" = $1 WHERE id = $2', [a.user.id, row.id])
    );

    expect(outcome.status).toBe('fulfilled');
    expect((await prisma.merchandisingPlanRow.findUniqueOrThrow({ where: { id: row.id } })).assignedUserId).toBe(b.user.id);
    const titles = async (userId: string) =>
      (await prisma.notification.findMany({ where: { userId }, select: { title: true } })).map(n => n.title);
    expect(await titles(b.user.id)).toEqual(['Riga assegnata']);
    expect(await titles(a.user.id)).toEqual(['Riga rimossa']);
    expect(await prisma.auditLog.count({ where: { action: 'MERCHANDISING_ROW_ASSIGN_USER', targetId: row.id } })).toBe(1);
  });

  it('an unassignment tells only the removed assignee; assigning the same user again tells no one', async () => {
    const { admin, row } = await planRow();
    const { user: a } = await createTestUser('admin');
    const count = () => prisma.notification.count({ where: { userId: a.id } });

    await admin.merchandisingPlan.assignUser({ rowId: row.id, userId: a.id });
    expect(await count()).toBe(1);
    await admin.merchandisingPlan.assignUser({ rowId: row.id, userId: a.id });
    expect(await count()).toBe(1);
    await admin.merchandisingPlan.assignUser({ rowId: row.id, userId: null });
    expect((await prisma.notification.findMany({ where: { userId: a.id }, orderBy: { createdAt: 'asc' } })).map(n => n.title))
      .toEqual(['Riga assegnata', 'Riga rimossa']);
  });
});
