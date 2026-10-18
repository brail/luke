# ADR-006: Resource/Action Permissions System

**Status**: Superseded by [016 — Static Resource:Action Permissions and Server-Side Enforcement](016-static-resource-action-permissions.md)\
**Date**: 2025-01-27  
**Authors**: Luke Team

## Context

The Luke system had an initial RBAC implementation with access control based on roles (`adminOrEditorProcedure`) and sections (`withSectionAccess`), but the model did not scale as we added new resources and actions.

### Problems identified:

1. **Limited granularity**: Control by role only, not by specific action
2. **Scalability**: Every new resource required hardcoded changes to the middleware
3. **Inconsistency**: Different logic between API and frontend
4. **Maintainability**: Checks scattered across routers with no unified pattern

### Examples of limitations:

```typescript
// Before: role check only
adminOrEditorProcedure; // Allows everything or nothing

// Before: generic section check
withSectionAccess('settings'); // Does not distinguish read/write
```

## Decision

Implement a **Resource/Action Permissions** system with a `Resource:Action` model (e.g. `brands:create`, `users:read`).

### Chosen architecture:

1. **Granular model**: `Permission = Resource:Action`
2. **Wildcard support**: `*:*`, `resource:*`, `resource:action`
3. **Per-request cache**: Optimized performance
4. **Backward compatibility**: Keeps `adminOrEditorProcedure` as an alias
5. **Gradual integration**: Coexistence with `UserSectionAccess`

### Implementation:

```typescript
// New system
requirePermission('brands:create') // Granular
requirePermission(['brands:create', 'brands:update']) // OR logic

// Frontend
const { can } = useAccess();
can('brands:create') && <CreateButton />

// Components
<AccessGate permission="brands:create">
  <CreateButton />
</AccessGate>
```

## Implementation Details

### 1. Core Types (`packages/core`)

```typescript
type Resource = 'brands' | 'seasons' | 'users' | 'config' | 'audit' | 'settings' | 'maintenance' | 'dashboard';
type Action = 'create' | 'read' | 'update' | 'delete' | 'upload' | '*';
type Permission = `${Resource}:${Action}`;

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['*:*'],
  editor: ['brands:*', 'seasons:*', 'users:read', 'users:update', ...],
  viewer: ['brands:read', 'seasons:read', 'users:read', ...],
};
```

### 2. API Middleware (`apps/api`)

```typescript
// Middleware factory
export function requirePermission(permission: Permission | Permission[])

// Helper for conditional logic
export function can(ctx: Context, permission: Permission): boolean

// Per-request cache
ctx._permissionsCache: Map<string, boolean>
```

### 3. Frontend Integration (`apps/web`)

```typescript
// Unified hook
export function useAccess() {
  const { can, canAll, canAny, isAdmin, isAdminOrEditor } = useAccess();
}

// Conditional rendering components
<AccessGate permission="brands:create">
  <CreateButton />
</AccessGate>
```

### 4. Backward Compatibility

```typescript
// Keeps existing behavior working
export const adminOrEditorProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(adminOrEditorMiddleware); // DEPRECATED but working

// Integration with UserSectionAccess
withSectionAccess('settings'); // Internally uses 'settings:read'
```

## Consequences

### Positive:

- ✅ **Granularity**: Fine-grained control for every action
- ✅ **Scalability**: New resources added without hardcoded changes
- ✅ **Consistency**: Same model for API/FE
- ✅ **Performance**: Per-request cache, zero overhead
- ✅ **DX**: Reusable hooks and components
- ✅ **Backward compatibility**: Zero breaking changes

### Negative:

- ❌ **Initial complexity**: Learning curve for developers
- ❌ **Migration effort**: Gradual refactor of existing routers
- ❌ **Configuration overhead**: More permissions to manage

### Mitigations:

- **Documentation**: Clear examples and pattern guides
- **Migration path**: Incremental refactor, temporary coexistence
- **Tooling**: Helpers and shortcuts for common cases

## Migration Strategy

### Phase 1: Foundation (✅ Completed)

- [x] Core types and helpers
- [x] API middleware with cache
- [x] Frontend hook and components
- [x] Unit and integration tests

### Phase 2: Router Migration (🔄 In Progress)

- [x] Brand router migrated
- [ ] Users router
- [ ] Config router
- [ ] Audit router

### Phase 3: Cleanup (📋 Planned)

- [ ] Deprecation warnings for `adminOrEditorProcedure`
- [ ] Legacy code removal
- [ ] Complete documentation

## Examples

### Before vs After:

```typescript
// BEFORE: Generic check
adminOrEditorProcedure; // All or nothing

// AFTER: Granular check
requirePermission('brands:create'); // Brand creation only
requirePermission('brands:update'); // Brand update only
requirePermission('brands:delete'); // Brand deletion only
```

### Frontend Usage:

```tsx
// BEFORE: Manual check
{
  user.role === 'admin' || user.role === 'editor' ? <CreateButton /> : null;
}

// AFTER: Declarative check
<AccessGate permission="brands:create">
  <CreateButton />
</AccessGate>;
```

### Multiple Permissions:

```typescript
// OR logic: at least one permission
requirePermission(['brands:create', 'brands:update'])

// Frontend: all permissions
<AccessAll permissions={['brands:read', 'brands:update']}>
  <AdvancedEditor />
</AccessAll>
```

## Monitoring & Observability

### Logging:

- Structured logs for FORBIDDEN: `{traceId, userId, permission, resource, action}`
- NO PII in logs (IDs only)
- Audit trail for violations

### Metrics (Future):

- Counter: `permission_checks_total{permission, result}`
- Histogram: `permission_check_duration_ms`

## Future Enhancements

### Phase 2: ABAC (Attribute-Based Access Control)

```typescript
// Context-aware permissions
hasPermission(user, 'brands:update', { brandId: 'brand-123' });
// Verifies ownership or team membership
```

### Phase 3: Dynamic Permissions

```typescript
// Runtime configuration via UI
// Permissions per team/project
// Time-based access
```

## References

- [RBAC vs ABAC Comparison](https://example.com/rbac-abac)
- [Permission System Best Practices](https://example.com/permissions)
- [tRPC Middleware Patterns](https://example.com/trpc-middleware)

---

**Decision Record Template**: [ADR Template](https://github.com/joelparkerhenderson/architecture-decision-record)
