/**
 * Router tRPC per gestione Season
 * Implementa CRUD completo per Season
 */

import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';

import {
  SeasonInputSchema,
  SeasonIdSchema,
  SeasonListInputSchema,
  SeasonUpdateInputSchema,
  normalizeCode,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';

const SEASON_SELECT = {
  id: true,
  code: true,
  year: true,
  name: true,
  navSeasonId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

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

      const where: Prisma.SeasonWhereInput = {};
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
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        select: SEASON_SELECT,
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
      const normalizedCode = normalizeCode(input.code);

      const created = await ctx.prisma.$transaction(async tx => {
        const existing = await tx.season.findUnique({
          where: { code: normalizedCode },
        });

        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Stagione con questo codice già esistente',
          });
        }

        // Valida unicità navSeasonId se fornito
        if (input.navSeasonId) {
          const conflict = await tx.season.findUnique({
            where: { navSeasonId: input.navSeasonId },
          });
          if (conflict) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Codice NAV già collegato a un\'altra stagione',
            });
          }
        }

        return tx.season.create({
          data: { ...input, code: normalizedCode },
          select: SEASON_SELECT,
        });
      }, { timeout: 15000 });

      await logAudit(ctx, { action: 'SEASON_CREATE', targetType: 'Season', targetId: created.id, result: 'SUCCESS', metadata: { name: created.name, code: created.code } });
      return created;
    }),

  /**
   * Aggiorna una season esistente
   */
  update: protectedProcedure
    .use(requirePermission('seasons:update'))
    .use(withRateLimit('configMutations'))
    .input(SeasonUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const season = await ctx.prisma.season.findUnique({ where: { id: input.id } });

      if (!season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });
      }

      const updateData: any = { ...input.data }; // Allows conditional code normalization before update
      if (input.data.code) {
        updateData.code = normalizeCode(input.data.code);
      }

      // Verifica unicità code se cambiato
      const targetCode = updateData.code ?? season.code;
      if (targetCode !== season.code) {
        const conflict = await ctx.prisma.season.findFirst({
          where: { code: targetCode, id: { not: input.id } },
        });
        if (conflict) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Stagione con questo codice già esistente',
          });
        }
      }

      // Valida/blocca cambio navSeasonId
      if (input.data.navSeasonId !== undefined && input.data.navSeasonId !== season.navSeasonId) {
        // Blocca qualsiasi cambio se già valorizzato — usare endpoint unlink
        if (season.navSeasonId !== null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Il collegamento NAV non può essere modificato. Usa "Scollega da NAV" per rimuoverlo.',
          });
        }
        if (input.data.navSeasonId) {
          const conflict = await ctx.prisma.season.findFirst({
            where: { navSeasonId: input.data.navSeasonId, id: { not: input.id } },
          });
          if (conflict) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Codice NAV già collegato a un\'altra stagione',
            });
          }
        }
      }

      const result = await ctx.prisma.season.update({
        where: { id: input.id },
        data: { ...updateData, updatedAt: new Date() },
        select: SEASON_SELECT,
      });
      await logAudit(ctx, { action: 'SEASON_UPDATE', targetType: 'Season', targetId: input.id, result: 'SUCCESS', metadata: { name: result.name } });
      return result;
    }),

  /**
   * Soft delete season (isActive = false)
   */
  remove: protectedProcedure
    .use(requirePermission('seasons:delete'))
    .input(SeasonIdSchema)
    .mutation(async ({ input, ctx }) => {
      const season = await ctx.prisma.season.findUnique({ where: { id: input.id } });

      if (!season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });
      }

      const result = await ctx.prisma.season.update({
        where: { id: input.id },
        data: { isActive: false, updatedAt: new Date() },
        select: SEASON_SELECT,
      });

      await logAudit(ctx, { action: 'SEASON_SOFT_DELETE', targetType: 'Season', targetId: input.id, result: 'SUCCESS', metadata: { name: season.name } });
      return result;
    }),

  /**
   * Scollega season da NAV e la soft-deletes atomicamente.
   * Blocca se la season ha CollectionLayout o PricingParameterSet attivi.
   */
  unlink: protectedProcedure
    .use(requirePermission('seasons:delete'))
    .use(withRateLimit('configMutations'))
    .input(SeasonIdSchema)
    .mutation(async ({ input, ctx }) => {
      const season = await ctx.prisma.season.findUnique({ where: { id: input.id } });

      if (!season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });
      }

      if (season.navSeasonId === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'La stagione non è collegata a NAV' });
      }

      const [layoutCount, pricingCount] = await Promise.all([
        ctx.prisma.collectionLayout.count({ where: { seasonId: input.id } }),
        ctx.prisma.pricingParameterSet.count({ where: { seasonId: input.id } }),
      ]);

      if (layoutCount > 0 || pricingCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Impossibile scollegare: la stagione è usata in ${layoutCount} collection layout e ${pricingCount} set di pricing`,
        });
      }

      const result = await ctx.prisma.season.update({
        where: { id: input.id },
        data: { navSeasonId: null, isActive: false, updatedAt: new Date() },
        select: SEASON_SELECT,
      });

      await logAudit(ctx, { action: 'SEASON_NAV_UNLINK', targetType: 'Season', targetId: input.id, result: 'SUCCESS', metadata: { name: season.name, previousNavSeasonId: season.navSeasonId } });
      return result;
    }),

  /**
   * Hard delete season — solo per season senza collegamento NAV e senza dipendenze attive.
   */
  hardDelete: protectedProcedure
    .use(requirePermission('seasons:delete'))
    .use(withRateLimit('configMutations'))
    .input(SeasonIdSchema)
    .mutation(async ({ input, ctx }) => {
      const season = await ctx.prisma.season.findUnique({ where: { id: input.id } });

      if (!season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });
      }

      if (season.navSeasonId !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Impossibile eliminare definitivamente una stagione collegata a NAV. Usa "Scollega da NAV" prima.',
        });
      }

      const [layoutCount, pricingCount] = await Promise.all([
        ctx.prisma.collectionLayout.count({ where: { seasonId: input.id } }),
        ctx.prisma.pricingParameterSet.count({ where: { seasonId: input.id } }),
      ]);

      if (layoutCount > 0 || pricingCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Impossibile eliminare: la stagione è usata in ${layoutCount} collection layout e ${pricingCount} set di pricing`,
        });
      }

      await ctx.prisma.season.delete({ where: { id: input.id } });
      await logAudit(ctx, { action: 'SEASON_HARD_DELETE', targetType: 'Season', targetId: input.id, result: 'SUCCESS', metadata: { name: season.name } });
      return { success: true };
    }),

  /**
   * Riattiva una season soft-deleted (isActive = true)
   */
  restore: protectedProcedure
    .use(requirePermission('seasons:update'))
    .input(SeasonIdSchema)
    .mutation(async ({ input, ctx }) => {
      const season = await ctx.prisma.season.findUnique({ where: { id: input.id } });

      if (!season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Stagione non trovata' });
      }

      if (season.isActive) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Stagione già attiva' });
      }

      const result = await ctx.prisma.season.update({
        where: { id: input.id },
        data: { isActive: true, updatedAt: new Date() },
        select: SEASON_SELECT,
      });

      await logAudit(ctx, { action: 'SEASON_RESTORE', targetType: 'Season', targetId: input.id, result: 'SUCCESS', metadata: { name: season.name } });
      return result;
    }),
});
