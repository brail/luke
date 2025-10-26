/**
 * Middleware tRPC per controllo accesso alle sezioni
 * Implementa la precedenza: kill switch > deny > allow > role
 * Integrato con nuovo sistema Resource:Action permissions
 */

import { TRPCError } from '@trpc/server';
import {
  effectiveSectionAccess,
  permissions,
  hasPermission,
  type Section,
  type Role,
} from '@luke/core';
import { getRbacConfig, getSectionsDisabled } from '@luke/core/server';
import { getOverride } from '../services/sectionAccess.service';
import type { Context } from './trpc';

/**
 * Mapping sezioni -> permissions per nuovo sistema
 * Mantiene backward compatibility con UserSectionAccess
 */
const SECTION_TO_PERMISSION: Record<Section, string> = {
  dashboard: 'dashboard:read',
  settings: 'settings:read',
  maintenance: 'maintenance:read',
};

/**
 * Factory middleware per controllo accesso sezione
 * Integra nuovo sistema Resource:Action con UserSectionAccess legacy
 *
 * Precedenza: kill switch > user override > permission check > role default
 *
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

    // 1. Kill switch: se la sezione è disabilitata globalmente, nega accesso
    if (disabledSections.includes(section)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Sezione ${section} temporaneamente disabilitata`,
      });
    }

    // 2. User override: se l'utente ha un override specifico, rispettalo
    if (override) {
      if (!override.enabled) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Accesso negato alla sezione ${section} (override utente)`,
        });
      }
      // Se override è enabled, procedi senza ulteriori controlli
      return next();
    }

    // 3. Nuovo sistema permissions: verifica permission specifica
    const permission = SECTION_TO_PERMISSION[section];
    if (
      permission &&
      hasPermission({ role: user.role as Role }, permission as any)
    ) {
      return next();
    }

    // 4. Fallback: sistema legacy effectiveSectionAccess
    const allowed = effectiveSectionAccess({
      role: user.role,
      roleToPermissions:
        permissions[user.role as keyof typeof permissions] || {},
      sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
      userOverride: undefined, // Già controllato sopra
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
