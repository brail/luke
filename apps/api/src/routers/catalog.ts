/**
 * Router tRPC per catalog (Brand/Season)
 * Implementa liste master per selezione context, filtrate per whitelist utente.
 */

import { z } from 'zod';

import { makeUrlResolver } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
import {
  getUserAllowedBrandIds,
  getUserAllowedSeasonIds,
} from '../services/context.service';

/**
 * Router per catalog master data
 */
export const catalogRouter = router({
  /**
   * Lista i brand attivi accessibili all'utente corrente.
   * Se l'utente ha un whitelist brand, restituisce solo quelli.
   */
  brands: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const allowedBrandIds = await getUserAllowedBrandIds(userId, ctx.prisma);

    const brands = await ctx.prisma.brand.findMany({
      where: {
        isActive: true,
        ...(allowedBrandIds ? { id: { in: allowedBrandIds } } : {}),
      },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        logoKey: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const resolve = brands.some(b => b.logoKey) ? await makeUrlResolver(ctx.prisma) : null;
    return brands.map(b => ({
      ...b,
      logoUrl: b.logoKey && resolve ? resolve('brand-logos', b.logoKey) : null,
    }));
  }),

  /**
   * Lista le season attive accessibili all'utente corrente.
   * Se brandId è fornito, filtra anche per il whitelist stagioni di quel brand.
   */
  seasons: protectedProcedure
    .input(z.object({ brandId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const allowedSeasonIds = input?.brandId
        ? await getUserAllowedSeasonIds(userId, input.brandId, ctx.prisma)
        : null;

      return ctx.prisma.season.findMany({
        where: {
          isActive: true,
          ...(allowedSeasonIds ? { id: { in: allowedSeasonIds } } : {}),
        },
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
    }),
});
