import type { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import type { StateEffectType } from '@luke/core';

import { getEffectHandler } from './registry.js';

export async function rollbackEffect(
  prisma: PrismaClient,
  executionId: string,
  userId: string,
): Promise<void> {
  const execution = await prisma.calendarEventEffectExecution.findUniqueOrThrow({
    where: { id: executionId },
    include: {
      effect: {
        select: { effectType: true, targetEntityId: true, eventId: true, id: true },
      },
    },
  });

  if (execution.rolledBackAt) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Effect già annullato' });
  }

  const handler = getEffectHandler(execution.effect.effectType as StateEffectType);
  const snapshot = execution.previousStateSnapshot as Record<string, unknown>;

  const ctx = {
    prisma,
    userId,
    eventId: execution.effect.eventId,
    effectId: execution.effect.id,
    targetEntityId: execution.effect.targetEntityId,
  };

  await prisma.$transaction(async tx => {
    const txCtx = { ...ctx, prisma: tx as unknown as PrismaClient };
    await handler.rollback(txCtx, snapshot);

    await tx.calendarEventEffectExecution.update({
      where: { id: executionId },
      data: { rolledBackAt: new Date(), rolledBackByUserId: userId },
    });
  });
}
