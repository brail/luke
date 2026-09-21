/**
 * Tests for the Section Access Overrides system
 * Verifies precedence, safety rule and middleware enforcement
 */

import { describe, it, expect } from 'vitest';

import { effectiveSectionAccess, SECTION_ACCESS_DEFAULTS } from '@luke/core';

import { router, publicProcedure } from '../src/lib/trpc';

import { createSilentLogger } from './helpers/logger';

import type { Context } from '../src/lib/trpc';

describe('Section Access Overrides', () => {
  describe('effectiveSectionAccess', () => {
    // These call the resolver directly, so `sectionAccessDefaults` is whatever the test
    // passes. An empty map here is a unit-test shape, **not** the production state when
    // AppConfig holds no `rbac.sectionAccessDefaults` row: `getRbacConfig` always merges
    // the complete `SECTION_ACCESS_DEFAULTS` table as the base, so in production layer 2
    // always has an entry for a known role and the permission fallback is reached only
    // through an explicit `'auto'`. The production no-row and malformed-row paths are
    // covered in `sectionAccess.integration.spec.ts`.
    it('should allow access when override is enabled=true', () => {
      const result = effectiveSectionAccess({
        role: 'viewer',

        sectionAccessDefaults: {},
        userOverride: { enabled: true },
        section: 'settings',
      });

      expect(result).toBe(true);
    });

    it('should deny access when override is enabled=false', () => {
      const result = effectiveSectionAccess({
        role: 'admin',

        sectionAccessDefaults: {},
        userOverride: { enabled: false },
        section: 'settings',
      });

      expect(result).toBe(false);
    });

    it('falls back to role permissions when the defaults map has no entry for the section', () => {
      // The empty map is passed directly; it does not represent "no AppConfig row"
      // (see the note above this describe block).
      // Admin has access to settings
      const adminResult = effectiveSectionAccess({
        role: 'admin',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(adminResult).toBe(true);

      // Viewer has no access to settings
      const viewerResult = effectiveSectionAccess({
        role: 'viewer',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(viewerResult).toBe(false);

      // Editor has no access to settings: the section is admin-only by design
      // (`SECTION_ACCESS_DEFAULTS.editor.settings === false`, no `settings:*`
      // grant in the role). With empty defaults the RBAC fallback denies.
      const editorResult = effectiveSectionAccess({
        role: 'editor',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(editorResult).toBe(false);
    });

    it("resolves an explicit 'auto' role default through the RBAC permission fallback", () => {
      // `sales` is the discriminator: the static table denies it to a viewer while the
      // permission fallback grants it, so `true` can only have come from layer 3 — a
      // static answer would be `false`. Asserting the table first means that if the
      // default ever changes, this test reports a dead discriminator instead of passing
      // for the wrong reason. `sales` is one of the sections named in the 32 measured
      // divergences recorded in `packages/core/src/server/rbacConfig.ts`.
      expect(SECTION_ACCESS_DEFAULTS.viewer.sales).toBe(false);

      const auto = effectiveSectionAccess({
        role: 'viewer',
        sectionAccessDefaults: { viewer: { sales: 'auto' } },
        userOverride: undefined,
        section: 'sales',
      });
      expect(auto).toBe(true);

      // Contrast: any value other than 'auto' decides at layer 2 and never reaches the
      // fallback, which is what makes 'auto' the only route to it.
      const disabled = effectiveSectionAccess({
        role: 'viewer',
        sectionAccessDefaults: { viewer: { sales: 'disabled' } },
        userOverride: undefined,
        section: 'sales',
      });
      expect(disabled).toBe(false);
    });

    it('denies an unrecognised role at the permission fallback', () => {
      // A role outside `Roles` has no entry in the merged defaults, so layer 2 coerces to
      // 'auto' and layer 3 decides. `hasPermission` grants an unknown role nothing, so the
      // section is denied: the fallback fails closed rather than throwing or opening up.
      // The map is populated for another role, matching the production shape where the
      // merged base always carries the three known roles.
      const result = effectiveSectionAccess({
        role: 'auditor',
        sectionAccessDefaults: { viewer: { sales: 'disabled' } },
        userOverride: undefined,
        section: 'sales',
      });
      expect(result).toBe(false);
    });

    it('should follow precedence: deny > allow > role', () => {
      // Deny override should always deny
      const denyResult = effectiveSectionAccess({
        role: 'admin',

        sectionAccessDefaults: {},
        userOverride: { enabled: false },
        section: 'settings',
      });
      expect(denyResult).toBe(false);

      // Allow override should always allow
      const allowResult = effectiveSectionAccess({
        role: 'viewer',

        sectionAccessDefaults: {},
        userOverride: { enabled: true },
        section: 'settings',
      });
      expect(allowResult).toBe(true);
    });

    it('should deny access when section is globally disabled', () => {
      const result = effectiveSectionAccess({
        role: 'admin',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
        disabledSections: ['settings'],
      });
      expect(result).toBe(false);
    });

    it('should allow access when section is not globally disabled', () => {
      const result = effectiveSectionAccess({
        role: 'admin',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
        disabledSections: ['maintenance'], // settings not disabled
      });
      expect(result).toBe(true);
    });
  });

  describe('Last-admin safety check', () => {
    it('conta un admin senza override come via di recupero', async () => {
      const { countRecoveryCapableAdmins } = await import(
        '../src/services/sectionAccess.service'
      );

      // The test exercises only the service logic: admin and override
      // come from a mock, so no real connection is needed (or opened).
      // No override → resolves via RBAC fallback (admin = *:*).
      const mockPrisma = {
        user: {
          findMany: async () => [{ sectionAccess: [] }], // 1 admin, no override
        },
      } as any;

      const count = await countRecoveryCapableAdmins(mockPrisma, {}, []);
      expect(count).toBe(1);
    });

    it('non conta un admin a cui manca una sola sezione di recupero', async () => {
      const { countRecoveryCapableAdmins, ADMIN_RECOVERY_SECTIONS } =
        await import('../src/services/sectionAccess.service');

      // The recovery surface is a conjunction: losing just one is enough.
      // The real case that motivated the fix is `settings.users` — whoever loses it
      // can no longer create or promote, even while keeping `settings`.
      for (const missing of ADMIN_RECOVERY_SECTIONS) {
        const mockPrisma = {
          user: {
            findMany: async () => [
              { sectionAccess: [{ section: missing, enabled: false }] },
            ],
          },
        } as any;

        const count = await countRecoveryCapableAdmins(mockPrisma, {}, []);
        expect(count, `senza ${missing}`).toBe(0);
      }
    });
  });

  describe('Middleware enforcement', () => {
    it('should throw FORBIDDEN when access denied', async () => {
      const { withSectionAccess } = await import(
        '../src/lib/sectionAccessMiddleware'
      );

      // `withSectionAccess` returns a tRPC MiddlewareBuilder, not a callable:
      // it must be exercised through a real procedure, as in production.
      const probeRouter = router({
        probe: publicProcedure
          .use(withSectionAccess('settings'))
          .query(() => 'success'),
      });

      // Context with a viewer user, no override
      const mockCtx = {
        session: {
          user: {
            id: 'test-user',
            role: 'viewer',
          },
        },
        prisma: {
          userSectionAccess: {
            findUnique: async () => null, // No override
          },
          // `getRbacConfig` reads rbac.sectionAccessDefaults and app.sections.disabled:
          // no row → static defaults, no section disabled.
          appConfig: {
            findUnique: async () => null,
          },
        },
        logger: createSilentLogger(),
      } as unknown as Context;

      await expect(probeRouter.createCaller(mockCtx).probe()).rejects.toThrow(
        'Accesso negato alla sezione settings'
      );
    });
  });
});
