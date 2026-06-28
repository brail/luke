/**
 * Router tRPC per catalog (Brand/Season)
 * Implementa liste master per selezione context, filtrate per whitelist utente.
 */

import type { Role } from '@luke/core';

import { makeUrlResolver } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
import { getUserAllowedBrandIds } from '../services/context.service';

/**
 * Router per catalog master data
 */
export const catalogRouter = router({
  /**
   * Lists active brands accessible to the current user, applying per-user brand whitelist if present.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {Brand[]} — active brands with resolved logoUrl, sorted by name.
   */
  brands: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const allowedBrandIds = await getUserAllowedBrandIds(userId, ctx.prisma, ctx.session.user.role as Role);

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
   * Lists all active seasons, sorted by year descending and code ascending.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {Season[]} — active seasons with id, code, year, name.
   */
  seasons: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.prisma.season.findMany({
        where: {
          isActive: true,
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
