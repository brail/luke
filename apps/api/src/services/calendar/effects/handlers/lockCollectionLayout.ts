import { TRPCError } from '@trpc/server';

import { createRevisionForEffect } from '../revisionHelper.js';

import type { StateEffectHandler } from '../types.js';

/**
 * Effect handler that locks a CollectionLayout to a calendar event
 * and snapshots the layout as a MILESTONE_LOCK revision.
 */
export const lockCollectionLayoutHandler: StateEffectHandler = {
  async validate(ctx) {
    const layout = await ctx.prisma.collectionLayout.findUnique({
      where: { id: ctx.targetEntityId },
      select: { id: true, lockedByEventId: true },
    });
    if (!layout) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'CollectionLayout non trovato' });
    }
    if (layout.lockedByEventId && layout.lockedByEventId !== ctx.eventId) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'CollectionLayout già bloccato da un altro evento',
      });
    }
  },

  async execute(ctx) {
    const layout = await ctx.prisma.collectionLayout.findUniqueOrThrow({
      where: { id: ctx.targetEntityId },
      select: { lockedByEventId: true, lockedAt: true },
    });

    const previousStateSnapshot: Record<string, unknown> = {
      lockedByEventId: layout.lockedByEventId,
      lockedAt: layout.lockedAt?.toISOString() ?? null,
    };

    await ctx.prisma.collectionLayout.update({
      where: { id: ctx.targetEntityId },
      data: { lockedByEventId: ctx.eventId, lockedAt: new Date() },
    });

    // Create a MILESTONE revision to snapshot the layout at this point
    await createRevisionForEffect(ctx.prisma, ctx.targetEntityId, ctx.eventId, ctx.userId);

    return { previousStateSnapshot };
  },

  async rollback(ctx, snapshot) {
    await ctx.prisma.collectionLayout.update({
      where: { id: ctx.targetEntityId },
      data: {
        lockedByEventId: (snapshot.lockedByEventId as string | null) ?? null,
        lockedAt: snapshot.lockedAt ? new Date(snapshot.lockedAt as string) : null,
      },
    });
    // Revisions are immutable — not deleted on rollback
  },
};
