import type { PrismaClient } from '@prisma/client';

export interface StateEffectContext {
  prisma: PrismaClient;
  userId: string;
  eventId: string;
  effectId: string;
  targetEntityId: string;
}

export interface StateEffectHandler {
  validate(ctx: StateEffectContext): Promise<void>;
  execute(ctx: StateEffectContext): Promise<{ previousStateSnapshot: Record<string, unknown> }>;
  rollback(ctx: StateEffectContext, snapshot: Record<string, unknown>): Promise<void>;
}
