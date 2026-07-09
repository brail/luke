/**
 * tRPC router for the planning wizard's session lock (`EditLock`).
 * See `services/editLock.service.ts` for the acquire/release/assert semantics.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hasPermission, type Role } from '@luke/core';

import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { acquireLock, releaseLock } from '../services/editLock.service';

const LockEntityTypeSchema = z.enum(['SEASON_CALENDAR', 'COLLECTION_LAYOUT']);

/** SEASON_CALENDAR locks require calendar update rights, COLLECTION_LAYOUT locks require layout update rights. */
function permissionFor(entityType: z.infer<typeof LockEntityTypeSchema>) {
  return entityType === 'SEASON_CALENDAR' ? 'season_calendar:update' : 'collection_layout:update';
}

export const editLockRouter = router({
  acquire: protectedProcedure
    .use(withRateLimit('configMutations'))
    .input(z.object({ entityType: LockEntityTypeSchema, entityId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!hasPermission({ role: ctx.session!.user.role as Role }, permissionFor(input.entityType))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Permesso mancante' });
      }
      return acquireLock(input.entityType, input.entityId, ctx.session!.user.id, ctx.prisma);
    }),

  release: protectedProcedure
    .use(withRateLimit('configMutations'))
    .input(z.object({ entityType: LockEntityTypeSchema, entityId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await releaseLock(input.entityType, input.entityId, ctx.session!.user.id, ctx.prisma);
      return { success: true };
    }),
});
