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
    //
    // The four levels govern **leaf** sections; a parent is derived from its children (ADR-025,
    // covered in `packages/core/src/rbac/__tests__/sectionHierarchy.test.ts`). The leaf here is
    // `settings.storage`, whose permission fallback (`config:read`) grants the admin and denies
    // the editor and the viewer — the same split `settings` had before parents were derived.
    it('should allow access when override is enabled=true', () => {
      const result = effectiveSectionAccess({
        role: 'viewer',
        sectionAccessDefaults: {},
        userOverrides: new Map([['settings.storage', true]]),
        section: 'settings.storage',
      });

      expect(result).toBe(true);
    });

    it('should deny access when override is enabled=false', () => {
      const result = effectiveSectionAccess({
        role: 'admin',
        sectionAccessDefaults: {},
        userOverrides: new Map([['settings.storage', false]]),
        section: 'settings.storage',
      });

      expect(result).toBe(false);
    });

    it('falls back to role permissions when the defaults map has no entry for the section', () => {
      // The empty map is passed directly; it does not represent "no AppConfig row"
      // (see the note above this describe block).
      const resolve = (role: string) =>
        effectiveSectionAccess({
          role,
          sectionAccessDefaults: {},
          userOverrides: undefined,
          section: 'settings.storage',
        });

      expect(resolve('admin')).toBe(true);
      expect(resolve('viewer')).toBe(false);
      // No `config:read` in the editor role: the fallback denies.
      expect(resolve('editor')).toBe(false);
    });

    it("resolves an explicit 'auto' role default through the RBAC permission fallback", () => {
      // `sales.statistics` is the discriminator: the static table denies it to a viewer while
      // the permission fallback (`sales:read`) grants it, so `true` can only have come from
      // layer 3 — a static answer would be `false`. Asserting the table first means that if
      // the default ever changes, this test reports a dead discriminator instead of passing
      // for the wrong reason.
      expect(SECTION_ACCESS_DEFAULTS.viewer['sales.statistics']).toBe(false);

      const auto = effectiveSectionAccess({
        role: 'viewer',
        sectionAccessDefaults: { viewer: { 'sales.statistics': 'auto' } },
        userOverrides: undefined,
        section: 'sales.statistics',
      });
      expect(auto).toBe(true);

      // Contrast: any value other than 'auto' decides at layer 2 and never reaches the
      // fallback, which is what makes 'auto' the only route to it.
      const disabled = effectiveSectionAccess({
        role: 'viewer',
        sectionAccessDefaults: { viewer: { 'sales.statistics': 'disabled' } },
        userOverrides: undefined,
        section: 'sales.statistics',
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
        sectionAccessDefaults: { viewer: { 'sales.statistics': 'disabled' } },
        userOverrides: undefined,
        section: 'sales.statistics',
      });
      expect(result).toBe(false);
    });

    it('should follow precedence: deny > allow > role', () => {
      // Deny override should always deny
      const denyResult = effectiveSectionAccess({
        role: 'admin',
        sectionAccessDefaults: {},
        userOverrides: new Map([['settings.storage', false]]),
        section: 'settings.storage',
      });
      expect(denyResult).toBe(false);

      // Allow override should always allow
      const allowResult = effectiveSectionAccess({
        role: 'viewer',
        sectionAccessDefaults: {},
        userOverrides: new Map([['settings.storage', true]]),
        section: 'settings.storage',
      });
      expect(allowResult).toBe(true);
    });

    it('should deny access when section is globally disabled', () => {
      const result = effectiveSectionAccess({
        role: 'admin',
        sectionAccessDefaults: {},
        userOverrides: undefined,
        section: 'settings.storage',
        disabledSections: ['settings.storage'],
      });
      expect(result).toBe(false);
    });

    it('should deny access when the parent section is globally disabled', () => {
      const result = effectiveSectionAccess({
        role: 'admin',
        sectionAccessDefaults: {},
        userOverrides: new Map([['settings.storage', true]]),
        section: 'settings.storage',
        disabledSections: ['settings'],
      });
      expect(result).toBe(false);
    });

    it('should allow access when section is not globally disabled', () => {
      const result = effectiveSectionAccess({
        role: 'admin',
        sectionAccessDefaults: {},
        userOverrides: undefined,
        section: 'settings.storage',
        disabledSections: ['maintenance'], // settings.storage not disabled
      });
      expect(result).toBe(true);
    });
  });

  describe('Last-admin safety check', () => {
    it('counts an admin with no override as a recovery path', async () => {
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

    it('does not count an admin who lost settings.users', async () => {
      const { countRecoveryCapableAdmins } = await import('../src/services/sectionAccess.service');

      // The real case that motivated the guard: whoever loses `settings.users` can no longer
      // create or promote anyone, even while other settings pages stay reachable.
      const mockPrisma = {
        user: {
          findMany: async () => [
            { sectionAccess: [{ section: 'settings.users', enabled: false }] },
          ],
        },
      } as any;

      expect(await countRecoveryCapableAdmins(mockPrisma, {}, [])).toBe(0);
    });

    it('ignores an override on the derived settings parent (ADR-025)', async () => {
      const { countRecoveryCapableAdmins } = await import('../src/services/sectionAccess.service');

      // `settings` is derived from its children: an override stored on it no longer switches
      // anything off, so this admin — `settings.users` still on — remains a way out.
      const mockPrisma = {
        user: {
          findMany: async () => [{ sectionAccess: [{ section: 'settings', enabled: false }] }],
        },
      } as any;

      expect(await countRecoveryCapableAdmins(mockPrisma, {}, [])).toBe(1);
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
            findMany: async () => [], // No override
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
