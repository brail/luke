/**
 * tRPC router for managing section access overrides
 * Procedures for administrators to manage user access
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { sectionEnum, Roles } from '@luke/core';
import type { Section } from '@luke/core';
import { getRbacConfig, invalidateRbacCache, setRbacSectionDefaultsTx } from '@luke/core/server';

import { logAudit } from '../lib/auditLog';
import { acquireLastAdminLock } from '../lib/lastAdminGuard';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure, adminProcedure } from '../lib/trpc';
import {
  setOverride,
  listOverridesForUser,
  isAdminRecoverySection,
  countRecoveryCapableAdmins,
  countRecoveryCapableAdminsAfterChange,
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
   * @input {none}
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
      await ctx.prisma.$transaction(async tx => {
        // Safety check: prevent a config that removes settings access from
        // ALL admins — unlike `set` (which touches one user at a
        // time), here the write is on the role defaults: without a guard, a
        // single admin could lock the entire system out of Settings,
        // the only place reachable to undo the change.
        await acquireLastAdminLock(tx);
        const { disabledSections } = await getRbacConfig(tx, { bypassCache: true });
        const survivingAdmins = await countRecoveryCapableAdmins(
          tx,
          input.sectionAccessDefaults,
          disabledSections
        );

        if (survivingAdmins === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "Questa configurazione toglierebbe l'accesso ai settings a tutti gli amministratori.",
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
        ctx.logger.error({ err }, 'Audit log fallito dopo commit RBAC riuscito');
      }

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

      const result = await ctx.prisma.$transaction(async tx => {
        // Safety check: prevent removing settings access from the last
        // admin — only if the target is an admin: revoking an override for a
        // viewer/editor doesn't touch the invariant at all. Lock acquired
        // before reading the role, like every other point that evaluates
        // this invariant — correctly serializes against another
        // operation holding the same lock (another `set`, `hardDelete`,
        // demotion, `setRoleDefaults`). Does not cover a concurrent
        // PROMOTION of the same `userId` (viewer/editor → admin): that
        // path doesn't acquire this lock, so a narrow, known window
        // remains, not closed by this reordering.
        // Every recovery section, not just `settings`: removing
        // `settings.users` from the last admin locks them out of
        // user administration exactly as removing `settings` would.
        if (isAdminRecoverySection(section) && enabled !== true) {
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
        ctx.logger.error({ err }, 'Audit log fallito dopo commit sectionAccess.set riuscito');
      }

      return result;
    }),
});
