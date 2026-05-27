import type { PrismaClient } from '@prisma/client';

import { createRevision } from '../../collectionLayoutRevision.service.js';

// Creates a MILESTONE revision snapshot when a CalendarEvent locks a CollectionLayout.
// Photos are NOT copied to the immutable bucket (V2 simplification — acceptable).
export async function createRevisionForEffect(
  prisma: PrismaClient,
  collectionLayoutId: string,
  eventId: string,
  userId: string,
): Promise<void> {
  const layout = await prisma.collectionLayout.findUniqueOrThrow({
    where: { id: collectionLayoutId },
    include: { rows: { select: { id: true } } },
  });

  const allRowIds = layout.rows.map(r => r.id);

  // Use identity copyPhoto: photos stay in original bucket (V2 simplification)
  const identityCopyPhoto = async (sourceKey: string) => sourceKey;

  await createRevision(
    {
      collectionLayoutId,
      revisionTypeValue: 'MILESTONE_LOCK',
      cause: 'MILESTONE',
      milestoneId: eventId,
      notes: null,
      includedRowIds: allRowIds,
    },
    userId,
    identityCopyPhoto,
    prisma,
  );
}
