/**
 * Router tRPC per gestione override di accesso alle sezioni
 * Procedure per amministratori per gestire accessi utente
 */

import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../lib/trpc';
import { TRPCError } from '@trpc/server';
import {
  setOverride,
  listOverridesForUser,
  countAdminsWithSettingsAccess,
} from '../services/sectionAccess.service';
import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import type { Section } from '@luke/core';

const sectionSchema = z.enum(['dashboard', 'settings', 'maintenance']);

const setInput = z.object({
  userId: z.string().min(1),
  section: sectionSchema,
  enabled: z.boolean().nullable(), // null = remove override (auto)
});

export const sectionAccessRouter = router({
  /**
   * Ottiene override per un utente specifico (admin only)
   */
  getByUser: adminProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const rows = await listOverridesForUser(ctx.prisma, input.userId);
      return rows.map(r => ({
        section: r.section as Section,
        enabled: r.enabled,
      }));
    }),

  /**
   * Ottiene override per l'utente corrente
   */
  getForMe: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const rows = await listOverridesForUser(ctx.prisma, userId);
    return rows.map(r => ({
      section: r.section as Section,
      enabled: r.enabled,
    }));
  }),

  /**
   * Imposta override per un utente (admin only)
   */
  set: adminProcedure
    .input(setInput)
    .use(withRateLimit('sectionAccessSet'))
    .mutation(async ({ input, ctx }) => {
      const { userId, section, enabled } = input;

      // Safety check: impedisci di rimuovere accesso settings all'ultimo admin
      if (section === 'settings' && enabled === false) {
        const adminCount = await countAdminsWithSettingsAccess(ctx.prisma);
        if (adminCount <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "Non puoi rimuovere l'accesso ai settings all'ultimo amministratore.",
          });
        }
      }

      const result = await setOverride(ctx.prisma, userId, section, enabled);

      // Log audit
      await logAudit(ctx, {
        action: 'SECTION_ACCESS_UPDATED',
        targetType: 'UserSectionAccess',
        targetId: result?.id,
        metadata: {
          targetUserId: userId,
          section,
          enabled,
        },
      });

      return result;
    }),
});
