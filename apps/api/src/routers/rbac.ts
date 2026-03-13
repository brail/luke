/**
 * Router tRPC per gestione configurazioni RBAC
 * Gestisce default di accesso alle sezioni per ruolo
 */

import { z } from 'zod';
import { router, protectedProcedure, loggedProcedure } from '../lib/trpc';
import { TRPCError } from '@trpc/server';
import { sectionEnum, sectionDefaultEnum } from '@luke/core';
import {
  getRbacConfig,
  setRbacSectionDefaults,
  getSectionsDisabled,
} from '../services/appConfig.service';
import { wouldLockAllAdminsFromSettings } from '../services/rbac.service';
import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { requirePermission } from '../lib/permissions';
import { loadUserGrants, buildPermissionGrid, setResourceAccess } from '../services/permissions.service';

/**
 * Schema per salvare i default di sezione
 */
const saveSectionDefaultsSchema = z.object({
  sectionAccessDefaults: z.record(
    z.string(), // role name
    z.record(sectionEnum, sectionDefaultEnum) // per ogni role, mapping sezione->default
  ),
});

/**
 * Router per gestione default di accesso alle sezioni
 */
export const rbacRouter = router({
  /**
   * Ottiene i default di accesso alle sezioni per ruolo
   */
  sectionDefaults: router({
    get: loggedProcedure.query(async ({ ctx }) => {
      const rbacConfig = await getRbacConfig(ctx.prisma);
      return rbacConfig.sectionAccessDefaults;
    }),

    save: protectedProcedure
      .use(requirePermission('users:update'))
      .use(withRateLimit('configMutations'))
      .use(withIdempotency())
      .input(saveSectionDefaultsSchema)
      .mutation(async ({ input, ctx }) => {
        // Last-admin safety: impedisci di portare tutti gli admin a settings=disabled
        const wouldLockSettings = await wouldLockAllAdminsFromSettings(
          ctx.prisma,
          input.sectionAccessDefaults
        );

        if (wouldLockSettings) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "Non puoi disabilitare l'accesso ai settings a tutti gli amministratori.",
          });
        }

        // Salva i nuovi default
        await setRbacSectionDefaults(ctx.prisma, input.sectionAccessDefaults);

        // Log audit
        await logAudit(ctx, {
          action: 'RBAC_SECTION_DEFAULTS_UPDATED',
          targetType: 'RbacConfig',
          targetId: 'sectionAccessDefaults',
          result: 'SUCCESS',
          metadata: {
            sectionAccessDefaults: input.sectionAccessDefaults,
          },
        });

        return { ok: true };
      }),
  }),

  /**
   * Ottiene le sezioni disabilitate globalmente
   */
  disabledSections: router({
    get: loggedProcedure.query(async ({ ctx }) => {
      return await getSectionsDisabled(ctx.prisma);
    }),
  }),

  /**
   * Gestione permessi per risorsa di un singolo utente (permission grid)
   */
  userPermissions: router({
    /**
     * Restituisce lo stato dei permessi di un utente per ogni risorsa
     */
    get: protectedProcedure
      .use(requirePermission('users:read'))
      .input(z.object({ userId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const user = await ctx.prisma.user.findUnique({
          where: { id: input.userId },
          select: { id: true, role: true },
        });

        if (!user) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
        }

        const grants = await loadUserGrants(ctx.prisma, input.userId);
        const grid = buildPermissionGrid(user.role as any, grants);

        return {
          userId: input.userId,
          role: user.role,
          sections: grid,
        };
      }),

    /**
     * Imposta il livello di accesso per una risorsa di un utente
     */
    set: protectedProcedure
      .use(requirePermission('users:update'))
      .input(
        z.object({
          userId: z.string().uuid(),
          resource: z.enum([
            'brands',
            'users',
            'config',
            'settings',
            'maintenance',
            'dashboard',
          ]),
          level: z.enum(['none', 'read', 'write']),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const actorId = ctx.session!.user.id;

        await setResourceAccess(
          ctx.prisma,
          actorId,
          input.userId,
          input.resource as any,
          input.level
        );

        await logAudit(ctx, {
          action: 'USER_PERMISSIONS_UPDATED',
          targetType: 'User',
          targetId: input.userId,
          result: 'SUCCESS',
          metadata: {
            resource: input.resource,
            level: input.level,
            updatedBy: actorId,
          },
        });

        return { ok: true };
      }),
  }),
});
