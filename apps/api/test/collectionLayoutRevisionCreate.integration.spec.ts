/**
 * `collectionLayoutRevision.create` produces only manual revisions, by construction.
 *
 * The input used to accept `cause` and `milestoneId`, and a guard in the router had to reject
 * the combinations reserved for the system — also checking the *name* of the revision type,
 * because `cause` defaulted to MANUAL and that alone wasn't enough. Now those fields aren't in
 * the input schema: the router always writes `cause: 'MANUAL'`, and there's nothing left to
 * reject. These tests pin down the property that replaced the guard — no input can get an
 * automatic revision created through this endpoint.
 *
 * Integration tier: the path goes through `resolveLayoutBrandAccess`, which reads the layout
 * from the database.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { isUniqueViolation } from '../src/lib/error';
import { createRevision } from '../src/services/collectionLayoutRevision.service';
import { resolveDefaultPlanningGroupId } from '../src/services/seasonCalendar.service';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let adminId: string;
let layoutId: string;

const asAdmin = () => createCallerWithSession(adminSession);

/** A layout of its own, so a test reads the numbers from zero. */
async function newLayout() {
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `RC${uid}`, name: `Revision Brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `RC${uid}`, name: `Revision Season ${uid}`, year: 2034, isActive: true } }),
  ]);
  const layout = await asAdmin().collectionLayout.getOrCreate({
    brandId: brand.id,
    seasonId: season.id,
    availableGenders: ['MAN'],
  });
  return { id: layout.id, brandId: brand.id, seasonId: season.id };
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const admin = await createTestUser('admin');
  adminSession = admin.session;
  adminId = admin.user.id;

  layoutId = (await newLayout()).id;
});

describe('collectionLayoutRevision.create', () => {
  it('creates a manual revision, with no linked event', async () => {
    const revision = await asAdmin().collectionLayoutRevision.create({
      collectionLayoutId: layoutId,
      revisionTypeValue: 'REVISIONE_PROGETTUALE',
      notes: 'Revisione manuale di controllo',
    });

    expect(revision.revisionTypeValue).toBe('REVISIONE_PROGETTUALE');
    expect(revision.cause).toBe('MANUAL');
    expect(revision.milestoneId).toBeNull();
  });

  it('ignores cause and milestoneId even if the client sends them anyway', async () => {
    // The cast is the point of the test: TypeScript already prevents passing those fields, here
    // we verify that not even an untyped client (direct HTTP) can force them through.
    const forged = {
      collectionLayoutId: layoutId,
      revisionTypeValue: 'REVISIONE_COSTRUTTIVA',
      cause: 'MILESTONE',
      milestoneId: randomUUID(),
    } as unknown as Parameters<ReturnType<typeof asAdmin>['collectionLayoutRevision']['create']>[0];

    const revision = await asAdmin().collectionLayoutRevision.create(forged);

    expect(revision.cause).toBe('MANUAL');
    expect(revision.milestoneId).toBeNull();
  });

  it('accepts a revision type that is not in the catalog', async () => {
    // No FK, no validation against the catalog: the pages print the string as-is. This is the
    // property that automatic revisions rely on, since they don't have (and shouldn't have) a
    // seeded entry.
    const revision = await asAdmin().collectionLayoutRevision.create({
      collectionLayoutId: layoutId,
      revisionTypeValue: 'TIPO_MAI_SEMINATO',
    });

    expect(revision.revisionTypeValue).toBe('TIPO_MAI_SEMINATO');
  });
});

describe('createRevision', () => {
  const NUMBER_CONSTRAINT = 'collection_layout_revisions_collectionLayoutId_revisionNumber_key';
  const DEDUP_CONSTRAINT = 'collection_layout_revisions_milestoneId_revisionTypeValue_key';

  const snapshot = (collectionLayoutId: string, milestoneId?: string) =>
    createRevision(
      {
        collectionLayoutId,
        revisionTypeValue: 'NUMERAZIONE',
        ...(milestoneId ? { cause: 'MILESTONE', milestoneId } : { cause: 'MANUAL' }),
      },
      adminId,
      async key => key,
      prisma
    );

  it('waits on the numbering lock, then numbers after what the holder committed', async () => {
    const { id } = await newLayout();
    await snapshot(id);

    const outcome = await whileHeld(
      holder => holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`collection-layout-revision:${id}`]),
      () => snapshot(id),
      holder =>
        holder.query(
          `INSERT INTO collection_layout_revisions (id, "collectionLayoutId", "revisionNumber", "revisionTypeValue", cause, "createdByUserId")
           VALUES ($1, $2, 1, 'NUMERAZIONE', 'MANUAL', $3)`,
          [randomUUID(), id, adminId]
        )
    );

    expect(outcome).toMatchObject({ status: 'fulfilled', value: { revision: { revisionNumber: 2 } } });
  });

  it('gives concurrent revisions distinct, consecutive numbers', async () => {
    const { id } = await newLayout();

    const created = await Promise.all(Array.from({ length: 5 }, () => snapshot(id)));

    expect(created.map(c => c.revision.revisionNumber).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('reports a repeated automatic revision on the dedup constraint, not on the number', async () => {
    const { id } = await newLayout();
    const milestoneId = randomUUID();
    await snapshot(id, milestoneId);

    const err = await snapshot(id, milestoneId).catch((e: unknown) => e);

    expect(isUniqueViolation(err, DEDUP_CONSTRAINT)).toBe(true);
    expect(isUniqueViolation(err, NUMBER_CONSTRAINT)).toBe(false);
  });

  it('snapshots every group, row and quotation past the bind limit of one statement, each under its parent', async () => {
    const { id, brandId, seasonId } = await newLayout();
    const planningGroupId = await resolveDefaultPlanningGroupId(brandId, seasonId, prisma);
    // 1400 row snapshots of 26 columns bind more values than Postgres takes in one statement (32,767).
    const ROWS_PER_GROUP = 700;
    const QUOTATIONS_PER_ROW = 3;
    for (const groupOrder of [0, 1]) {
      const group = await prisma.collectionGroup.create({
        data: { collectionLayoutId: id, name: `G${groupOrder}`, order: groupOrder, skuBudget: groupOrder },
      });
      const rows = Array.from({ length: ROWS_PER_GROUP }, (_, order) => ({
        id: randomUUID(),
        collectionLayoutId: id,
        groupId: group.id,
        planningGroupId,
        gender: 'MAN',
        line: `G${groupOrder}-R${order}`,
        status: 'NEW',
        productCategory: 'TEST',
        order,
      }));
      await prisma.collectionLayoutRow.createMany({ data: rows });
      await prisma.collectionRowQuotation.createMany({
        data: rows.flatMap(row =>
          Array.from({ length: QUOTATIONS_PER_ROW }, (_, order) => ({
            rowId: row.id,
            order,
            notes: `${row.line}-Q${order}`,
          }))
        ),
      });
    }

    const { revision } = await snapshot(id);

    expect(revision.groups.map(g => [g.name, g.skuBudget])).toEqual([['G0', 0], ['G1', 1]]);
    for (const group of revision.groups) {
      expect(group.rows.map(r => r.line)).toEqual(
        Array.from({ length: ROWS_PER_GROUP }, (_, order) => `${group.name}-R${order}`)
      );
      for (const row of group.rows) {
        expect(row.quotationRevisions.map(q => q.notes)).toEqual(
          Array.from({ length: QUOTATIONS_PER_ROW }, (_, order) => `${row.line}-Q${order}`)
        );
      }
    }
    await expect(
      prisma.collectionLayoutRow.count({ where: { collectionLayoutId: id, lastRevisedAt: null } })
    ).resolves.toBe(0);
  });
});
