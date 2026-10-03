/**
 * tRPC router for managing section access overrides
 * Procedures for administrators to manage user access
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { childSectionsOf, sectionAccessDefaultsSchema, sectionEnum } from '@luke/core';
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
import { router, protectedProcedure, adminProcedure, selfProcedure } from '../lib/trpc';
import {
  setOverride,
  listOverridesForUser,
  ADMIN_RECOVERY_SECTION,
  countRecoveryCapableAdmins,
  countRecoveryCapableAdminsAfterChange,
  getSectionDefaults,
  computeEffectiveForUser,
} from '../services/sectionAccess.service';

const sectionSchema = sectionEnum;

const setRoleDefaultsInput = z.object({
  sectionAccessDefaults: sectionAccessDefaultsSchema,
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
   * @auth {users:read}
   * @input {none}
   * @output {{ sectionAccessDefaults, disabledSections }}
   */
  getDefaults: protectedProcedure
    .use(requirePermission('users:read'))
    .query(async ({ ctx }) => {
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
   * @auth {admin}
   * @input {{ sectionAccessDefaults: Partial<Record<Role, Partial<Record<Section, 'enabled'|'disabled'|'auto'>>>> }}
   * @output {{ success: true }}
   */
  setRoleDefaults: adminProcedure
    .input(setRoleDefaultsInput)
    .use(withRateLimit('sectionAccessSet'))
    .mutation(async ({ input, ctx }) => {
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

        await setRbacSectionDefaultsTx(tx, input.sectionAccessDefaults);
      });

      invalidateRbacCache(); // only after the commit — same as in users.core.router.ts

      // The RBAC mutation is already committed: an audit-log failure
      // (a CRITICAL_AUDIT_ACTIONS action, which normally rethrows) must not
      // masquerade as a failure of the mutation itself.
      try {
        await logAudit(ctx, {
          action: 'CONFIG_UPSERT',
          targetType: 'Config',
          targetId: 'rbac.sectionAccessDefaults',
          result: 'SUCCESS',
          metadata: { sectionAccessDefaults: input.sectionAccessDefaults },
        });
      } catch (err) {
        ctx.logger.error({ err }, 'Audit log failed after a successful RBAC commit');
      }

      return { success: true };
    }),

  /**
   * Sets a section access override for a user; refuses to take `settings.users` (user administration)
   * from the last administrator able to recover the system.
   * A parent section is derived from its children, so it takes no override at all, `null` included:
   * the overrides stored on parents before that rule were removed by migration (ADR-027).
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

      if (childSectionsOf(section).length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `La sezione ${section} dipende dalle sue sottosezioni: abilita o disabilita quelle.`,
        });
      }

      const result = await ctx.prisma.$transaction(async tx => {
        // Safety check: prevent removing user administration from the last
        // admin — only if the target is an admin: revoking an override for a
        // viewer/editor doesn't touch the invariant at all. Lock acquired
        // before reading the role, like every other point that evaluates
        // this invariant — correctly serializes against another
        // operation holding the same lock (another `set`, `hardDelete`,
        // demotion, `setRoleDefaults`). Does not cover a concurrent
        // PROMOTION of the same `userId` (viewer/editor → admin): that
        // path doesn't acquire this lock, so a narrow, known window
        // remains, not closed by this reordering.
        // The recovery section (`ADMIN_RECOVERY_SECTION`, `settings.users`):
        // removing it from the last admin locks them out of user
        // administration. `settings` never reaches here — a parent is
        // refused above.
        if (section === ADMIN_RECOVERY_SECTION && enabled !== true) {
          await acquireLastAdminLock(tx);
          const target = await tx.user.findUnique({
            where: { id: userId },
            select: { role: true },
          });

          if (target?.role === 'admin') {
            const { sectionAccessDefaults, disabledSections } = await getRbacConfig(tx, {
              bypassCache: true,
            });
            const survivingAdmins = await countRecoveryCapableAdminsAfterChange(
              tx,
              userId,
              section,
              enabled,
              sectionAccessDefaults,
              disabledSections
            );
            if (survivingAdmins === 0) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message:
                  "Questa modifica toglierebbe a tutti gli amministratori l'accesso necessario ad amministrare gli utenti.",
              });
            }
          }
        }

        return setOverride(tx, userId, section, enabled, ctx.logger);
      });

      // The mutation is already committed: an audit-log failure must not
      // masquerade as a failure of the mutation itself.
      try {
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
      } catch (err) {
        ctx.logger.error({ err }, 'Audit log failed after a successful sectionAccess.set commit');
      }

      return result;
    }),
});
