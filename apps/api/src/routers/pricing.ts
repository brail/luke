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
import { withRateLimit } from '../lib/ratelimit';
import { requirePermission } from '../lib/permissions';
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
   * Lista le varianti di parametri per un brand+season.
   * brandId e seasonId sono obbligatori.
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
   * Crea una nuova variante di parametri.
   * Se è la prima per brand+season, diventa automaticamente il default.
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
   * Aggiorna una variante esistente.
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
   * Elimina una variante.
   * Se era il default, promuove automaticamente la successiva.
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
   * Imposta una variante come default per il brand+season.
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
   * Restituisce i parametri dalla stagione più recente per quel brand.
   * Non salva nulla: serve per la funzione "Copia da stagione precedente".
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
   * Esegue il calcolo del prezzo in una delle tre modalità:
   * - forward: purchasePrice → retailPrice
   * - inverse: retailPrice → purchasePrice massimo
   * - margin: entrambi i prezzi noti → companyMargin
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

