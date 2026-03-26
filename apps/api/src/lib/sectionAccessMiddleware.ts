/**
 * Middleware tRPC per controllo accesso alle sezioni
 * Implementa la precedenza: kill switch > deny > allow > role
 * Usa il sistema Resource:Action via effectiveSectionAccess
 */

import { TRPCError } from '@trpc/server';
import {
  effectiveSectionAccess,
  type Section,
} from '@luke/core';
import { getRbacConfig, getSectionsDisabled } from '@luke/core/server';
import { t } from './t';
import { getOverride } from '../services/sectionAccess.service';

/**
 * Factory middleware per controllo accesso sezione
 *
 * Precedenza: kill switch > user override > role default > RBAC permission
 *
 * @param section - Sezione da proteggere
 * @returns Middleware tRPC
 */
export function withSectionAccess(section: Section) {
  return t.middleware(async ({ ctx, next }) => {
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

    // 3. effectiveSectionAccess valuta: role defaults → RBAC permission fallback
    const allowed = effectiveSectionAccess({
      role: user.role,
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
  });
}
