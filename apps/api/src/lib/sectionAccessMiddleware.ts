/**
 * tRPC middleware for section-level access control.
 * Guards one section without children, resolved by `effectiveSectionAccess` from @luke/core with
 * the four-tier precedence (kill switch, on the section or an ancestor > user override > role
 * default > RBAC permission). A section with children is refused when the guard is built.
 */

import { TRPCError } from '@trpc/server';

import {
  childSectionsOf,
  effectiveSectionAccess,
  type Section,
} from '@luke/core';
import { getRbacConfig } from '@luke/core/server';

import { t } from './t';

/**
 * Creates a tRPC middleware that guards a named section, resolved by `effectiveSectionAccess`.
 *
 * @param section - Section without children to protect (e.g. `'settings.storage'`).
 * @returns tRPC middleware that throws `FORBIDDEN` when access is denied.
 * @throws {Error} When `section` has children: a parent is on as soon as any child is (ADR-025),
 *   so guarding one lets through a user whose own section is off. Thrown when the procedure is
 *   built, at module load, so the API does not start with such a guard.
 */
export function withSectionAccess(section: Section) {
  if (childSectionsOf(section).length > 0) {
    throw new Error(
      `withSectionAccess('${section}'): a section with children cannot guard a procedure — name the section the procedure belongs to`
    );
  }

  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Devi essere autenticato per accedere a questa risorsa',
      });
    }

    const user = ctx.session.user;

    // The one row for `section`: a section without children reads only its own override. No
    // `.catch(() => null)` on the read: an unreadable override must fail the request, not silently
    // fall through to the role default and widen access.
    const [override, rbacConfig] = await Promise.all([
      ctx.prisma.userSectionAccess.findUnique({
        where: { userId_section: { userId: user.id, section } },
      }),
      getRbacConfig(ctx.prisma),
    ]);

    // One resolver, the core's: this middleware used to re-implement the kill switch and the
    // override levels inline, a second copy that would disagree with the core.
    const allowed = effectiveSectionAccess({
      role: user.role,
      sectionAccessDefaults: rbacConfig.sectionAccessDefaults,
      userOverrides: override ? new Map([[section, override.enabled]]) : null,
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
