/**
 * Router tRPC per gestione Brand
 * Implementa CRUD completo per Brand con audit logging
 */

import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';

import {
  BrandInputSchema,
  BrandIdSchema,
  BrandListInputSchema,
  BrandUpdateInputSchema,
  normalizeCode,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';
import { moveTempLogoToBrand } from '../services/brandLogo.service';

const BRAND_SELECT = {
  id: true,
  code: true,
  name: true,
  logoUrl: true,
  navBrandId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function buildWhereClause(filters: { isActive?: boolean; search?: string }): Prisma.BrandWhereInput {
  const where: Prisma.BrandWhereInput = {};

  if (typeof filters.isActive === 'boolean') {
    where.isActive = filters.isActive;
  }

  if (filters.search && filters.search.trim()) {
    where.OR = [
      { code: { contains: filters.search, mode: 'insensitive' } },
      { name: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export const brandRouter = router({
  /**
   * Lista tutti i brand con filtri opzionali e cursor pagination
   */
  list: protectedProcedure
    .use(requirePermission('brands:read'))
    .input(BrandListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const cursor = input?.cursor;
      const limit = input?.limit ?? 50;

      const items = await ctx.prisma.brand.findMany({
        where: buildWhereClause(input || {}),
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: BRAND_SELECT,
      });

      const hasMore = items.length > limit;
      const results = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? results[results.length - 1].id : null;

      return { items: results, nextCursor, hasMore: !!nextCursor };
    }),

  /**
   * Crea un nuovo brand
   */
  create: protectedProcedure
    .use(requirePermission('brands:create'))
    .use(withRateLimit('brandMutations'))
    .input(BrandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const normalizedCode = normalizeCode(input.code);
      const { tempLogoId, ...brandData } = input;

      const created = await ctx.prisma.$transaction(async tx => {
        const existingBrand = await tx.brand.findUnique({
          where: { code: normalizedCode },
        });

        if (existingBrand) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Codice brand già esistente',
          });
        }

        // Valida unicità navBrandId se fornito — dentro la transaction per evitare TOCTOU
        if (brandData.navBrandId) {
          const conflict = await tx.brand.findUnique({
            where: { navBrandId: brandData.navBrandId },
          });
          if (conflict) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Codice NAV già collegato a un altro brand',
            });
          }
        }

        return tx.brand.create({
          data: { ...brandData, code: normalizedCode },
          select: BRAND_SELECT,
        });
      }, { timeout: 15000 });

      // Sposta logo temporaneo dopo il commit
      let finalLogoUrl = created.logoUrl;
      if (tempLogoId) {
        try {
          const moveResult = await moveTempLogoToBrand(ctx, {
            tempLogoId,
            brandId: created.id,
          });
          finalLogoUrl = moveResult.url;
        } catch (moveError) {
          ctx.logger?.warn({ moveError }, 'Failed to move temp logo to brand');
        }
      }

      await logAudit(ctx, { action: 'BRAND_CREATE', targetType: 'Brand', targetId: created.id, result: 'SUCCESS', metadata: { name: created.name, code: created.code } });
      return { ...created, logoUrl: finalLogoUrl };
    }),

  /**
   * Aggiorna un brand esistente
   */
  update: protectedProcedure
    .use(requirePermission('brands:update'))
    .use(withRateLimit('brandMutations'))
    .input(BrandUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.prisma.$transaction(async tx => {
        const existingBrand = await tx.brand.findUnique({
          where: { id: input.id },
        });

        if (!existingBrand) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
        }

        if (input.data.code && input.data.code !== existingBrand.code) {
          const normalizedCode = normalizeCode(input.data.code);
          const conflictingBrand = await tx.brand.findFirst({
            where: { code: normalizedCode, id: { not: input.id } },
          });

          if (conflictingBrand) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Codice brand già esistente' });
          }

          input.data.code = normalizedCode;
        }

        // Valida unicità navBrandId se modificato
        if (input.data.navBrandId !== undefined && input.data.navBrandId !== existingBrand.navBrandId) {
          // Blocca qualsiasi cambio al collegamento NAV se già valorizzato — usare endpoint unlink
          if (existingBrand.navBrandId !== null) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Il collegamento NAV non può essere modificato. Usa "Scollega da NAV" per rimuoverlo.',
            });
          }
          if (input.data.navBrandId) {
            const conflict = await tx.brand.findFirst({
              where: { navBrandId: input.data.navBrandId, id: { not: input.id } },
            });
            if (conflict) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'Codice NAV già collegato a un altro brand',
              });
            }
          }
        }

        const { tempLogoId: _tempLogoId, ...brandUpdateData } = input.data;
        return tx.brand.update({
          where: { id: input.id },
          data: { ...brandUpdateData, updatedAt: new Date() },
          select: BRAND_SELECT,
        });
      }, { timeout: 15000 });
      await logAudit(ctx, { action: 'BRAND_UPDATE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: result.name } });
      return result;
    }),

  /**
   * Soft delete brand (isActive = false)
   */
  remove: protectedProcedure
    .use(requirePermission('brands:delete'))
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const existingBrand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });

      if (!existingBrand) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
      }

      const result = await ctx.prisma.brand.update({
        where: { id: input.id },
        data: { isActive: false, updatedAt: new Date() },
        select: BRAND_SELECT,
      });

      await logAudit(ctx, { action: 'BRAND_SOFT_DELETE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: existingBrand.name } });
      return result;
    }),

  /**
   * Scollega brand da NAV e lo soft-deletes atomicamente.
   * Blocca se il brand ha CollectionLayout o PricingParameterSet attivi.
   */
  unlink: protectedProcedure
    .use(requirePermission('brands:delete'))
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const brand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });

      if (!brand) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
      }

      if (brand.navBrandId === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Il brand non è collegato a NAV' });
      }

      const [layoutCount, pricingCount] = await Promise.all([
        ctx.prisma.collectionLayout.count({ where: { brandId: input.id } }),
        ctx.prisma.pricingParameterSet.count({ where: { brandId: input.id } }),
      ]);

      if (layoutCount > 0 || pricingCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Impossibile scollegare: il brand è usato in ${layoutCount} collection layout e ${pricingCount} set di pricing`,
        });
      }

      const result = await ctx.prisma.brand.update({
        where: { id: input.id },
        data: { navBrandId: null, isActive: false, updatedAt: new Date() },
        select: BRAND_SELECT,
      });

      await logAudit(ctx, { action: 'BRAND_NAV_UNLINK', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: brand.name, previousNavBrandId: brand.navBrandId } });
      return result;
    }),

  /**
   * Hard delete brand — solo per brand senza collegamento NAV e senza dipendenze attive.
   */
  hardDelete: protectedProcedure
    .use(requirePermission('brands:delete'))
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const brand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });

      if (!brand) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
      }

      if (brand.navBrandId !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Impossibile eliminare definitivamente un brand collegato a NAV. Usa "Scollega da NAV" prima.',
        });
      }

      const [layoutCount, pricingCount] = await Promise.all([
        ctx.prisma.collectionLayout.count({ where: { brandId: input.id } }),
        ctx.prisma.pricingParameterSet.count({ where: { brandId: input.id } }),
      ]);

      if (layoutCount > 0 || pricingCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Impossibile eliminare: il brand è usato in ${layoutCount} collection layout e ${pricingCount} set di pricing`,
        });
      }

      await ctx.prisma.brand.delete({ where: { id: input.id } });
      await logAudit(ctx, { action: 'BRAND_HARD_DELETE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: brand.name } });
      return { success: true };
    }),

  /**
   * Riattiva un brand soft-deleted (isActive = true)
   */
  restore: protectedProcedure
    .use(requirePermission('brands:update'))
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const existingBrand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });

      if (!existingBrand) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
      }

      if (existingBrand.isActive) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Brand già attivo' });
      }

      const result = await ctx.prisma.brand.update({
        where: { id: input.id },
        data: { isActive: true, updatedAt: new Date() },
        select: BRAND_SELECT,
      });

      await logAudit(ctx, { action: 'BRAND_RESTORE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: existingBrand.name } });
      return result;
    }),
});
