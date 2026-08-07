/**
 * Test per sistema Section Access Overrides
 * Verifica precedenza, safety rule e middleware enforcement
 */

import { describe, it, expect } from 'vitest';

import { effectiveSectionAccess } from '@luke/core';

import { router, publicProcedure } from '../src/lib/trpc';

import { createSilentLogger } from './helpers/logger';

import type { Context } from '../src/lib/trpc';

describe('Section Access Overrides', () => {
  describe('effectiveSectionAccess', () => {
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

    it('should fallback to role permissions when no override', () => {
      // Admin ha accesso a settings
      const adminResult = effectiveSectionAccess({
        role: 'admin',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(adminResult).toBe(true);

      // Viewer non ha accesso a settings
      const viewerResult = effectiveSectionAccess({
        role: 'viewer',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(viewerResult).toBe(false);

      // Editor non ha accesso a settings: la sezione è admin-only per design
      // (`SECTION_ACCESS_DEFAULTS.editor.settings === false`, nessun grant
      // `settings:*` nel ruolo). Con defaults vuoti il fallback RBAC nega.
      const editorResult = effectiveSectionAccess({
        role: 'editor',

        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(editorResult).toBe(false);
    });

    it('should follow precedence: deny > allow > role', () => {
      // Override deny dovrebbe sempre negare
      const denyResult = effectiveSectionAccess({
        role: 'admin',

        sectionAccessDefaults: {},
        userOverride: { enabled: false },
        section: 'settings',
      });
      expect(denyResult).toBe(false);

      // Override allow dovrebbe sempre permettere
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
    it('should prevent removing settings access from last admin', async () => {
      const { countAdminsWithSettingsAccess } = await import(
        '../src/services/sectionAccess.service'
      );

      // Il test esercita solo la logica del service: admin e override
      // arrivano da un mock, quindi non serve (né si apre) alcuna connessione
      // reale. Nessun override → risolve via fallback RBAC (admin = *:*).
      const mockPrisma = {
        user: {
          findMany: async () => [{ sectionAccess: [] }], // 1 admin, nessun override
        },
      } as any;

      const count = await countAdminsWithSettingsAccess(mockPrisma, {}, []);
      expect(count).toBe(1);
    });
  });

  describe('Middleware enforcement', () => {
    it('should throw FORBIDDEN when access denied', async () => {
      const { withSectionAccess } = await import(
        '../src/lib/sectionAccessMiddleware'
      );

      // `withSectionAccess` ritorna un MiddlewareBuilder tRPC, non un callable:
      // va esercitato attraverso una procedura reale, come in produzione.
      const probeRouter = router({
        probe: publicProcedure
          .use(withSectionAccess('settings'))
          .query(() => 'success'),
      });

      // Context con utente viewer senza override
      const mockCtx = {
        session: {
          user: {
            id: 'test-user',
            role: 'viewer',
          },
        },
        prisma: {
          userSectionAccess: {
            findUnique: async () => null, // Nessun override
          },
          // `getRbacConfig` legge rbac.sectionAccessDefaults e app.sections.disabled:
          // nessuna riga → defaults statici, nessuna sezione disabilitata.
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
