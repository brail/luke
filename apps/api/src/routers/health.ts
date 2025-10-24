/**
 * Health check router per monitoraggio context layer
 */

import { router, protectedProcedure } from '../lib/trpc';
import { resolveContext } from '../services/context.service';

export const healthRouter = router({
  /**
   * Verifica che il context layer risolva correttamente per l'utente corrente
   */
  context: protectedProcedure.query(async ({ ctx }) => {
    const resolved = await resolveContext(ctx.session.user.id, ctx.prisma);

    return {
      ok: true,
      brand: resolved.brand.code,
      season: `${resolved.season.code}${resolved.season.year}`,
    };
  }),
});
