/**
 * Router tRPC per gestione context (Brand/Season)
 * Implementa get/set del context utente con persistenza
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../lib/trpc';
import { resolveContext, setContext } from '../services/context.service';

/**
 * Router per gestione context utente
 */
export const contextRouter = router({
  /**
   * Ottiene il context corrente per l'utente autenticato
   * Risolve automaticamente con algoritmo deterministico:
   * lastUsed → orgDefault → firstActive
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    return resolveContext(ctx.session.user.id, ctx.prisma);
  }),

  /**
   * Imposta il context per l'utente autenticato
   * Valida che brand e season siano attivi prima di salvare
   */
  set: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid('Brand ID deve essere un UUID valido'),
        seasonId: z.string().uuid('Season ID deve essere un UUID valido'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return setContext(
        ctx.session.user.id,
        input.brandId,
        input.seasonId,
        ctx.prisma
      );
    }),
});


