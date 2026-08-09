/**
 * tRPC router for user preferences management
 * Handles menu collapsible states and other preferences
 */

import { z } from 'zod';

import { protectedProcedure, router } from '../lib/trpc';
import {
  getMenuCollapsibleStates,
  setMenuCollapsibleStates,
} from '../services/context.service';

/**
 * Schema to validate collapsible states
 */
const menuCollapsibleStatesSchema = z.record(z.string(), z.boolean());

/**
 * Router for menu preferences
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
 * Router for user preferences (menu, etc)
 */
export const userPreferencesRouter = router({
  menu: menuRouter,
});
