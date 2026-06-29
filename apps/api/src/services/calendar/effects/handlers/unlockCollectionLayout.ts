import { TRPCError } from '@trpc/server';

import type { StateEffectHandler } from '../types.js';

/**
 * Effect handler that releases the lock on a CollectionLayout previously set by a calendar event.
 */
export const unlockCollectionLayoutHandler: StateEffectHandler = {
  async validate(ctx) {
    const layout = await ctx.prisma.collectionLayout.findUnique({
      where: { id: ctx.targetEntityId },
      select: { id: true, lockedByEventId: true },
    });
    if (!layout) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'CollectionLayout non trovato' });
    }
    if (layout.lockedByEventId !== ctx.eventId) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'CollectionLayout non bloccato da questo evento',
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
      data: { lockedByEventId: null, lockedAt: null },
    });

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
  },
};
