/**
 * Router tRPC per Pricing: gestione parametri e calcolo prezzi
 *
 * Espone:
 *  - pricing.parameterSets.list / create / update / remove / setDefault / copyFromPreviousSeason
 *  - pricing.calculate
 */

import { z } from 'zod';

import {
  PricingCalculateInputSchema,
  PricingParameterSetInputSchema,
  PricingParameterSetUpdateSchema,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { exportTimestamp } from '../lib/export/xlsx-streaming';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { buildPricingGridPdf, buildPricingGridXlsx } from '../services/pricing.export.service';
import {
  calculateForward,
  calculateInverse,
  calculateMarginOnly,
  createParameterSet,
  getParameterSets,
  getPreviousSeasonSets,
  removeParameterSet,
  setAsDefault,
  updateParameterSet,
} from '../services/pricing.service';

const exportRouter = router({
  /**
   * Exports the pricing parameter grid for a brand+season as an XLSX file (base64-encoded).
   *
   * @auth {pricing:read}
   * @input {{ brandId: string (UUID), seasonId: string (UUID) }}
   * @output {{ data: string (base64), filename: string }}
   */
  xlsx: protectedProcedure
    .use(requirePermission('pricing:read'))
    .input(z.object({ brandId: z.string().uuid(), seasonId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [sets, brand, season] = await Promise.all([
        ctx.prisma.pricingParameterSet.findMany({
          where: { brandId: input.brandId, seasonId: input.seasonId },
          orderBy: { orderIndex: 'asc' },
        }),
        ctx.prisma.brand.findUniqueOrThrow({ where: { id: input.brandId }, select: { name: true, code: true } }),
        ctx.prisma.season.findUniqueOrThrow({ where: { id: input.seasonId }, select: { code: true, year: true } }),
      ]);
      if (sets.length === 0) {
        const { TRPCError } = await import('@trpc/server');
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nessun parametro trovato per questo contesto' });
      }
      const buffer = await buildPricingGridXlsx(sets, brand, season);
      await logAudit(ctx, {
        action: 'PRICING_GRID_EXPORT_XLSX',
        targetType: 'Brand',
        targetId: input.brandId,
        result: 'SUCCESS',
        metadata: { brandId: input.brandId, seasonId: input.seasonId },
      });
      return { data: buffer.toString('base64'), filename: `${brand.code}-${season.code}-Griglia-${exportTimestamp()}.xlsx` };
    }),

  /**
   * Exports the pricing parameter grid for a brand+season as a PDF file (base64-encoded).
   *
   * @auth {pricing:read}
   * @input {{ brandId: string (UUID), seasonId: string (UUID) }}
   * @output {{ data: string (base64), filename: string }}
   */
  pdf: protectedProcedure
    .use(requirePermission('pricing:read'))
    .input(z.object({ brandId: z.string().uuid(), seasonId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [sets, brand, season, exportUser] = await Promise.all([
        ctx.prisma.pricingParameterSet.findMany({
          where: { brandId: input.brandId, seasonId: input.seasonId },
          orderBy: { orderIndex: 'asc' },
        }),
        ctx.prisma.brand.findUniqueOrThrow({ where: { id: input.brandId }, select: { name: true, code: true, logoKey: true } }),
        ctx.prisma.season.findUniqueOrThrow({ where: { id: input.seasonId }, select: { code: true, year: true } }),
        ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { firstName: true, lastName: true, username: true },
        }),
      ]);
      if (sets.length === 0) {
        const { TRPCError } = await import('@trpc/server');
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Nessun parametro trovato per questo contesto' });
      }
      const fullName = exportUser
        ? [exportUser.firstName, exportUser.lastName].filter(Boolean).join(' ') || exportUser.username
        : ctx.session.user.username;
      const buffer = await buildPricingGridPdf(sets, brand, season, ctx.prisma, fullName, new Date());
      await logAudit(ctx, {
        action: 'PRICING_GRID_EXPORT_PDF',
        targetType: 'Brand',
        targetId: input.brandId,
        result: 'SUCCESS',
        metadata: { brandId: input.brandId, seasonId: input.seasonId },
      });
      return { data: buffer.toString('base64'), filename: `${brand.code}-${season.code}-Griglia-${exportTimestamp()}.pdf` };
    }),
});

const parameterSetsRouter = router({
  /**
   * Lists all pricing parameter sets for the given brand+season, ordered by index.
   *
   * @auth {pricing:read}
   * @input {{ brandId: string (UUID), seasonId: string (UUID) }}
   * @output {PricingParameterSet[]}
   */
  list: protectedProcedure
    .use(requirePermission('pricing:read'))
    .input(
      z.object({
        brandId: z.string().uuid('Brand ID non valido'),
        seasonId: z.string().uuid('Season ID non valido'),
      })
    )
    .query(async ({ input, ctx }) => {
      return getParameterSets(input.brandId, input.seasonId, ctx.prisma);
    }),

  /**
   * Creates a new pricing parameter set; auto-sets it as default if it is the first for brand+season.
   *
   * @auth {pricing:update}
   * @input {{ brandId: string, seasonId: string, data: PricingParameterSetInputSchema }}
   * @output {PricingParameterSet}
   */
  create: protectedProcedure
    .use(requirePermission('pricing:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
        data: PricingParameterSetInputSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await createParameterSet(
        input.brandId,
        input.seasonId,
        input.data,
        ctx.prisma
      );
      await logAudit(ctx, { action: 'PRICING_PARAMETER_SET_CREATE', targetType: 'PricingParameterSet', targetId: result.id, result: 'SUCCESS', metadata: { brandId: input.brandId, seasonId: input.seasonId, name: result.name } });
      return result;
    }),

  /**
   * Updates an existing pricing parameter set by ID.
   *
   * @auth {pricing:update}
   * @input {{ brandId: string, seasonId: string, data: PricingParameterSetUpdateSchema }}
   * @output {PricingParameterSet}
   */
  update: protectedProcedure
    .use(requirePermission('pricing:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
        data: PricingParameterSetUpdateSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await updateParameterSet(
        input.data.id,
        input.brandId,
        input.seasonId,
        input.data,
        ctx.prisma
      );
      await logAudit(ctx, { action: 'PRICING_PARAMETER_SET_UPDATE', targetType: 'PricingParameterSet', targetId: input.data.id, result: 'SUCCESS', metadata: { brandId: input.brandId, seasonId: input.seasonId } });
      return result;
    }),

  /**
   * Deletes a pricing parameter set; auto-promotes the next set as default if needed.
   *
   * @auth {pricing:update}
   * @input {{ id: string, brandId: string, seasonId: string }}
   * @output {{ success: true }}
   */
  remove: protectedProcedure
    .use(requirePermission('pricing:update'))
    .input(
      z.object({
        id: z.string().uuid(),
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await removeParameterSet(
        input.id,
        input.brandId,
        input.seasonId,
        ctx.prisma
      );
      await logAudit(ctx, { action: 'PRICING_PARAMETER_SET_DELETE', targetType: 'PricingParameterSet', targetId: input.id, result: 'SUCCESS', metadata: { brandId: input.brandId, seasonId: input.seasonId } });
      return { success: true };
    }),

  /**
   * Sets a pricing parameter set as the default for the given brand+season.
   *
   * @auth {pricing:update}
   * @input {{ id: string, brandId: string, seasonId: string }}
   * @output {PricingParameterSet}
   */
  setDefault: protectedProcedure
    .use(requirePermission('pricing:update'))
    .input(
      z.object({
        id: z.string().uuid(),
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await setAsDefault(input.id, input.brandId, input.seasonId, ctx.prisma);
      await logAudit(ctx, { action: 'PRICING_PARAMETER_SET_SET_DEFAULT', targetType: 'PricingParameterSet', targetId: input.id, result: 'SUCCESS', metadata: { brandId: input.brandId, seasonId: input.seasonId } });
      return result;
    }),

  /**
   * Returns the parameter sets from the most recent previous season for the given brand (read-only, no save).
   *
   * @auth {pricing:read}
   * @input {{ brandId: string, seasonId: string }}
   * @output {PricingParameterSet[] from the previous season}
   */
  copyFromPreviousSeason: protectedProcedure
    .use(requirePermission('pricing:read'))
    .input(
      z.object({
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      return getPreviousSeasonSets(input.brandId, input.seasonId, ctx.prisma);
    }),
});

export const pricingRouter = router({
  parameterSets: parameterSetsRouter,
  export: exportRouter,

  /**
   * Runs a pricing calculation in one of three modes: forward (cost→retail), inverse (retail→max cost), or margin (both known→companyMargin).
   *
   * @auth {pricing:read}
   * @input {PricingCalculateInputSchema} — mode, parameterSetId, brandId, seasonId, and relevant price fields.
   * @output {Calculated pricing breakdown with margins, costs, and retail/purchase price.}
   */
  calculate: protectedProcedure
    .use(requirePermission('pricing:read'))
    .input(PricingCalculateInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Carica i parametri del set selezionato
      const paramSet = await ctx.prisma.pricingParameterSet.findUnique({
        where: { id: input.parameterSetId },
      });

      if (!paramSet) {
        const { TRPCError } = await import('@trpc/server');
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Set di parametri non trovato',
        });
      }

      if (paramSet.brandId !== input.brandId || paramSet.seasonId !== input.seasonId) {
        const { TRPCError } = await import('@trpc/server');
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Il set di parametri non appartiene al brand/stagione corrente',
        });
      }

      const params = {
        qualityControlPercent: paramSet.qualityControlPercent,
        transportInsuranceCost: paramSet.transportInsuranceCost,
        duty: paramSet.duty,
        exchangeRate: paramSet.exchangeRate,
        italyAccessoryCosts: paramSet.italyAccessoryCosts,
        tools: paramSet.tools,
        retailMultiplier: paramSet.retailMultiplier,
        optimalMargin: paramSet.optimalMargin,
        purchaseCurrency: paramSet.purchaseCurrency,
        sellingCurrency: paramSet.sellingCurrency,
      };

      if (input.mode === 'forward' && input.purchasePrice !== undefined) {
        return calculateForward(input.purchasePrice, params);
      }

      if (input.mode === 'inverse' && input.retailPrice !== undefined) {
        return calculateInverse(input.retailPrice, params);
      }

      if (
        input.mode === 'margin' &&
        input.purchasePrice !== undefined &&
        input.retailPrice !== undefined
      ) {
        return calculateMarginOnly(
          input.purchasePrice,
          input.retailPrice,
          params
        );
      }

      const { TRPCError } = await import('@trpc/server');
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Input non valido per la modalità selezionata',
      });
    }),
});

