/**
 * Router tRPC per gestione preferenze utente
 * Gestisce menu collapsible states e altre preferenze
 */

import { z } from 'zod';

import { protectedProcedure, router } from '../lib/trpc';
import {
  getMenuCollapsibleStates,
  setMenuCollapsibleStates,
} from '../services/context.service';

/**
 * Schema per validare gli stati collapsibili
 */
const menuCollapsibleStatesSchema = z.record(z.string(), z.boolean());

/**
 * Router per preferenze menu
 */
const menuRouter = router({
  /**
   * Returns the collapsible state map for all sidebar menu sections for the current user.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {Record<string, boolean>}
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const states = await getMenuCollapsibleStates(ctx.session.user.id, ctx.prisma);
    return states;
  }),

  /**
   * Persists the collapsible state map for all sidebar menu sections for the current user.
   *
   * @auth {authenticated}
   * @input {Record<string, boolean>} — map of menu section keys to collapsed/expanded state
   * @output {Record<string, boolean>}
   */
  set: protectedProcedure
    .input(menuCollapsibleStatesSchema)
    .mutation(async ({ ctx, input }) => {
      const states = await setMenuCollapsibleStates(
        ctx.session.user.id,
        input,
        ctx.prisma
      );
      return states;
    }),
});

/**
 * Router per preferenze utente (menu, etc)
 */
export const userPreferencesRouter = router({
  menu: menuRouter,
});
