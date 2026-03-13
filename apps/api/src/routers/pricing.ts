/**
 * Router tRPC per Pricing: gestione parametri e calcolo prezzi
 *
 * Espone:
 *  - pricing.parameterSets.list / create / update / remove / setDefault / copyFromPreviousSeason
 *  - pricing.calculate
 */

import { z } from 'zod';

import {
  PricingParameterSetInputSchema,
  PricingParameterSetUpdateSchema,
  PricingCalculateInputSchema,
} from '@luke/core';

import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';
import {
  getParameterSets,
  getPreviousSeasonSets,
  createParameterSet,
  updateParameterSet,
  removeParameterSet,
  setAsDefault,
  calculateForward,
  calculateInverse,
  calculateMarginOnly,
} from '../services/pricing.service';

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
      return createParameterSet(
        input.brandId,
        input.seasonId,
        input.data,
        ctx.prisma
      );
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
      return updateParameterSet(
        input.data.id,
        input.brandId,
        input.seasonId,
        input.data,
        ctx.prisma
      );
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
      return setAsDefault(input.id, input.brandId, input.seasonId, ctx.prisma);
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
      return getPreviousSeasonSets(
        input.brandId,
        input.seasonId,
        ctx.prisma
      );
    }),
});

export const pricingRouter = router({
  parameterSets: parameterSetsRouter,

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
