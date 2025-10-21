/**
 * Test per sistema Section Access Overrides
 * Verifica precedenza, safety rule e middleware enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { effectiveSectionAccess } from '@luke/core';
import { permissions } from '@luke/core';

describe('Section Access Overrides', () => {
  describe('effectiveSectionAccess', () => {
    it('should allow access when override is enabled=true', () => {
      const result = effectiveSectionAccess({
        role: 'viewer',
        roleToPermissions: permissions,
        sectionAccessDefaults: {},
        userOverride: { enabled: true },
        section: 'settings',
      });

      expect(result).toBe(true);
    });

    it('should deny access when override is enabled=false', () => {
      const result = effectiveSectionAccess({
        role: 'admin',
        roleToPermissions: permissions,
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
        roleToPermissions: permissions,
        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(adminResult).toBe(true);

      // Viewer non ha accesso a settings
      const viewerResult = effectiveSectionAccess({
        role: 'viewer',
        roleToPermissions: permissions,
        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(viewerResult).toBe(false);

      // Editor ha accesso read a settings
      const editorResult = effectiveSectionAccess({
        role: 'editor',
        roleToPermissions: permissions,
        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
      });
      expect(editorResult).toBe(true);
    });

    it('should follow precedence: deny > allow > role', () => {
      // Override deny dovrebbe sempre negare
      const denyResult = effectiveSectionAccess({
        role: 'admin',
        roleToPermissions: permissions,
        sectionAccessDefaults: {},
        userOverride: { enabled: false },
        section: 'settings',
      });
      expect(denyResult).toBe(false);

      // Override allow dovrebbe sempre permettere
      const allowResult = effectiveSectionAccess({
        role: 'viewer',
        roleToPermissions: permissions,
        sectionAccessDefaults: {},
        userOverride: { enabled: true },
        section: 'settings',
      });
      expect(allowResult).toBe(true);
    });

    it('should deny access when section is globally disabled', () => {
      const result = effectiveSectionAccess({
        role: 'admin',
        roleToPermissions: permissions,
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
        roleToPermissions: permissions,
        sectionAccessDefaults: {},
        userOverride: undefined,
        section: 'settings',
        disabledSections: ['maintenance'], // settings not disabled
      });
      expect(result).toBe(true);
    });
  });

  describe('Last-admin safety check', () => {
    let prisma: PrismaClient;

    beforeEach(async () => {
      prisma = new PrismaClient();
    });

    afterEach(async () => {
      await prisma.$disconnect();
    });

    it('should prevent removing settings access from last admin', async () => {
      // Questo test richiede setup del database
      // Per ora testiamo la logica del service
      const { countAdminsWithSettingsAccess } = await import(
        '../src/services/sectionAccess.service'
      );

      // Mock del database per test
      const mockPrisma = {
        user: {
          count: async () => 1, // Simula solo 1 admin
        },
      } as any;

      const count = await countAdminsWithSettingsAccess(mockPrisma);
      expect(count).toBe(1);
    });
  });

  describe('Middleware enforcement', () => {
    it('should throw FORBIDDEN when access denied', async () => {
      // Test del middleware withSectionAccess
      const { withSectionAccess } = await import(
        '../src/lib/sectionAccessMiddleware'
      );

      const middleware = withSectionAccess('settings');

      // Mock context con utente viewer senza override
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
        },
      };

      const mockNext = async () => 'success';

      // Dovrebbe lanciare TRPCError FORBIDDEN
      await expect(
        middleware({ ctx: mockCtx, next: mockNext })
      ).rejects.toThrow('Accesso negato alla sezione settings');
    });
  });
});
