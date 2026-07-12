/**
 * Router tRPC per gestione override di accesso alle sezioni
 * Procedure per amministratori per gestire accessi utente
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { sectionEnum, Roles } from '@luke/core';
import type { Section } from '@luke/core';
import { setRbacSectionDefaults } from '@luke/core/server';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure, adminProcedure } from '../lib/trpc';
import {
  setOverride,
  listOverridesForUser,
  countAdminsWithSettingsAccess,
  getSectionDefaults,
  computeEffectiveForUser,
} from '../services/sectionAccess.service';

const sectionSchema = sectionEnum;

const setRoleDefaultsInput = z.object({
  sectionAccessDefaults: z.record(
    z.enum(Roles),
    z.record(sectionEnum, z.enum(['enabled', 'disabled', 'auto']))
  ),
});

const setInput = z.object({
  userId: z.string().min(1),
  section: sectionSchema,
  enabled: z.boolean().nullable(), // null = remove override (auto)
});

export const sectionAccessRouter = router({
  /**
   * Returns sectionAccessDefaults and disabledSections config used for client-side access evaluation.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ sectionAccessDefaults, disabledSections }}
   */
  getDefaults: protectedProcedure.query(async ({ ctx }) => {
    return getSectionDefaults(ctx.prisma);
  }),

  /**
   * Returns section access overrides for a specific user (admin only).
   *
   * @auth {admin}
   * @input {{ userId: string }}
   * @output {{ section: Section, enabled: boolean }[]}
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
   * Returns section access overrides for the currently authenticated user.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ section: Section, enabled: boolean }[]}
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
   * Returns the fully-computed effective section access map for the current user.
   * Applies all 4 layers: kill switch → user override → role AppConfig → static RBAC.
   * Single source of truth for client-side section visibility.
   *
   * @auth {authenticated}
   * @output {Record<Section, boolean>}
   */
  getEffectiveForMe: protectedProcedure.query(async ({ ctx }) => {
    return computeEffectiveForUser(ctx.prisma, ctx.session.user.id, ctx.session.user.role);
  }),

  /**
   * Persists per-role section-access defaults to AppConfig (`rbac.sectionAccessDefaults`)
   * and invalidates the RBAC cache. This is the only reachable write path for that key —
   * the generic config.set/update endpoints don't allow the `rbac` key prefix.
   *
   * @auth {admin}
   * @input {{ sectionAccessDefaults: Record<Role, Partial<Record<Section, 'enabled'|'disabled'|'auto'>>> }}
   * @output {{ success: true }}
   */
  setRoleDefaults: adminProcedure
    .input(setRoleDefaultsInput)
    .use(withRateLimit('sectionAccessSet'))
    .mutation(async ({ input, ctx }) => {
      await setRbacSectionDefaults(ctx.prisma, input.sectionAccessDefaults);

      await logAudit(ctx, {
        action: 'CONFIG_UPSERT',
        targetType: 'Config',
        targetId: 'rbac.sectionAccessDefaults',
        result: 'SUCCESS',
        metadata: { sectionAccessDefaults: input.sectionAccessDefaults },
      });

      return { success: true };
    }),

  /**
   * Sets a section access override for a user; blocks removal of settings access from the last admin.
   *
   * @auth {admin}
   * @input {{ userId: string, section: sectionEnum, enabled: boolean | null }}
   * @output {UserSectionAccess | null} — null if override was removed (auto mode).
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

      const result = await setOverride(ctx.prisma, userId, section, enabled, ctx.logger);

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
