import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Role } from '@luke/core';

import { router, protectedProcedure } from '../lib/trpc';
import {
  resolveContext,
  setContext,
  getUserAllowedBrandIds,
} from '../services/context.service';

export const contextRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    return resolveContext(ctx.session.user.id, ctx.prisma, ctx.session.user.role as Role);
  }),

  set: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid('Brand ID deve essere un UUID valido'),
        seasonId: z.string().uuid('Season ID deve essere un UUID valido'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const allowedBrandIds = await getUserAllowedBrandIds(userId, ctx.prisma, ctx.session.user.role as Role);
      if (allowedBrandIds && !allowedBrandIds.includes(input.brandId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Brand non accessibile',
        });
      }

      return setContext(userId, input.brandId, input.seasonId, ctx.prisma);
    }),
});
