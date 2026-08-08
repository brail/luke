/**
 * Router tRPC per gestione override di accesso alle sezioni
 * Procedure per amministratori per gestire accessi utente
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
        // Safety check: impedisci una config che tolga l'accesso ai settings
        // a TUTTI gli admin — a differenza di `set` (che tocca un utente alla
        // volta), qui la scrittura è sui default di ruolo: senza guard, un
        // singolo admin può auto-bloccare l'intero sistema fuori da Settings,
        // l'unico posto raggiungibile per annullare la modifica.
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

      invalidateRbacCache(); // solo dopo il commit — come in users.core.router.ts

      // La mutation RBAC è già committata: un fallimento dell'audit log
      // (azione CRITICAL_AUDIT_ACTIONS, che normalmente rilancia) non deve
      // travestirsi da fallimento della mutation stessa.
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
        // Safety check: impedisci di rimuovere accesso settings all'ultimo
        // admin — solo se il target è admin: revocare un override di un
        // viewer/editor non tocca minimamente l'invariante. Lock acquisito
        // prima della lettura del ruolo, come ogni altro punto che valuta
        // questo invariante — serializza correttamente contro un'altra
        // operazione che tiene lo stesso lock (altra `set`, `hardDelete`,
        // demozione, `setRoleDefaults`). Non copre una PROMOZIONE
        // concorrente dello stesso `userId` (viewer/editor → admin): quel
        // percorso non acquisisce questo lock, quindi resta una finestra
        // stretta e nota, non chiusa da questo riordino.
        // Ogni sezione di recupero, non solo `settings`: togliere
        // `settings.users` all'ultimo admin lo chiude fuori
        // dall'amministrazione utenti esattamente come togliergli `settings`.
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

      // La mutation è già committata: un fallimento dell'audit log non deve
      // travestirsi da fallimento della mutation stessa.
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
