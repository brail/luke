/**
 * tRPC router for the planning wizard's session lock (`EditLock`).
 * See `services/editLock.service.ts` for the acquireMany/release/assert semantics.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Permission } from '@luke/core';

import { can } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { acquireLocks, releaseLocks, renewLocks } from '../services/editLock.service';

import type { Context } from '../lib/trpc';

const LockEntityTypeSchema = z.enum(['SEASON_CALENDAR', 'COLLECTION_LAYOUT']);
const AcquireInputSchema = z.object({ entityType: LockEntityTypeSchema, entityId: z.string().uuid() });
const AcquireManyInputSchema = z.object({ entities: z.array(AcquireInputSchema).min(1) });
const ReleaseManyInputSchema = z.object({ entities: z.array(AcquireInputSchema).min(1) });

/** SEASON_CALENDAR locks require calendar update rights, COLLECTION_LAYOUT locks require layout update rights. */
function permissionFor(entityType: z.infer<typeof LockEntityTypeSchema>): Permission {
  return entityType === 'SEASON_CALENDAR' ? 'season_calendar:update' : 'collection_layout:update';
}

/**
 * AND semantics (need every entity type's permission, not just one) — `requirePermission`'s
 * array form is OR-only, so this is checked manually. Shared by `acquireMany` and `renew`.
 */
function assertLockPermissions(ctx: Context, entities: { entityType: z.infer<typeof LockEntityTypeSchema> }[]) {
  const requiredPermissions = [...new Set(entities.map(e => permissionFor(e.entityType)))];
  const missing = requiredPermissions.some(p => !can(ctx, p));
  if (missing) throw new TRPCError({ code: 'FORBIDDEN', message: 'Permesso mancante' });
}

export const editLockRouter = router({
  /**
   * Acquires locks on several entities atomically (all-or-nothing) — for flows like the planning
   * wizard that need a `SeasonCalendar` + `CollectionLayout` lock together, so a conflict on one
   * never leaves the other partially acquired. See `acquireLocks` in the edit-lock service.
   */
  acquireMany: protectedProcedure
    .input(AcquireManyInputSchema)
    .use(withRateLimit('configMutations'))
    .mutation(async ({ input, ctx }) => {
      assertLockPermissions(ctx, input.entities);
      return acquireLocks(input.entities, ctx.session!.user.id, ctx.prisma);
    }),

  /**
   * Heartbeat, called periodically by the frontend while a wizard session is open — extends the
   * TTL on locks already held by the caller. See `renewLocks` in the edit-lock service.
   */
  renew: protectedProcedure
    .input(AcquireManyInputSchema)
    .use(withRateLimit('configMutations'))
    .mutation(async ({ input, ctx }) => {
      assertLockPermissions(ctx, input.entities);
      return renewLocks(input.entities, ctx.session!.user.id, ctx.prisma);
    }),

  /** Releases locks on several entities in a single query — mirrors `acquireMany`. */
  release: protectedProcedure
    .use(withRateLimit('configMutations'))
    .input(ReleaseManyInputSchema)
    .mutation(async ({ input, ctx }) => {
      await releaseLocks(input.entities, ctx.session!.user.id, ctx.prisma);
      return { success: true };
    }),
});
