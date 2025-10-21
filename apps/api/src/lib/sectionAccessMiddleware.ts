/**
 * Middleware tRPC per controllo accesso alle sezioni
 * Implementa la precedenza: deny > allow > role
 */

import { TRPCError } from '@trpc/server';
import { effectiveSectionAccess } from '@luke/core';
import { permissions } from '@luke/core';
import type { Section } from '@luke/core';
import { getOverride } from '../services/sectionAccess.service';
import { getRbacConfig } from '../services/appConfig.service';
import type { Context } from './trpc';

/**
 * Factory middleware per controllo accesso sezione
 * @param section - Sezione da proteggere
 * @returns Middleware tRPC
 */
export function withSectionAccess(section: Section) {
  return async ({ ctx, next }: { ctx: Context; next: any }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Devi essere autenticato per accedere a questa risorsa',
      });
    }

    const user = ctx.session.user;

    // Recupera override per l'utente e sezione
    const override = await getOverride(ctx.prisma, user.id, section).catch(
      () => null
    );

    // Recupera configurazione RBAC con cache
    const rbacConfig = await getRbacConfig(ctx.prisma);

    // Valuta accesso considerando override, default ruolo e RBAC
    const allowed = effectiveSectionAccess({
      role: user.role,
      roleToPermissions:
        permissions[user.role as keyof typeof permissions] || {},
      sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
      userOverride: override ? { enabled: override.enabled } : undefined,
      section,
    });

    if (!allowed) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Accesso negato alla sezione ${section}`,
      });
    }

    return next();
  };
}
