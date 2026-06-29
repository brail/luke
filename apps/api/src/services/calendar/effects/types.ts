import type { PrismaClient } from '@prisma/client';

/** Runtime context passed to every StateEffectHandler method. */
export interface StateEffectContext {
  prisma: PrismaClient;
  userId: string;
  eventId: string;
  effectId: string;
  targetEntityId: string;
}

/**
 * Contract for a calendar state effect handler.
 *
 * - `validate`: Pre-flight check; throws TRPCError if the effect cannot be applied.
 * - `execute`: Applies the effect and returns a snapshot of the previous state for rollback.
 * - `rollback`: Restores the entity to the state captured in `snapshot`.
 */
export interface StateEffectHandler {
  validate(ctx: StateEffectContext): Promise<void>;
  execute(ctx: StateEffectContext): Promise<{ previousStateSnapshot: Record<string, unknown> }>;
  rollback(ctx: StateEffectContext, snapshot: Record<string, unknown>): Promise<void>;
}
