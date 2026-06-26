import type { CalendarEventEffectExecution, PrismaClient } from '@prisma/client';
import type { StateEffectType } from '@luke/core';

import { getEffectHandler } from './registry.js';

export async function executeEffect(
  prisma: PrismaClient,
  effectId: string,
  userId: string,
): Promise<CalendarEventEffectExecution> {
  const effect = await prisma.calendarEventStateEffect.findUniqueOrThrow({
    where: { id: effectId },
    select: {
      id: true,
      eventId: true,
      effectType: true,
      targetEntityId: true,
    },
  });

  const handler = getEffectHandler(effect.effectType as StateEffectType);

  const ctx = {
    prisma,
    userId,
    eventId: effect.eventId,
    effectId: effect.id,
    targetEntityId: effect.targetEntityId,
  };

  await handler.validate(ctx);

  return prisma.$transaction(async tx => {
    const txCtx = { ...ctx, prisma: tx as unknown as PrismaClient };
    const { previousStateSnapshot } = await handler.execute(txCtx);

    return tx.calendarEventEffectExecution.create({
      data: {
        effectId: effect.id,
        eventId: effect.eventId,
        appliedByUserId: userId,
        previousStateSnapshot: previousStateSnapshot as object,
      },
    });
  });
}
