/**
 * tRPC middleware for section-level access control.
 * Delegates evaluation to `effectiveSectionAccess` from @luke/core: the four-tier precedence
 * (kill switch > user override > role default > RBAC permission) for leaf sections, and parent
 * sections derived from their children (ADR-025).
 */

import { TRPCError } from '@trpc/server';

import {
  effectiveSectionAccess,
  type Section,
} from '@luke/core';
import { getRbacConfig } from '@luke/core/server';

import { listOverridesForUser } from '../services/sectionAccess.service';

import { t } from './t';

/**
 * Creates a tRPC middleware that guards a named section, resolved by `effectiveSectionAccess`.
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

    // The whole override map, not the one row for `section`: a parent section is derived from
    // its children (ADR-025). No `.catch(() => null)` on the read: an unreadable override must
    // fail the request, not silently fall through to the role default and widen access.
    const [overrides, rbacConfig] = await Promise.all([
      listOverridesForUser(ctx.prisma, user.id),
      getRbacConfig(ctx.prisma),
    ]);

    // One resolver, the core's: this middleware used to re-implement the kill switch and the
    // override levels inline, a second copy that would now disagree with derived parents.
    const allowed = effectiveSectionAccess({
      role: user.role,
      sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
      userOverrides: new Map(overrides.map(o => [o.section, o.enabled])),
      section,
      disabledSections: rbacConfig.disabledSections,
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
