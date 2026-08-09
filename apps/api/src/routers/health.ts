/**
 * Health check router per monitoraggio context layer
 */

import { router, protectedProcedure } from '../lib/trpc';
import { resolveContext } from '../services/context.service';

export const healthRouter = router({
  /**
   * Verifies that the context layer resolves correctly for the current user.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ ok: true, brand: string, season: string }}
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
