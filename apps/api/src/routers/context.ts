/**
 * Router tRPC per gestione context (Brand/Season)
 * Implementa get/set del context utente con persistenza
 * e gestione whitelist brand/season per-utente.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import {
  resolveContext,
  setContext,
  getUserAllowedBrandIds,
  getUserAllowedSeasonIds,
} from '../services/context.service';

const userIdSchema = z.object({ userId: z.string().uuid() });

/**
 * Router per gestione context utente
 */
export const contextRouter = router({
  /**
   * Ottiene il context corrente per l'utente autenticato
   * Risolve automaticamente con algoritmo deterministico:
   * lastUsed → orgDefault → firstActive
   * Rispetta il whitelist brand/season dell'utente.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    return resolveContext(ctx.session.user.id, ctx.prisma);
  }),

  /**
   * Imposta il context per l'utente autenticato
   * Valida che brand e season siano attivi e accessibili prima di salvare
   */
  set: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid('Brand ID deve essere un UUID valido'),
        seasonId: z.string().uuid('Season ID deve essere un UUID valido'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Verifica che il brand sia nel whitelist dell'utente
      const allowedBrandIds = await getUserAllowedBrandIds(userId, ctx.prisma);
      if (allowedBrandIds && !allowedBrandIds.includes(input.brandId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Brand non accessibile',
        });
      }

      // Verifica che la stagione sia nel whitelist dell'utente per questo brand
      const allowedSeasonIds = await getUserAllowedSeasonIds(
        userId,
        input.brandId,
        ctx.prisma
      );
      if (allowedSeasonIds && !allowedSeasonIds.includes(input.seasonId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Stagione non accessibile',
        });
      }

      return setContext(userId, input.brandId, input.seasonId, ctx.prisma);
    }),

  /**
   * Gestione accesso brand/season per-utente (admin)
   */
  access: router({
    /**
     * Ottiene il whitelist brand+season per l'utente corrente
     * (null = accesso a tutti)
     */
    getForMe: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      const [brandIds, brandSeasonRows] = await Promise.all([
        getUserAllowedBrandIds(userId, ctx.prisma),
        ctx.prisma.userSeasonAccess.findMany({
          where: { userId },
          select: { brandId: true, seasonId: true },
        }),
      ]);
      return { brandIds, brandSeasonRows };
    }),

    /**
     * Ottiene il whitelist brand+season per un utente specifico (admin)
     */
    getByUser: protectedProcedure
      .use(requirePermission('users:read'))
      .input(userIdSchema)
      .query(async ({ ctx, input }) => {
        const [brandIds, brandSeasonRows] = await Promise.all([
          getUserAllowedBrandIds(input.userId, ctx.prisma),
          ctx.prisma.userSeasonAccess.findMany({
            where: { userId: input.userId },
            select: { brandId: true, seasonId: true },
          }),
        ]);
        return { brandIds, brandSeasonRows };
      }),

    /**
     * Imposta il whitelist brand per un utente (admin).
     * brandIds vuoto → rimuove restrizioni (accesso a tutti i brand).
     */
    setBrandAccess: protectedProcedure
      .use(requirePermission('users:update'))
      .input(
        z.object({
          userId: z.string().uuid(),
          brandIds: z.array(z.string().uuid()),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { userId, brandIds } = input;

        await ctx.prisma.$transaction([
          ctx.prisma.userBrandAccess.deleteMany({ where: { userId } }),
          ...(brandIds.length > 0
            ? [
                ctx.prisma.userBrandAccess.createMany({
                  data: brandIds.map(brandId => ({ userId, brandId })),
                }),
              ]
            : []),
          // Rimuovi accessi stagioni per brand non più consentiti
          ctx.prisma.userSeasonAccess.deleteMany({
            where: {
              userId,
              ...(brandIds.length > 0
                ? { brandId: { notIn: brandIds } }
                : {}),
            },
          }),
        ]);

        return { ok: true };
      }),

    /**
     * Imposta il whitelist stagioni per un utente+brand (admin).
     * seasonIds vuoto → rimuove restrizioni (accesso a tutte le stagioni del brand).
     */
    setSeasonAccess: protectedProcedure
      .use(requirePermission('users:update'))
      .input(
        z.object({
          userId: z.string().uuid(),
          brandId: z.string().uuid(),
          seasonIds: z.array(z.string().uuid()),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { userId, brandId, seasonIds } = input;

        await ctx.prisma.$transaction([
          ctx.prisma.userSeasonAccess.deleteMany({ where: { userId, brandId } }),
          ...(seasonIds.length > 0
            ? [
                ctx.prisma.userSeasonAccess.createMany({
                  data: seasonIds.map(seasonId => ({
                    userId,
                    brandId,
                    seasonId,
                  })),
                }),
              ]
            : []),
        ]);

        return { ok: true };
      }),
  }),
});
