/**
 * Router tRPC per gestione Season
 * Implementa CRUD completo per Season
 */

import { TRPCError } from '@trpc/server';

import {
  SeasonInputSchema,
  SeasonIdSchema,
  SeasonListInputSchema,
  SeasonUpdateInputSchema,
} from '@luke/core';

import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';

function normalizeSeasonCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

export const seasonRouter = router({
  /**
   * Lista season con filtri opzionali e cursor pagination
   */
  list: protectedProcedure
    .use(requirePermission('seasons:read'))
    .input(SeasonListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const cursor = input?.cursor;
      const limit = input?.limit ?? 50;

      const where: any = {};
      if (input?.isActive !== undefined) where.isActive = input.isActive;
      if (input?.search) {
        where.OR = [
          { code: { contains: input.search, mode: 'insensitive' } },
          { name: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      const items = await ctx.prisma.season.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ year: 'desc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          year: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const hasMore = items.length > limit;
      const results = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? results[results.length - 1].id : null;

      return { items: results, nextCursor, hasMore: !!nextCursor };
    }),

  /**
   * Crea una nuova season
   */
  create: protectedProcedure
    .use(requirePermission('seasons:create'))
    .use(withRateLimit('configMutations'))
    .input(SeasonInputSchema)
    .mutation(async ({ input, ctx }) => {
      const normalizedCode = normalizeSeasonCode(input.code);

      const existing = await ctx.prisma.season.findUnique({
        where: { code_year: { code: normalizedCode, year: input.year } },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Stagione con questo codice e anno già esistente',
        });
      }

      return ctx.prisma.season.create({
        data: { ...input, code: normalizedCode },
        select: {
          id: true,
          code: true,
          year: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /**
   * Aggiorna una season esistente
   */
  update: protectedProcedure
    .use(requirePermission('seasons:update'))
    .use(withRateLimit('configMutations'))
    .input(SeasonUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const season = await ctx.prisma.season.findUnique({
        where: { id: input.id },
      });

      if (!season) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Stagione non trovata',
        });
      }

      const updateData: any = { ...input.data };
      if (input.data.code) {
        updateData.code = normalizeSeasonCode(input.data.code);
      }

      const targetCode = updateData.code ?? season.code;
      const targetYear = updateData.year ?? season.year;

      const conflict = await ctx.prisma.season.findFirst({
        where: {
          code: targetCode,
          year: targetYear,
          id: { not: input.id },
        },
      });

      if (conflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Stagione con questo codice e anno già esistente',
        });
      }

      return ctx.prisma.season.update({
        where: { id: input.id },
        data: { ...updateData, updatedAt: new Date() },
        select: {
          id: true,
          code: true,
          year: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /**
   * Elimina una season (soft delete — imposta isActive = false)
   */
  remove: protectedProcedure
    .use(requirePermission('seasons:delete'))
    .input(SeasonIdSchema)
    .mutation(async ({ input, ctx }) => {
      const season = await ctx.prisma.season.findUnique({
        where: { id: input.id },
      });

      if (!season) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Stagione non trovata',
        });
      }

      return ctx.prisma.season.update({
        where: { id: input.id },
        data: { isActive: false, updatedAt: new Date() },
        select: {
          id: true,
          code: true,
          year: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),
});
