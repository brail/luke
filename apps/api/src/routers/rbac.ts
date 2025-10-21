/**
 * Router tRPC per gestione configurazioni RBAC
 * Gestisce default di accesso alle sezioni per ruolo
 */

import { z } from 'zod';
import { router, adminProcedure } from '../lib/trpc';
import { TRPCError } from '@trpc/server';
import { sectionEnum, sectionDefaultEnum } from '@luke/core';
import {
  getRbacConfig,
  setRbacSectionDefaults,
} from '../services/appConfig.service';
import { wouldLockAllAdminsFromSettings } from '../services/rbac.service';
import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { withIdempotency } from '../lib/idempotencyTrpc';

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
    get: adminProcedure.query(async ({ ctx }) => {
      const rbacConfig = await getRbacConfig(ctx.prisma);
      return rbacConfig.sectionAccessDefaults;
    }),

    save: adminProcedure
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
});
