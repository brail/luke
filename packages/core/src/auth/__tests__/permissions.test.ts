/**
 * Comprehensive unit tests for the Luke permission system
 *
 * Tests cover:
 * - Type guards (isResource, isAction, isPermission)
 * - Role expansion (expandRole)
 * - Permission checking (hasPermission)
 * - Permission checking with grants (hasPermissionWithGrants)
 * - Matrix functions (getAllPermissions, getPermissionMatrix, validatePermissionMatrix)
 * - CSV export (permissionMatrixToCSV)
 * - Utilities (createPermission)
 */

import { describe, it, expect } from 'vitest';
import type { Role } from '../rbac';
import type { Resource, Action, Permission } from '../permissions';
import {
  isResource,
  isAction,
  isPermission,
  expandRole,
  hasPermission,
  hasPermissionWithGrants,
  getAllPermissions,
  getPermissionMatrix,
  validatePermissionMatrix,
  permissionMatrixToCSV,
  createPermission,
  RESOURCES,
  ACTIONS,
  ROLE_PERMISSIONS,
  VALID_RESOURCE_ACTIONS,
} from '../permissions';

describe('Type Guards', () => {
  describe('isResource', () => {
    it('should return true for valid resources', () => {
      expect(isResource('brands')).toBe(true);
      expect(isResource('seasons')).toBe(true);
      expect(isResource('users')).toBe(true);
      expect(isResource('config')).toBe(true);
      expect(isResource('audit')).toBe(true);
      expect(isResource('settings')).toBe(true);
      expect(isResource('maintenance')).toBe(true);
      expect(isResource('dashboard')).toBe(true);
    });

    it('should return false for invalid resources', () => {
      expect(isResource('unknown')).toBe(false);
      expect(isResource('products')).toBe(false);
      expect(isResource('permissions')).toBe(false);
      expect(isResource('admin')).toBe(false);
    });

    it('should return false for edge cases', () => {
      expect(isResource('')).toBe(false);
      expect(isResource('*')).toBe(false);
      expect(isResource('brands:create')).toBe(false);
    });

    it('should handle all defined resources from RESOURCES constant', () => {
      Object.values(RESOURCES).forEach(resource => {
        expect(isResource(resource)).toBe(true);
      });
    });
  });

  describe('isAction', () => {
    it('should return true for valid actions', () => {
      expect(isAction('create')).toBe(true);
      expect(isAction('read')).toBe(true);
      expect(isAction('update')).toBe(true);
      expect(isAction('delete')).toBe(true);
      expect(isAction('upload')).toBe(true);
    });

    it('should return true for wildcard action', () => {
      expect(isAction('*')).toBe(true);
    });

    it('should return false for invalid actions', () => {
      expect(isAction('write')).toBe(false);
      expect(isAction('execute')).toBe(false);
      expect(isAction('admin')).toBe(false);
      expect(isAction('destroy')).toBe(false);
    });

    it('should return false for edge cases', () => {
      expect(isAction('')).toBe(false);
      expect(isAction('read ')).toBe(false);
      expect(isAction(' read')).toBe(false);
      expect(isAction('READ')).toBe(false);
    });

    it('should handle all defined actions from ACTIONS constant', () => {
      Object.values(ACTIONS).forEach(action => {
        expect(isAction(action)).toBe(true);
      });
    });
  });

  describe('isPermission', () => {
    it('should return true for total wildcard', () => {
      expect(isPermission('*:*')).toBe(true);
    });

    it('should return true for valid specific permissions', () => {
      expect(isPermission('brands:create')).toBe(true);
      expect(isPermission('brands:read')).toBe(true);
      expect(isPermission('brands:update')).toBe(true);
      expect(isPermission('brands:delete')).toBe(true);
      expect(isPermission('users:read')).toBe(true);
      expect(isPermission('users:create')).toBe(true);
      expect(isPermission('audit:read')).toBe(true);
      expect(isPermission('config:read')).toBe(true);
      expect(isPermission('config:update')).toBe(true);
    });

    it('should return true for resource wildcards', () => {
      expect(isPermission('brands:*')).toBe(true);
      expect(isPermission('seasons:*')).toBe(true);
      expect(isPermission('users:*')).toBe(true);
      expect(isPermission('config:*')).toBe(true);
      expect(isPermission('audit:*')).toBe(true);
      expect(isPermission('settings:*')).toBe(true);
      expect(isPermission('maintenance:*')).toBe(true);
      expect(isPermission('dashboard:*')).toBe(true);
    });

    it('should return false for unknown resources', () => {
      expect(isPermission('unknown:create')).toBe(false);
      expect(isPermission('products:read')).toBe(false);
      expect(isPermission('unknown:*')).toBe(false);
    });

    it('should return false for invalid actions on resource', () => {
      // 'upload' is not valid for 'config'
      expect(isPermission('config:upload')).toBe(false);
      // 'delete' is not valid for 'audit'
      expect(isPermission('audit:delete')).toBe(false);
      expect(isPermission('brands:execute')).toBe(false);
    });

    it('should return false for malformed permissions', () => {
      expect(isPermission('brands')).toBe(false);
      expect(isPermission(':create')).toBe(false);
      expect(isPermission('brands:')).toBe(false);
      expect(isPermission('brands:create:extra')).toBe(false);
      expect(isPermission('')).toBe(false);
    });

    it('should validate resource-action combinations against VALID_RESOURCE_ACTIONS', () => {
      // Test that only valid combinations return true
      for (const [resource, actions] of Object.entries(
        VALID_RESOURCE_ACTIONS
      )) {
        for (const action of actions) {
          expect(isPermission(`${resource}:${action}`)).toBe(true);
        }
      }
    });

    it('should reject invalid resource-action combinations', () => {
      // 'upload' is only for specific resources, not all
      if (!VALID_RESOURCE_ACTIONS.audit.includes('upload' as Action)) {
        expect(isPermission('audit:upload')).toBe(false);
      }
      if (!VALID_RESOURCE_ACTIONS.settings.includes('delete' as Action)) {
        expect(isPermission('settings:delete')).toBe(false);
      }
    });

    it('should handle edge cases', () => {
      expect(isPermission('brands:*:extra')).toBe(false);
      expect(isPermission(' brands:create')).toBe(false);
      expect(isPermission('brands:create ')).toBe(false);
      expect(isPermission('BRANDS:READ')).toBe(false);
    });
  });
});

describe('Role Expansion', () => {
  describe('expandRole', () => {
    it('should expand admin role to all permissions', () => {
      const expanded = expandRole('admin');

      // Should contain many permissions
      expect(expanded.length).toBeGreaterThan(20);

      // Should contain specific permissions
      expect(expanded).toContain('brands:create');
      expect(expanded).toContain('brands:read');
      expect(expanded).toContain('users:update');
      expect(expanded).toContain('seasons:delete');
      expect(expanded).toContain('config:update');
      expect(expanded).toContain('audit:read');
      expect(expanded).toContain('settings:update');
      expect(expanded).toContain('maintenance:update');
      expect(expanded).toContain('dashboard:read');

      // Should NOT contain wildcard in expanded form
      expect(expanded).not.toContain('*:*');
    });

    it('should expand editor role to specific permissions', () => {
      const expanded = expandRole('editor');

      // Should contain all brand actions
      expect(expanded).toContain('brands:create');
      expect(expanded).toContain('brands:read');
      expect(expanded).toContain('brands:update');
      expect(expanded).toContain('brands:delete');

      // Should contain all season actions
      expect(expanded).toContain('seasons:create');
      expect(expanded).toContain('seasons:read');
      expect(expanded).toContain('seasons:update');
      expect(expanded).toContain('seasons:delete');

      // Should contain only read and update for users
      expect(expanded).toContain('users:read');
      expect(expanded).toContain('users:update');
      expect(expanded).not.toContain('users:create');
      expect(expanded).not.toContain('users:delete');

      // Should contain config read and update
      expect(expanded).toContain('config:read');
      expect(expanded).toContain('config:update');

      // Should contain audit read only
      expect(expanded).toContain('audit:read');
      expect(expanded).not.toContain('audit:create');
      expect(expanded).not.toContain('audit:update');

      // Should contain dashboard read
      expect(expanded).toContain('dashboard:read');

      // Should NOT contain settings (editor has no settings permissions)
      expect(expanded).not.toContain('settings:read');
      expect(expanded).not.toContain('settings:update');
    });

    it('should expand viewer role to read-only permissions', () => {
      const expanded = expandRole('viewer');

      // Should contain only read permissions
      expect(expanded).toContain('brands:read');
      expect(expanded).not.toContain('brands:create');
      expect(expanded).not.toContain('brands:update');
      expect(expanded).not.toContain('brands:delete');

      expect(expanded).toContain('seasons:read');
      expect(expanded).not.toContain('seasons:create');

      expect(expanded).toContain('users:read');
      expect(expanded).not.toContain('users:create');

      expect(expanded).toContain('config:read');
      expect(expanded).not.toContain('config:update');

      expect(expanded).toContain('audit:read');
      expect(expanded).toContain('dashboard:read');
    });

    it('should return empty array for unknown role', () => {
      const expanded = expandRole('unknown' as Role);
      expect(expanded).toEqual([]);
    });

    it('should not contain wildcards in expanded permissions', () => {
      const expandedAdmin = expandRole('admin');
      const expandedEditor = expandRole('editor');
      const expandedViewer = expandRole('viewer');

      expect(expandedAdmin).not.toContain('*:*');
      expect(expandedAdmin).not.toContain('brands:*');
      expect(expandedEditor).not.toContain('brands:*');
      expect(expandedViewer).not.toContain('users:*');
    });

    it('should only contain valid permissions', () => {
      const expandedAdmin = expandRole('admin');
      const expandedEditor = expandRole('editor');
      const expandedViewer = expandRole('viewer');

      [expandedAdmin, expandedEditor, expandedViewer].forEach(expanded => {
        expanded.forEach(permission => {
          expect(isPermission(permission)).toBe(true);
        });
      });
    });

    it('should have consistent size for same role across calls', () => {
      const expanded1 = expandRole('editor');
      const expanded2 = expandRole('editor');

      expect(expanded1.length).toBe(expanded2.length);
      expect(expanded1.sort()).toEqual(expanded2.sort());
    });
  });
});

describe('Permission Checking', () => {
  describe('hasPermission', () => {
    it('should grant admin all permissions', () => {
      const adminUser = { role: 'admin' as Role };

      expect(hasPermission(adminUser, '*:*')).toBe(true);
      expect(hasPermission(adminUser, 'brands:create')).toBe(true);
      expect(hasPermission(adminUser, 'brands:read')).toBe(true);
      expect(hasPermission(adminUser, 'users:delete')).toBe(true);
      expect(hasPermission(adminUser, 'config:update')).toBe(true);
      expect(hasPermission(adminUser, 'audit:read')).toBe(true);
      expect(hasPermission(adminUser, 'settings:update')).toBe(true);
      expect(hasPermission(adminUser, 'maintenance:update')).toBe(true);
      expect(hasPermission(adminUser, 'dashboard:read')).toBe(true);
    });

    it('should grant editor specific permissions', () => {
      const editorUser = { role: 'editor' as Role };

      // Brands: all actions
      expect(hasPermission(editorUser, 'brands:create')).toBe(true);
      expect(hasPermission(editorUser, 'brands:read')).toBe(true);
      expect(hasPermission(editorUser, 'brands:update')).toBe(true);
      expect(hasPermission(editorUser, 'brands:delete')).toBe(true);

      // Seasons: all actions
      expect(hasPermission(editorUser, 'seasons:create')).toBe(true);
      expect(hasPermission(editorUser, 'seasons:update')).toBe(true);

      // Users: only read and update
      expect(hasPermission(editorUser, 'users:read')).toBe(true);
      expect(hasPermission(editorUser, 'users:update')).toBe(true);
      expect(hasPermission(editorUser, 'users:create')).toBe(false);
      expect(hasPermission(editorUser, 'users:delete')).toBe(false);

      // Config: read and update
      expect(hasPermission(editorUser, 'config:read')).toBe(true);
      expect(hasPermission(editorUser, 'config:update')).toBe(true);

      // Audit: only read
      expect(hasPermission(editorUser, 'audit:read')).toBe(true);

      // Dashboard: read
      expect(hasPermission(editorUser, 'dashboard:read')).toBe(true);

      // No access to maintenance
      expect(hasPermission(editorUser, 'maintenance:read')).toBe(false);
      expect(hasPermission(editorUser, 'maintenance:update')).toBe(false);
    });

    it('should grant viewer only read permissions', () => {
      const viewerUser = { role: 'viewer' as Role };

      // All read permissions
      expect(hasPermission(viewerUser, 'brands:read')).toBe(true);
      expect(hasPermission(viewerUser, 'seasons:read')).toBe(true);
      expect(hasPermission(viewerUser, 'users:read')).toBe(true);
      expect(hasPermission(viewerUser, 'config:read')).toBe(true);
      expect(hasPermission(viewerUser, 'audit:read')).toBe(true);
      expect(hasPermission(viewerUser, 'dashboard:read')).toBe(true);

      // No write/delete permissions
      expect(hasPermission(viewerUser, 'brands:create')).toBe(false);
      expect(hasPermission(viewerUser, 'brands:update')).toBe(false);
      expect(hasPermission(viewerUser, 'brands:delete')).toBe(false);
      expect(hasPermission(viewerUser, 'users:create')).toBe(false);
      expect(hasPermission(viewerUser, 'config:update')).toBe(false);

      // No access to maintenance
      expect(hasPermission(viewerUser, 'maintenance:read')).toBe(false);
    });

    it('should use wildcard resource matching', () => {
      const editorUser = { role: 'editor' as Role };

      // Editor has brands:* so all brand actions should work
      expect(hasPermission(editorUser, 'brands:create')).toBe(true);
      expect(hasPermission(editorUser, 'brands:delete')).toBe(true);
    });

    it('should deny unknown roles', () => {
      const unknownUser = { role: 'unknown' as Role };

      expect(hasPermission(unknownUser, 'brands:read')).toBe(false);
      expect(hasPermission(unknownUser, 'users:read')).toBe(false);
    });

    it('should handle context parameter gracefully (current implementation ignores it)', () => {
      const editorUser = { role: 'editor' as Role };
      const context = { brandId: 'brand123', seasonId: 'season456' };

      // Should still work same way - context not used in current implementation
      expect(hasPermission(editorUser, 'brands:read', context)).toBe(true);
      expect(hasPermission(editorUser, 'users:delete', context)).toBe(false);
    });

    it('should check specific permissions before wildcard', () => {
      const editorUser = { role: 'editor' as Role };

      // These should check the specific permission
      expect(hasPermission(editorUser, 'users:read')).toBe(true);
      expect(hasPermission(editorUser, 'users:create')).toBe(false);
    });
  });
});

describe('Permission Checking with Grants', () => {
  describe('hasPermissionWithGrants', () => {
    it('should grant permission based on role if role has it', () => {
      const editorUser = { role: 'editor' as Role, id: 'user1' };

      // Role-based permission (fast path)
      expect(hasPermissionWithGrants(editorUser, 'brands:create')).toBe(true);
      expect(hasPermissionWithGrants(editorUser, 'brands:create', [])).toBe(
        true
      );
    });

    it('should grant permission from explicit grants', () => {
      const viewerUser = { role: 'viewer' as Role, id: 'user1' };

      // Viewer normally cannot create
      expect(hasPermissionWithGrants(viewerUser, 'brands:create')).toBe(false);

      // But with explicit grant, can create
      expect(
        hasPermissionWithGrants(viewerUser, 'brands:create', ['brands:create'])
      ).toBe(true);
    });

    it('should use grants to override role limitations', () => {
      const viewerUser = { role: 'viewer' as Role, id: 'user1' };

      // Grant specific permissions
      const userGrants = ['brands:create', 'users:update'];

      expect(
        hasPermissionWithGrants(viewerUser, 'brands:create', userGrants)
      ).toBe(true);
      expect(
        hasPermissionWithGrants(viewerUser, 'users:update', userGrants)
      ).toBe(true);

      // But not permissions not in grants
      expect(
        hasPermissionWithGrants(viewerUser, 'seasons:create', userGrants)
      ).toBe(false);
    });

    it('should support wildcard grants', () => {
      const viewerUser = { role: 'viewer' as Role, id: 'user1' };

      // Wildcard grant gives all permissions
      expect(hasPermissionWithGrants(viewerUser, 'users:delete', ['*:*'])).toBe(
        true
      );
      expect(
        hasPermissionWithGrants(viewerUser, 'seasons:create', ['*:*'])
      ).toBe(true);

      // Resource wildcard grant
      expect(
        hasPermissionWithGrants(viewerUser, 'seasons:delete', ['seasons:*'])
      ).toBe(true);
      expect(
        hasPermissionWithGrants(viewerUser, 'seasons:create', ['seasons:*'])
      ).toBe(true);
    });

    it('should prefer role-based permission over grants (fast path)', () => {
      const editorUser = { role: 'editor' as Role, id: 'user1' };

      // Editor has brands:* via role
      expect(hasPermissionWithGrants(editorUser, 'brands:create')).toBe(true);

      // Should still be true even if grants don't include it
      expect(
        hasPermissionWithGrants(editorUser, 'brands:create', ['other:read'])
      ).toBe(true);
    });

    it('should handle empty grants array', () => {
      const viewerUser = { role: 'viewer' as Role, id: 'user1' };

      // Empty grants means only role permissions
      expect(hasPermissionWithGrants(viewerUser, 'brands:read', [])).toBe(true);
      expect(hasPermissionWithGrants(viewerUser, 'brands:create', [])).toBe(
        false
      );
    });

    it('should handle undefined grants', () => {
      const viewerUser = { role: 'viewer' as Role, id: 'user1' };

      // Undefined grants means only role permissions
      expect(
        hasPermissionWithGrants(viewerUser, 'brands:read', undefined)
      ).toBe(true);
      expect(
        hasPermissionWithGrants(viewerUser, 'brands:create', undefined)
      ).toBe(false);
    });

    it('should accept current grants only (not check expiry in function)', () => {
      const viewerUser = { role: 'viewer' as Role, id: 'user1' };

      // Function accepts any grants, expiry checking is done elsewhere
      const grants = ['users:create'];
      expect(hasPermissionWithGrants(viewerUser, 'users:create', grants)).toBe(
        true
      );
    });

    it('should work with admin users and grants', () => {
      const adminUser = { role: 'admin' as Role, id: 'user1' };

      // Admin should have access regardless of grants
      expect(hasPermissionWithGrants(adminUser, 'users:delete')).toBe(true);
      expect(hasPermissionWithGrants(adminUser, 'maintenance:update')).toBe(
        true
      );
      expect(hasPermissionWithGrants(adminUser, 'brands:create', [])).toBe(
        true
      );
    });

    it('should handle context parameter gracefully', () => {
      const editorUser = { role: 'editor' as Role, id: 'user1' };
      const context = { brandId: 'brand123' };

      expect(
        hasPermissionWithGrants(editorUser, 'brands:read', undefined, context)
      ).toBe(true);
    });
  });
});

describe('Matrix Functions', () => {
  describe('getAllPermissions', () => {
    it('should return array including total wildcard', () => {
      const permissions = getAllPermissions();
      expect(permissions).toContain('*:*');
    });

    it('should return resource wildcards', () => {
      const permissions = getAllPermissions();

      expect(permissions).toContain('brands:*');
      expect(permissions).toContain('seasons:*');
      expect(permissions).toContain('users:*');
      expect(permissions).toContain('config:*');
      expect(permissions).toContain('audit:*');
      expect(permissions).toContain('settings:*');
      expect(permissions).toContain('maintenance:*');
      expect(permissions).toContain('dashboard:*');
    });

    it('should return all valid specific permissions', () => {
      const permissions = getAllPermissions();

      expect(permissions).toContain('brands:create');
      expect(permissions).toContain('brands:read');
      expect(permissions).toContain('users:read');
      expect(permissions).toContain('users:update');
      expect(permissions).toContain('audit:read');
      expect(permissions).toContain('config:update');
    });

    it('should not include invalid permissions', () => {
      const permissions = getAllPermissions();

      expect(permissions).not.toContain('unknown:create');
      expect(permissions).not.toContain('audit:create');
      expect(permissions).not.toContain('audit:delete');
      expect(permissions).not.toContain('settings:delete');
    });

    it('should only contain valid permissions', () => {
      const permissions = getAllPermissions();

      permissions.forEach(permission => {
        expect(isPermission(permission)).toBe(true);
      });
    });

    it('should have consistent content across calls', () => {
      const perms1 = getAllPermissions();
      const perms2 = getAllPermissions();

      expect(perms1.length).toBe(perms2.length);
      expect(perms1.sort()).toEqual(perms2.sort());
    });

    it('should have correct count for each resource', () => {
      const permissions = getAllPermissions();

      // Count permissions for brands (4 actions)
      const brandPerms = permissions.filter(p => p.startsWith('brands:'));
      expect(brandPerms.length).toBe(5); // create, read, update, delete + wildcard

      // Count permissions for audit (1 action: read only)
      const auditPerms = permissions.filter(p => p.startsWith('audit:'));
      expect(auditPerms.length).toBe(2); // read + wildcard
    });
  });

  describe('getPermissionMatrix', () => {
    it('should return matrix with required fields', () => {
      const matrix = getPermissionMatrix();

      expect(matrix).toHaveProperty('resources');
      expect(matrix).toHaveProperty('actions');
      expect(matrix).toHaveProperty('validResourceActions');
      expect(matrix).toHaveProperty('rolePermissions');
      expect(matrix).toHaveProperty('expandedRolePermissions');
      expect(matrix).toHaveProperty('allPermissions');
    });

    it('should include all resources', () => {
      const matrix = getPermissionMatrix();

      expect(matrix.resources).toContain('brands');
      expect(matrix.resources).toContain('seasons');
      expect(matrix.resources).toContain('users');
      expect(matrix.resources).toContain('config');
      expect(matrix.resources).toContain('audit');
      expect(matrix.resources).toContain('settings');
      expect(matrix.resources).toContain('maintenance');
      expect(matrix.resources).toContain('dashboard');
      expect(matrix.resources.length).toBe(Object.keys(RESOURCES).length);
    });

    it('should include all basic actions', () => {
      const matrix = getPermissionMatrix();

      expect(matrix.actions).toContain('create');
      expect(matrix.actions).toContain('read');
      expect(matrix.actions).toContain('update');
      expect(matrix.actions).toContain('delete');
      expect(matrix.actions).toContain('upload');
    });

    it('should have validResourceActions matching VALID_RESOURCE_ACTIONS', () => {
      const matrix = getPermissionMatrix();

      for (const [resource, actions] of Object.entries(
        matrix.validResourceActions
      )) {
        expect(actions).toEqual(VALID_RESOURCE_ACTIONS[resource as Resource]);
      }
    });

    it('should have rolePermissions matching ROLE_PERMISSIONS', () => {
      const matrix = getPermissionMatrix();

      expect(matrix.rolePermissions.admin).toEqual(ROLE_PERMISSIONS.admin);
      expect(matrix.rolePermissions.editor).toEqual(ROLE_PERMISSIONS.editor);
      expect(matrix.rolePermissions.viewer).toEqual(ROLE_PERMISSIONS.viewer);
    });

    it('should have expanded role permissions for all roles', () => {
      const matrix = getPermissionMatrix();

      expect(matrix.expandedRolePermissions.admin).toBeDefined();
      expect(matrix.expandedRolePermissions.editor).toBeDefined();
      expect(matrix.expandedRolePermissions.viewer).toBeDefined();

      // Admin expanded should have many permissions
      expect(matrix.expandedRolePermissions.admin.length).toBeGreaterThan(20);

      // All expanded permissions should be valid
      matrix.expandedRolePermissions.admin.forEach(perm => {
        expect(isPermission(perm)).toBe(true);
      });
      matrix.expandedRolePermissions.editor.forEach(perm => {
        expect(isPermission(perm)).toBe(true);
      });
      matrix.expandedRolePermissions.viewer.forEach(perm => {
        expect(isPermission(perm)).toBe(true);
      });
    });

    it('should have allPermissions matching getAllPermissions()', () => {
      const matrix = getPermissionMatrix();
      const allPerms = getAllPermissions();

      expect(matrix.allPermissions.length).toBe(allPerms.length);
      expect(matrix.allPermissions.sort()).toEqual(allPerms.sort());
    });

    it('should have consistent content across calls', () => {
      const matrix1 = getPermissionMatrix();
      const matrix2 = getPermissionMatrix();

      expect(matrix1.resources).toEqual(matrix2.resources);
      expect(matrix1.actions).toEqual(matrix2.actions);
      expect(matrix1.allPermissions.sort()).toEqual(
        matrix2.allPermissions.sort()
      );
    });
  });

  describe('validatePermissionMatrix', () => {
    it('should validate current permission matrix successfully', () => {
      const result = validatePermissionMatrix();

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should return object with valid and errors properties', () => {
      const result = validatePermissionMatrix();

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should validate all role permissions are valid', () => {
      const result = validatePermissionMatrix();

      // Current system should be valid
      expect(result.valid).toBe(true);

      // Check that validation checked ROLE_PERMISSIONS
      for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
        for (const permission of permissions) {
          expect(isPermission(permission)).toBe(true);
        }
      }
    });

    it('should validate all valid resource actions', () => {
      const result = validatePermissionMatrix();

      // Current system should be valid
      expect(result.valid).toBe(true);

      // Check structure is correct
      for (const [resource, actions] of Object.entries(
        VALID_RESOURCE_ACTIONS
      )) {
        expect(isResource(resource)).toBe(true);
        expect(Array.isArray(actions)).toBe(true);

        actions.forEach(action => {
          expect(isAction(action)).toBe(true);
        });
      }
    });

    it('should verify all resources have entries in VALID_RESOURCE_ACTIONS', () => {
      const result = validatePermissionMatrix();

      expect(result.valid).toBe(true);

      // Check each resource
      Object.values(RESOURCES).forEach(resource => {
        expect(resource in VALID_RESOURCE_ACTIONS).toBe(true);
      });
    });
  });
});

describe('CSV Export', () => {
  describe('permissionMatrixToCSV', () => {
    it('should return valid CSV format with header', () => {
      const csv = permissionMatrixToCSV();

      expect(csv).toContain('Resource,Action,Admin,Editor,Viewer');
    });

    it('should have header as first line', () => {
      const csv = permissionMatrixToCSV();
      const lines = csv.split('\n');

      expect(lines[0]).toBe('Resource,Action,Admin,Editor,Viewer');
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should include all resources', () => {
      const csv = permissionMatrixToCSV();

      expect(csv).toContain('"brands"');
      expect(csv).toContain('"seasons"');
      expect(csv).toContain('"users"');
      expect(csv).toContain('"config"');
      expect(csv).toContain('"audit"');
      expect(csv).toContain('"settings"');
      expect(csv).toContain('"maintenance"');
      expect(csv).toContain('"dashboard"');
    });

    it('should include all valid actions for each resource', () => {
      const csv = permissionMatrixToCSV();

      // Brands has 4 actions
      const brandsLines = csv
        .split('\n')
        .filter(line => line.includes('"brands"'));
      expect(brandsLines.length).toBe(4);

      // Audit has 1 action
      const auditLines = csv
        .split('\n')
        .filter(line => line.includes('"audit"'));
      expect(auditLines.length).toBe(1);
    });

    it('should show correct permissions for admin', () => {
      const csv = permissionMatrixToCSV();

      // Admin should have "Yes" for all permissions
      const lines = csv.split('\n').slice(1); // Skip header
      lines.forEach(line => {
        if (line.trim()) {
          const parts = line.split(',');
          expect(parts[2]).toBe('Yes'); // Admin column
        }
      });
    });

    it('should show correct permissions for editor', () => {
      const csv = permissionMatrixToCSV();

      // Check editor column for brands
      const brandsCreateLine = csv
        .split('\n')
        .find(line => line.includes('"brands"') && line.includes('"create"'));
      expect(brandsCreateLine).toContain('Yes'); // Editor should have brands:create

      // Check editor column for audit actions
      const auditCreateLine = csv
        .split('\n')
        .find(line => line.includes('"audit"') && line.includes('"create"'));
      if (auditCreateLine) {
        // If audit:create exists, editor should not have it
        const parts = auditCreateLine.split(',');
        expect(parts[3]).toBe('No'); // Editor column
      }
    });

    it('should show correct permissions for viewer', () => {
      const csv = permissionMatrixToCSV();

      // Check viewer column for read permissions
      const brandsReadLine = csv
        .split('\n')
        .find(line => line.includes('"brands"') && line.includes('"read"'));
      expect(brandsReadLine).toContain('Yes'); // Viewer should have brands:read

      // Check viewer column for create permissions
      const brandsCreateLine = csv
        .split('\n')
        .find(line => line.includes('"brands"') && line.includes('"create"'));
      expect(brandsCreateLine).toContain('No'); // Viewer should not have brands:create
    });

    it('should be properly formatted CSV', () => {
      const csv = permissionMatrixToCSV();
      const lines = csv.split('\n');

      lines.forEach((line, index) => {
        if (index === 0) {
          // Header line
          expect(line).toMatch(/^Resource,Action,Admin,Editor,Viewer$/);
        } else if (line.trim()) {
          // Data lines should have quoted fields and Yes/No values
          expect(line).toMatch(
            /^"[^"]+","[^"]+",(?:Yes|No),(?:Yes|No),(?:Yes|No)$/
          );
        }
      });
    });

    it('should not include wildcard permissions in CSV', () => {
      const csv = permissionMatrixToCSV();

      expect(csv).not.toContain('"*"');
      expect(csv).not.toContain(':*');
    });

    it('should have consistent content across calls', () => {
      const csv1 = permissionMatrixToCSV();
      const csv2 = permissionMatrixToCSV();

      expect(csv1).toBe(csv2);
    });
  });
});

describe('Utilities', () => {
  describe('createPermission', () => {
    it('should create valid permission strings', () => {
      const perm1 = createPermission('brands', 'create');
      expect(perm1).toBe('brands:create');

      const perm2 = createPermission('users', 'read');
      expect(perm2).toBe('users:read');

      const perm3 = createPermission('config', 'update');
      expect(perm3).toBe('config:update');
    });

    it('should create permissions that pass isPermission validation', () => {
      const perm1 = createPermission('brands', 'create');
      expect(isPermission(perm1)).toBe(true);

      const perm2 = createPermission('users', 'read');
      expect(isPermission(perm2)).toBe(true);

      const perm3 = createPermission('audit', 'read');
      expect(isPermission(perm3)).toBe(true);
    });

    it('should work with wildcard action', () => {
      const perm = createPermission('brands', '*' as Action);
      expect(perm).toBe('brands:*');
      expect(isPermission(perm)).toBe(true);
    });

    it('should work with all valid resource-action combinations', () => {
      for (const [resource, actions] of Object.entries(
        VALID_RESOURCE_ACTIONS
      )) {
        for (const action of actions) {
          const perm = createPermission(resource as Resource, action as Action);
          expect(isPermission(perm)).toBe(true);
        }
      }
    });

    it('should create consistent permission strings', () => {
      const perm1 = createPermission('brands', 'create');
      const perm2 = createPermission('brands', 'create');

      expect(perm1).toBe(perm2);
    });

    it('should preserve exact resource and action format', () => {
      const perm = createPermission('brands', 'create');

      const [resource, action] = perm.split(':') as [Resource, Action];
      expect(resource).toBe('brands');
      expect(action).toBe('create');
    });
  });
});

describe('Integration Tests', () => {
  it('should allow editor to manage brands but not delete users', () => {
    const editorUser = { role: 'editor' as Role };

    // Can do brand operations
    expect(hasPermission(editorUser, 'brands:create')).toBe(true);
    expect(hasPermission(editorUser, 'brands:update')).toBe(true);

    // Cannot delete users
    expect(hasPermission(editorUser, 'users:delete')).toBe(false);

    // Can read users
    expect(hasPermission(editorUser, 'users:read')).toBe(true);
  });

  it('should allow viewer to read but not modify', () => {
    const viewerUser = { role: 'viewer' as Role };

    // Can read everything
    expect(hasPermission(viewerUser, 'brands:read')).toBe(true);
    expect(hasPermission(viewerUser, 'users:read')).toBe(true);

    // Cannot modify anything
    expect(hasPermission(viewerUser, 'brands:create')).toBe(false);
    expect(hasPermission(viewerUser, 'users:update')).toBe(false);
    expect(hasPermission(viewerUser, 'config:update')).toBe(false);
  });

  it('should allow viewer with grants to exceed role permissions', () => {
    const viewerUser = { role: 'viewer' as Role, id: 'user1' };
    const grants = ['brands:create', 'users:update'];

    // Via grants, viewer can now create brands
    expect(hasPermissionWithGrants(viewerUser, 'brands:create', grants)).toBe(
      true
    );

    // Via grants, viewer can update users
    expect(hasPermissionWithGrants(viewerUser, 'users:update', grants)).toBe(
      true
    );

    // But still cannot do other things
    expect(hasPermissionWithGrants(viewerUser, 'users:delete', grants)).toBe(
      false
    );
  });

  it('should validate entire permission system is consistent', () => {
    const validation = validatePermissionMatrix();
    expect(validation.valid).toBe(true);

    // All role permissions should be valid
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      perms.forEach(perm => {
        expect(isPermission(perm)).toBe(true);
      });
    }

    // All expanded permissions should be valid
    const expandedAdmin = expandRole('admin');
    const expandedEditor = expandRole('editor');
    const expandedViewer = expandRole('viewer');

    [...expandedAdmin, ...expandedEditor, ...expandedViewer].forEach(perm => {
      expect(isPermission(perm)).toBe(true);
    });

    // CSV should be valid
    const csv = permissionMatrixToCSV();
    expect(csv).toContain('Resource,Action,Admin,Editor,Viewer');
    expect(csv.split('\n').length).toBeGreaterThan(10);
  });

  it('should export and validate permission matrix round-trip', () => {
    const matrix = getPermissionMatrix();

    // Validate the exported matrix
    expect(matrix.resources.length).toBe(Object.keys(RESOURCES).length);
    expect(matrix.actions.length).toBe(5);

    // Expanded permissions should match expandRole
    expect(matrix.expandedRolePermissions.editor).toEqual(expandRole('editor'));

    // All permissions should be valid
    matrix.allPermissions.forEach(perm => {
      expect(isPermission(perm)).toBe(true);
    });
  });
});
