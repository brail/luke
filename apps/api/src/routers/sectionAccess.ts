/**
 * tRPC router for managing section access overrides
 * Procedures for administrators to manage user access
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  refusedRoleDefaults,
  sectionAccessDefaultsSchema,
  SectionOverrideInputSchema,
  SectionPermissionMissingError,
} from '@luke/core';
import type { Section } from '@luke/core';
import {
  getRbacConfig,
  invalidateRbacCache,
  mergeSectionAccessDefaults,
  setRbacSectionDefaultsTx,
} from '@luke/core/server';

import { logAudit } from '../lib/auditLog';
import { acquireLastAdminLock } from '../lib/lastAdminGuard';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure, selfProcedure } from '../lib/trpc';
import {
  applySectionOverride,
  listOverridesForUser,
  countRecoveryCapableAdmins,
  getSectionDefaults,
  computeEffectiveForUser,
  missingSectionPermissionMessage,
} from '../services/sectionAccess.service';

/** The refusal of a role-defaults map that turns leaves on without their permission (ADR-043). */
function refusedRoleDefaultsError(refused: { role: string; section: Section }[]): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: refused.map(({ role, section }) => missingSectionPermissionMessage(role, section)).join(' '),
  });
}

const setRoleDefaultsInput = z.object({
  sectionAccessDefaults: sectionAccessDefaultsSchema,
});

const setInput = SectionOverrideInputSchema.extend({ userId: z.string().min(1) });

export const sectionAccessRouter = router({
  /**
   * Returns sectionAccessDefaults and disabledSections, read by the administrators' section-override
   * editor. Reading authorization configuration is managing it: `*:*`, like its siblings.
   *
   * @auth {*:*}
   * @input {none}
   * @output {{ sectionAccessDefaults, disabledSections }}
   */
  getDefaults: protectedProcedure
    .use(requirePermission('*:*'))
    .query(async ({ ctx }) => {
      return getSectionDefaults(ctx.prisma);
    }),

  /**
   * Returns section access overrides for a specific user (`*:*`).
   *
   * @auth {*:*}
   * @input {{ userId: string }}
   * @output {{ section: Section, enabled: boolean }[]}
   */
  getByUser: protectedProcedure
    .use(requirePermission('*:*'))
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
  getForMe: selfProcedure.query(async ({ ctx }) => {
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
   * @input {none}
   * @output {Record<Section, boolean>}
   */
  getEffectiveForMe: selfProcedure.query(async ({ ctx }) => {
    return computeEffectiveForUser(ctx.prisma, ctx.session.user.id, ctx.session.user.role);
  }),

  /**
   * Persists per-role section-access defaults to AppConfig (`rbac.sectionAccessDefaults`)
   * and invalidates the RBAC cache. This is the only reachable write path for that key —
   * the generic config.set/update endpoints don't allow the `rbac` key prefix. The map replaces
   * the stored one; a role or section it omits keeps its static default (ADR-027).
   *
   * @auth {*:*}
   * @input {{ sectionAccessDefaults: Partial<Record<Role, Partial<Record<Section, 'enabled'|'disabled'|'auto'>>>> }}
   * @output {{ success: true }}
   */
  setRoleDefaults: protectedProcedure
    .use(requirePermission('*:*'))
    .input(setRoleDefaultsInput)
    .use(withRateLimit('sectionAccessSet'))
    .mutation(async ({ input, ctx }) => {
      // A default may turn a leaf on only for a role holding its permission (ADR-043); `disabled` and
      // `auto` always pass. Checked here first, so a refused map is told so before the recovery guard
      // below speaks, and again by the writer, which owns the rule. Role permissions are static: no lock.
      const refused = refusedRoleDefaults(input.sectionAccessDefaults);
      if (refused.length > 0) throw refusedRoleDefaultsError(refused);

      await ctx.prisma.$transaction(async tx => {
        // Safety check: prevent a config that removes user administration
        // from ALL admins — unlike `set` (which touches one user at a
        // time), here the write is on the role defaults: without a guard, a
        // single admin could lock the entire system out of user
        // administration, the only place reachable to undo the change.
        await acquireLastAdminLock(tx);
        const { disabledSections } = await getRbacConfig(tx, { bypassCache: true });
        // Counted against the map the reader will build from this input, not the input itself:
        // an omitted entry is the static default, never the permission fallback.
        const survivingAdmins = await countRecoveryCapableAdmins(
          tx,
          mergeSectionAccessDefaults(input.sectionAccessDefaults),
          disabledSections
        );

        if (survivingAdmins === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "Questa configurazione toglierebbe a tutti gli amministratori l'accesso alla gestione utenti.",
          });
        }

        try {
          await setRbacSectionDefaultsTx(tx, input.sectionAccessDefaults);
        } catch (err) {
          if (err instanceof SectionPermissionMissingError) throw refusedRoleDefaultsError(err.refused);
          throw err;
        }
        // The map replaces the stored one, so it is the whole new value (#222).
        await logAudit(ctx, {
          action: 'CONFIG_UPSERT',
          targetType: 'Config',
          targetId: 'rbac.sectionAccessDefaults',
          result: 'SUCCESS',
          metadata: { sectionAccessDefaults: input.sectionAccessDefaults },
        }, { tx });
      });

      invalidateRbacCache(); // only after the commit — same as in users.core.router.ts

      return { success: true };
    }),

  /**
   * Sets a section access override for a user, through `applySectionOverride` and its rules: no
   * override on a parent section (ADR-027), `settings.users` never taken from the last administrator
   * able to recover the system, a leaf turned on only with its permission (ADR-043).
   *
   * @auth {*:*}
   * @input {{ userId: string, section: sectionEnum, enabled: boolean | null }}
   * @output {UserSectionAccess | null} — null if override was removed (auto mode).
   */
  set: protectedProcedure
    .use(requirePermission('*:*'))
    .input(setInput)
    .use(withRateLimit('sectionAccessSet'))
    .mutation(({ input, ctx }) =>
      ctx.prisma.$transaction(tx => applySectionOverride(tx, ctx, input.userId, input.section, input.enabled))
    ),
});
