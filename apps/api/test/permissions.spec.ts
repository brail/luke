/**
 * Unit tests for the Resource:Action permissions system
 * Verifies hasPermission, expandRole and the requirePermission middleware
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect } from 'vitest';

import {
  hasPermission,
  expandRole,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '@luke/core';

import { requirePermission, can } from '../src/lib/permissions';
import { router, publicProcedure } from '../src/lib/trpc';

import { createSilentLogger } from './helpers/logger';

import type { Context } from '../src/lib/trpc';

// Mock context for tests
const createMockContext = (
  userRole: Role,
  userId = 'test-user-id'
): Context => ({
  prisma: {} as any,
  session: {
    // The session carries only the fields needed for authorization: the rest of the
    // profile isn't part of `UserSession` and shouldn't be put back here.
    user: {
      id: userId,
      role: userRole,
      email: 'test@example.com',
      username: 'testuser',
      tokenVersion: 0,
    },
  },
  req: {} as any,
  res: {} as any,
  traceId: 'test-trace-id',
  // Working logger, not `{}`: the deny path calls `ctx.logger?.warn(...)`, and
  // optional chaining protects against a missing logger, not a missing method.
  // With an empty mock, the TypeError masked the FORBIDDEN as INTERNAL_SERVER_ERROR.
  logger: createSilentLogger() as any,
  _permissionsCache: new Map(),
});

/**
 * Permission cache key: `role:userId:permission`.
 * userId is part of the key by design — without it, two users with the same
 * role would share access decisions within the same context.
 */
const cacheKey = (role: Role, permission: Permission, userId = 'test-user-id') =>
  `${role}:${userId}:${permission}`;

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
  /**
   * Exercises the middleware through a real tRPC procedure.
   *
   * `requirePermission` returns a tRPC MiddlewareBuilder, not a callable
   * function: calling it directly ties the test to an internal library
   * detail (and that's what broke them on the tRPC upgrade). Going through
   * `.use()` + `createCaller` tests exactly the production path.
   */
  const callProbe = (
    permission: Parameters<typeof requirePermission>[0],
    ctx: Context
  ) => {
    const probeRouter = router({
      probe: publicProcedure
        .use(requirePermission(permission))
        .query(() => 'success'),
    });

    return probeRouter.createCaller(ctx).probe();
  };

  it('should allow access for admin with any permission', async () => {
    const ctx = createMockContext('admin');

    await expect(callProbe('brands:create', ctx)).resolves.toBe('success');
  });

  it('should allow access for editor with resource permission', async () => {
    const ctx = createMockContext('editor');

    await expect(callProbe('brands:create', ctx)).resolves.toBe('success');
  });

  it('should deny access for viewer without permission', async () => {
    const ctx = createMockContext('viewer');

    await expect(callProbe('brands:create', ctx)).rejects.toThrow(TRPCError);
    const error = await callProbe('brands:create', ctx).catch(e => e);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('should deny access for unauthenticated user', async () => {
    const ctx = createMockContext('admin');
    ctx.session = null;

    await expect(callProbe('brands:create', ctx)).rejects.toThrow(TRPCError);
    const error = await callProbe('brands:create', ctx).catch(e => e);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('should allow access with multiple permissions (OR logic)', async () => {
    const ctx = createMockContext('editor');

    await expect(
      callProbe(['brands:create', 'users:delete'], ctx)
    ).resolves.toBe('success');
  });

  it('should deny access when user has none of the required permissions', async () => {
    const ctx = createMockContext('viewer');

    await expect(
      callProbe(['brands:create', 'users:delete'], ctx)
    ).rejects.toThrow(TRPCError);
    const error = await callProbe(
      ['brands:create', 'users:delete'],
      ctx
    ).catch(e => e);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('should cache permission checks', async () => {
    const ctx = createMockContext('editor');

    const key = cacheKey('editor', 'brands:create');

    await callProbe('brands:create', ctx);
    expect(ctx._permissionsCache?.has(key)).toBe(true);
    expect(ctx._permissionsCache?.get(key)).toBe(true);

    // Second call: served from cache, same outcome
    await expect(callProbe('brands:create', ctx)).resolves.toBe('success');
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

    // First call
    expect(can(ctx, 'brands:create')).toBe(true);
    expect(ctx._permissionsCache?.has(cacheKey('editor', 'brands:create'))).toBe(
      true
    );

    // Second call should use the cache
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
    // Nessun accesso a config: gli endpoint che gatea (SMTP, LDAP, strategia di auth,
    // credenziali storage, policy password) non controllano l'accesso di sezione, quindi il
    // permesso arrivava molto oltre le pagine che l'interfaccia nascondeva.
    expect(editorPermissions).not.toContain('config:read');
    expect(editorPermissions).not.toContain('config:update');
    expect(editorPermissions).toContain('audit:read');
    expect(editorPermissions).toContain('dashboard:read');
    // The settings section is admin-only by design: `SECTION_ACCESS_DEFAULTS.editor.settings`
    // is false and no `settings:*` grant is expected for editor. Negative assertion
    // to lock in the constraint instead of just leaving it untested.
    expect(editorPermissions).not.toContain('settings:read');
  });

  it('should have correct permissions for viewer', () => {
    const viewerPermissions = ROLE_PERMISSIONS.viewer;
    expect(viewerPermissions).toContain('brands:read');
    expect(viewerPermissions).toContain('seasons:read');
    expect(viewerPermissions).toContain('users:read');
    expect(viewerPermissions).not.toContain('config:read');
    expect(viewerPermissions).toContain('audit:read');
    expect(viewerPermissions).toContain('dashboard:read');
    expect(viewerPermissions).not.toContain('brands:create');
    expect(viewerPermissions).not.toContain('brands:update');
    expect(viewerPermissions).not.toContain('brands:delete');
  });
});
