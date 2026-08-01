/**
 * Test unitari per `bulkAssignRowsPlanningGroup` (collectionLayout.service.ts) — Prisma mockato
 * con i soli metodi toccati (editLock/collectionLayout/planningGroup per i guard, updateMany per
 * la mutation vera e propria).
 */

import { describe, it, expect, vi } from 'vitest';

import { bulkAssignRowsPlanningGroup } from '../src/services/collectionLayout.service';

import { expectToThrow } from './helpers';

const LAYOUT_ID = 'layout-1';
const TARGET_GROUP_ID = 'group-target';
const USER_ID = 'user-1';

interface FakePrismaOpts {
  lockedByOtherUser?: boolean;
  planningGroupExists?: boolean;
  planningGroupBrandId?: string;
  planningGroupSeasonId?: string;
  layoutBrandId?: string;
  layoutSeasonId?: string;
  updatedCount?: number;
}

function buildFakePrisma(opts: FakePrismaOpts = {}) {
  const updateManyCalls: any[] = [];

  const fake = {
    editLock: {
      findUnique: vi.fn(async () =>
        opts.lockedByOtherUser
          ? { entityType: 'COLLECTION_LAYOUT', entityId: LAYOUT_ID, lockedByUserId: 'someone-else', expiresAt: new Date(Date.now() + 60_000) }
          : null
      ),
    },
    collectionLayout: {
      findUniqueOrThrow: vi.fn(async () => ({
        brandId: opts.layoutBrandId ?? 'brand-1',
        seasonId: opts.layoutSeasonId ?? 'season-1',
      })),
    },
    planningGroup: {
      findUnique: vi.fn(async () =>
        opts.planningGroupExists === false
          ? null
          : {
              calendar: {
                brandId: opts.planningGroupBrandId ?? 'brand-1',
                seasonId: opts.planningGroupSeasonId ?? 'season-1',
              },
            }
      ),
    },
    collectionLayoutRow: {
      updateMany: vi.fn(async (args: any) => {
        updateManyCalls.push(args);
        return { count: opts.updatedCount ?? args.where.id.in.length };
      }),
    },
  };

  // Cast: sottoinsieme di PrismaClient usato dalla funzione sotto test, non l'intero client.
  return { prisma: fake as unknown as Parameters<typeof bulkAssignRowsPlanningGroup>[3], updateManyCalls };
}

describe('bulkAssignRowsPlanningGroup', () => {
  it('esclude dal where le righe già sul gruppo target, per non riscriverle inutilmente', async () => {
    const { prisma, updateManyCalls } = buildFakePrisma();
    const rowIds = ['row-1', 'row-2'];

    await bulkAssignRowsPlanningGroup(rowIds, LAYOUT_ID, TARGET_GROUP_ID, prisma, USER_ID);

    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toEqual({
      id: { in: rowIds },
      planningGroupId: { not: TARGET_GROUP_ID },
    });
    expect(updateManyCalls[0].data).toEqual({ planningGroupId: TARGET_GROUP_ID });
  });

  it('il count ritornato riflette le righe realmente modificate, non quelle selezionate', async () => {
    const { prisma } = buildFakePrisma({ updatedCount: 1 });
    const rowIds = ['row-1', 'row-2', 'row-3']; // 3 selezionate, solo 1 realmente fuori dal gruppo target

    const result = await bulkAssignRowsPlanningGroup(rowIds, LAYOUT_ID, TARGET_GROUP_ID, prisma, USER_ID);

    expect(result).toEqual({ success: true, count: 1 });
  });

  it('non scrive nulla se la riga è bloccata da un altro utente (CONFLICT)', async () => {
    const { prisma, updateManyCalls } = buildFakePrisma({ lockedByOtherUser: true });

    await expectToThrow(
      bulkAssignRowsPlanningGroup(['row-1'], LAYOUT_ID, TARGET_GROUP_ID, prisma, USER_ID),
      { code: 'CONFLICT' }
    );
    expect(updateManyCalls).toHaveLength(0);
  });

  it('non scrive nulla se il gruppo di pianificazione destinazione non esiste (NOT_FOUND)', async () => {
    const { prisma, updateManyCalls } = buildFakePrisma({ planningGroupExists: false });

    await expectToThrow(
      bulkAssignRowsPlanningGroup(['row-1'], LAYOUT_ID, TARGET_GROUP_ID, prisma, USER_ID),
      { code: 'NOT_FOUND' }
    );
    expect(updateManyCalls).toHaveLength(0);
  });

  it('non scrive nulla se il gruppo destinazione appartiene a un\'altra stagione (BAD_REQUEST)', async () => {
    const { prisma, updateManyCalls } = buildFakePrisma({ planningGroupSeasonId: 'other-season' });

    await expectToThrow(
      bulkAssignRowsPlanningGroup(['row-1'], LAYOUT_ID, TARGET_GROUP_ID, prisma, USER_ID),
      { code: 'BAD_REQUEST' }
    );
    expect(updateManyCalls).toHaveLength(0);
  });
});
