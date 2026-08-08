/**
 * tRPC middleware for section-level access control.
 * Enforces the four-tier precedence: kill switch > user override > role default > RBAC permission.
 * Delegates evaluation to `effectiveSectionAccess` from @luke/core.
 */

import { TRPCError } from '@trpc/server';

import {
  effectiveSectionAccess,
  type Section,
} from '@luke/core';
import { getRbacConfig } from '@luke/core/server';

import { getOverride } from '../services/sectionAccess.service';

import { t } from './t';

/**
 * Creates a tRPC middleware that guards a named section.
 * Precedence: kill switch > user override > role default > RBAC permission fallback.
 *
 * @param section - Section identifier to protect (e.g. `'product.pricing'`).
 * @returns tRPC middleware that throws `FORBIDDEN` when access is denied.
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

    // Fetch override and RBAC config in parallel (disabledSections lives inside rbacConfig)
    const [override, rbacConfig] = await Promise.all([
      getOverride(ctx.prisma, user.id, section).catch(() => null),
      getRbacConfig(ctx.prisma),
    ]);
    const { disabledSections } = rbacConfig;

    // 1. Kill switch: if the section is globally disabled, deny access
    if (disabledSections.includes(section)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Sezione ${section} temporaneamente disabilitata`,
      });
    }

    // 2. User override: if the user has a specific override, honor it
    if (override) {
      if (!override.enabled) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Accesso negato alla sezione ${section} (override utente)`,
        });
      }
      // If the override is enabled, proceed without further checks
      return next();
    }

    // 3. effectiveSectionAccess evaluates: role defaults → RBAC permission fallback
    const allowed = effectiveSectionAccess({
      role: user.role,
      sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
      userOverride: undefined, // Already checked above
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
