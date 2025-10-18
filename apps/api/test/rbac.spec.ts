/**
 * Test Suite RBAC per Luke API
 * Verifica copertura uniforme delle guardie su tutte le mutazioni sensibili
 */

import { describe, it, expect } from 'vitest';
import { RBAC_TEST_CONFIG } from './helpers';

describe('RBAC Coverage & Guard Rails', () => {
  describe('RBAC Configuration Validation', () => {
    it('should have all expected admin-only mutations', () => {
      expect(RBAC_TEST_CONFIG.adminOnlyMutations).toHaveLength(11);
      expect(RBAC_TEST_CONFIG.adminOnlyMutations).toContain('users.create');
      expect(RBAC_TEST_CONFIG.adminOnlyMutations).toContain('config.set');
      expect(RBAC_TEST_CONFIG.adminOnlyMutations).toContain(
        'integrations.storage.saveConfig'
      );
    });

    it('should have all expected protected mutations', () => {
      expect(RBAC_TEST_CONFIG.protectedMutations).toHaveLength(3);
      expect(RBAC_TEST_CONFIG.protectedMutations).toContain('me.updateProfile');
      expect(RBAC_TEST_CONFIG.protectedMutations).toContain(
        'me.changePassword'
      );
    });

    it('should have all expected public endpoints', () => {
      expect(RBAC_TEST_CONFIG.publicEndpoints).toHaveLength(2);
      expect(RBAC_TEST_CONFIG.publicEndpoints).toContain('auth.login');
      expect(RBAC_TEST_CONFIG.publicEndpoints).toContain('integrations.test');
    });

    it('should have all expected admin or editor queries', () => {
      expect(RBAC_TEST_CONFIG.adminOrEditorQueries).toHaveLength(1);
      expect(RBAC_TEST_CONFIG.adminOrEditorQueries).toContain('users.list');
    });
  });
});
