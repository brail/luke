import { createRevision } from '../../collectionLayoutRevision.service.js';

import type { PrismaClient } from '@prisma/client';


/**
 * Creates a MILESTONE_LOCK revision snapshot of a CollectionLayout when it is locked by a calendar event.
 * Photos are not copied to the immutable bucket (V2 simplification — photo keys point to the original bucket).
 */
export async function createRevisionForEffect(
  prisma: PrismaClient,
  collectionLayoutId: string,
  eventId: string,
  userId: string,
): Promise<void> {
  // Use identity copyPhoto: photos stay in original bucket (V2 simplification)
  const identityCopyPhoto = async (sourceKey: string) => sourceKey;

  await createRevision(
    {
      collectionLayoutId,
      revisionTypeValue: 'MILESTONE_LOCK',
      cause: 'MILESTONE',
      milestoneId: eventId,
      notes: null,
    },
    userId,
    identityCopyPhoto,
    prisma,
  );
}
