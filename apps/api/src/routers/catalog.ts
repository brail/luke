/**
 * Router tRPC per catalog (Brand/Season)
 * Implementa liste master per selezione context
 */

import { router, protectedProcedure } from '../lib/trpc';

/**
 * Router per catalog master data
 */
export const catalogRouter = router({
  /**
   * Lista tutti i brand attivi
   * Ordinati per nome alfabetico
   */
  brands: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }),

  /**
   * Lista tutte le season attive
   * Ordinati per anno decrescente, poi per codice
   */
  seasons: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.season.findMany({
      where: { isActive: true },
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
