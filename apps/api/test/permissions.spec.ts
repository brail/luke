/**
 * Test unit per sistema permissions Resource:Action
 * Verifica hasPermission, expandRole e middleware requirePermission
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

import {
  hasPermission,
  expandRole,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '@luke/core';

import { requirePermission, can } from '../src/lib/permissions';
import type { Context } from '../src/lib/trpc';

// Mock context per test
const createMockContext = (
  userRole: Role,
  userId = 'test-user-id'
): Context => ({
  prisma: {} as any,
  session: {
    user: {
      id: userId,
      role: userRole,
      email: 'test@example.com',
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      isActive: true,
      locale: 'it-IT',
      timezone: 'Europe/Rome',
      tokenVersion: 0,
      emailVerifiedAt: null,
      lastLoginAt: null,
      loginCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    accessToken: 'mock-token',
  },
  req: {} as any,
  res: {} as any,
  traceId: 'test-trace-id',
  logger: {} as any,
  _permissionsCache: new Map(),
});

describe('hasPermission', () => {
  it('should return true for admin with wildcard permission', () => {
    expect(hasPermission({ role: 'admin' }, 'brands:create')).toBe(true);
    expect(hasPermission({ role: 'admin' }, 'users:delete')).toBe(true);
    expect(hasPermission({ role: 'admin' }, 'settings:read')).toBe(true);
  });

  it('should return true for editor with resource wildcard', () => {
    expect(hasPermission({ role: 'editor' }, 'brands:create')).toBe(true);
    expect(hasPermission({ role: 'editor' }, 'brands:update')).toBe(true);
    expect(hasPermission({ role: 'editor' }, 'brands:delete')).toBe(true);
  });

  it('should return true for editor with specific permission', () => {
    expect(hasPermission({ role: 'editor' }, 'users:read')).toBe(true);
    expect(hasPermission({ role: 'editor' }, 'users:update')).toBe(true);
  });

  it('should return false for editor without permission', () => {
    expect(hasPermission({ role: 'editor' }, 'users:delete')).toBe(false);
    expect(hasPermission({ role: 'editor' }, 'maintenance:read')).toBe(false);
  });

  it('should return true for viewer with read permission', () => {
    expect(hasPermission({ role: 'viewer' }, 'brands:read')).toBe(true);
    expect(hasPermission({ role: 'viewer' }, 'users:read')).toBe(true);
  });

  it('should return false for viewer without permission', () => {
    expect(hasPermission({ role: 'viewer' }, 'brands:create')).toBe(false);
    expect(hasPermission({ role: 'viewer' }, 'brands:update')).toBe(false);
    expect(hasPermission({ role: 'viewer' }, 'brands:delete')).toBe(false);
    expect(hasPermission({ role: 'viewer' }, 'settings:read')).toBe(false);
  });

  it('should return false for invalid role', () => {
    expect(hasPermission({ role: 'invalid' as Role }, 'brands:read')).toBe(
      false
    );
  });
});

describe('expandRole', () => {
  it('should expand admin role to all permissions', () => {
    const permissions = expandRole('admin');
    expect(permissions).toContain('brands:create');
    expect(permissions).toContain('brands:read');
    expect(permissions).toContain('brands:update');
    expect(permissions).toContain('brands:delete');
    expect(permissions).toContain('users:create');
    expect(permissions).toContain('users:read');
    expect(permissions).toContain('users:update');
    expect(permissions).toContain('users:delete');
    expect(permissions).toContain('settings:read');
    expect(permissions).toContain('maintenance:read');
  });

  it('should expand editor role to specific permissions', () => {
    const permissions = expandRole('editor');
    expect(permissions).toContain('brands:create');
    expect(permissions).toContain('brands:read');
    expect(permissions).toContain('brands:update');
    expect(permissions).toContain('brands:delete');
    expect(permissions).toContain('users:read');
    expect(permissions).toContain('users:update');
    expect(permissions).not.toContain('users:delete');
    expect(permissions).not.toContain('maintenance:read');
  });

  it('should expand viewer role to read-only permissions', () => {
    const permissions = expandRole('viewer');
    expect(permissions).toContain('brands:read');
    expect(permissions).toContain('users:read');
    expect(permissions).toContain('config:read');
    expect(permissions).not.toContain('brands:create');
    expect(permissions).not.toContain('brands:update');
    expect(permissions).not.toContain('brands:delete');
    expect(permissions).not.toContain('users:create');
    expect(permissions).not.toContain('users:update');
    expect(permissions).not.toContain('users:delete');
  });

  it('should return empty array for invalid role', () => {
    const permissions = expandRole('invalid' as Role);
    expect(permissions).toEqual([]);
  });
});

describe('requirePermission middleware', () => {
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockNext = vi.fn().mockResolvedValue('success');
  });

  it('should allow access for admin with any permission', async () => {
    const ctx = createMockContext('admin');
    const middleware = requirePermission('brands:create');

    await expect(middleware({ ctx, next: mockNext })).resolves.toBe('success');
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('should allow access for editor with resource permission', async () => {
    const ctx = createMockContext('editor');
    const middleware = requirePermission('brands:create');

    await expect(middleware({ ctx, next: mockNext })).resolves.toBe('success');
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('should deny access for viewer without permission', async () => {
    const ctx = createMockContext('viewer');
    const middleware = requirePermission('brands:create');

    await expect(middleware({ ctx, next: mockNext })).rejects.toThrow(
      TRPCError
    );
    const error = await middleware({ ctx, next: mockNext }).catch(e => e);
    expect(error.code).toBe('FORBIDDEN');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should deny access for unauthenticated user', async () => {
    const ctx = createMockContext('admin');
    ctx.session = null;
    const middleware = requirePermission('brands:create');

    await expect(middleware({ ctx, next: mockNext })).rejects.toThrow(
      TRPCError
    );
    const error = await middleware({ ctx, next: mockNext }).catch(e => e);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should allow access with multiple permissions (OR logic)', async () => {
    const ctx = createMockContext('editor');
    const middleware = requirePermission(['brands:create', 'users:delete']);

    await expect(middleware({ ctx, next: mockNext })).resolves.toBe('success');
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('should deny access when user has none of the required permissions', async () => {
    const ctx = createMockContext('viewer');
    const middleware = requirePermission(['brands:create', 'users:delete']);

    await expect(middleware({ ctx, next: mockNext })).rejects.toThrow(
      TRPCError
    );
    const error = await middleware({ ctx, next: mockNext }).catch(e => e);
    expect(error.code).toBe('FORBIDDEN');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should cache permission checks', async () => {
    const ctx = createMockContext('editor');
    const middleware = requirePermission('brands:create');

    // Prima chiamata
    await middleware({ ctx, next: mockNext });
    expect(ctx._permissionsCache?.has('editor:brands:create')).toBe(true);
    expect(ctx._permissionsCache?.get('editor:brands:create')).toBe(true);

    // Seconda chiamata dovrebbe usare cache
    const mockNext2 = vi.fn().mockResolvedValue('success2');
    await middleware({ ctx, next: mockNext2 });
    expect(mockNext2).toHaveBeenCalledOnce();
  });
});

describe('can helper', () => {
  it('should return true for admin with any permission', () => {
    const ctx = createMockContext('admin');
    expect(can(ctx, 'brands:create')).toBe(true);
    expect(can(ctx, 'users:delete')).toBe(true);
  });

  it('should return true for editor with resource permission', () => {
    const ctx = createMockContext('editor');
    expect(can(ctx, 'brands:create')).toBe(true);
    expect(can(ctx, 'brands:update')).toBe(true);
  });

  it('should return false for viewer without permission', () => {
    const ctx = createMockContext('viewer');
    expect(can(ctx, 'brands:create')).toBe(false);
    expect(can(ctx, 'brands:update')).toBe(false);
  });

  it('should return false for unauthenticated user', () => {
    const ctx = createMockContext('admin');
    ctx.session = null;
    expect(can(ctx, 'brands:create')).toBe(false);
  });

  it('should cache permission checks', () => {
    const ctx = createMockContext('editor');

    // Prima chiamata
    expect(can(ctx, 'brands:create')).toBe(true);
    expect(ctx._permissionsCache?.has('editor:brands:create')).toBe(true);

    // Seconda chiamata dovrebbe usare cache
    expect(can(ctx, 'brands:create')).toBe(true);
  });
});

describe('ROLE_PERMISSIONS configuration', () => {
  it('should have correct permissions for admin', () => {
    expect(ROLE_PERMISSIONS.admin).toEqual(['*:*']);
  });

  it('should have correct permissions for editor', () => {
    const editorPermissions = ROLE_PERMISSIONS.editor;
    expect(editorPermissions).toContain('brands:*');
    expect(editorPermissions).toContain('seasons:*');
    expect(editorPermissions).toContain('users:read');
    expect(editorPermissions).toContain('users:update');
    expect(editorPermissions).toContain('config:read');
    expect(editorPermissions).toContain('config:update');
    expect(editorPermissions).toContain('audit:read');
    expect(editorPermissions).toContain('dashboard:read');
    expect(editorPermissions).toContain('settings:read');
  });

  it('should have correct permissions for viewer', () => {
    const viewerPermissions = ROLE_PERMISSIONS.viewer;
    expect(viewerPermissions).toContain('brands:read');
    expect(viewerPermissions).toContain('seasons:read');
    expect(viewerPermissions).toContain('users:read');
    expect(viewerPermissions).toContain('config:read');
    expect(viewerPermissions).toContain('audit:read');
    expect(viewerPermissions).toContain('dashboard:read');
    expect(viewerPermissions).not.toContain('brands:create');
    expect(viewerPermissions).not.toContain('brands:update');
    expect(viewerPermissions).not.toContain('brands:delete');
  });
});
