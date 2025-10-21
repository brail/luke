/**
 * Middleware tRPC per controllo accesso alle sezioni
 * Implementa la precedenza: kill switch > deny > allow > role
 */

import { TRPCError } from '@trpc/server';
import { effectiveSectionAccess, permissions } from '@luke/core';
import { getRbacConfig, getSectionsDisabled } from '@luke/core/server';
import type { Section } from '@luke/core';
import { getOverride } from '../services/sectionAccess.service';
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

    // Recupera override, RBAC config e disabled sections in parallelo
    const [override, rbacConfig, disabledSections] = await Promise.all([
      getOverride(ctx.prisma, user.id, section).catch(() => null),
      getRbacConfig(ctx.prisma),
      getSectionsDisabled(ctx.prisma),
    ]);

    // Valuta accesso considerando kill switch, override, default ruolo e RBAC
    const allowed = effectiveSectionAccess({
      role: user.role,
      roleToPermissions:
        permissions[user.role as keyof typeof permissions] || {},
      sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
      userOverride: override ? { enabled: override.enabled } : undefined,
      section,
      disabledSections,
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
