# ADR-002: RBAC Policy and Enforcement

## Status

Superseded by [006 — Resource/Action Permissions System](006-resource-action-permissions.md)

## Context

The Luke project is a multi-tenant enterprise system that requires:

- **Granular access control**: Different privilege levels for users
- **Security by default**: Principle of least privilege
- **Audit trail**: Complete tracking of privileged access
- **Maintainability**: DRY code with no duplication of RBAC logic
- **Testing**: Verifiable coverage for every access check

The system must handle sensitive operations such as:

- User management (creation, modification, deletion)
- System configuration (LDAP, authentication)
- Viewing sensitive data (audit log, configuration)

## Decision

We implemented a centralized RBAC system with the following characteristics:

### Role Model

```typescript
enum Role {
  admin = 'admin', // All permissions
  editor = 'editor', // Read and modify
  viewer = 'viewer', // Read only
}
```

### Composable Middleware

```typescript
// Middleware for a single role
export function withRole(role: Role): MiddlewareFunction;

// Middleware for multiple roles
export function roleIn(roles: Role[]): MiddlewareFunction;

// Predefined aliases
export const adminOnly: MiddlewareFunction;
export const adminOrEditor: MiddlewareFunction;
export const authenticatedOnly: MiddlewareFunction;
```

### Multi-Level Enforcement

1. **tRPC middleware**: Automatic check on every endpoint
2. **Helper functions**: Conditional checks in code
3. **Type safety**: TypeScript to catch errors at compile time

### Centralized Policy

- **Definitions**: `@luke/core` package
- **Implementation**: `apps/api/src/lib/rbac.ts`
- **Testing**: Coverage documented in `RBAC_COVERAGE.md`

## Consequences

### ✅ Advantages

- **DRY code**: Zero duplication of RBAC logic in the routers
- **Type safety**: Compile-time checks with TypeScript
- **Centralized testing**: Verifiable and documented coverage
- **Automatic audit**: Log of every privileged access
- **Maintainability**: RBAC changes in one place only
- **Composability**: Reusable and combinable middleware

### ⚠️ Trade-off

- **Performance**: A check on every protected call (mitigated with a cache)
- **Complexity**: New developers must learn the middleware pattern
- **Token invalidation**: A role change requires incrementing `tokenVersion`

### 🔧 Operational Implications

- **Onboarding**: Developers must know the middleware pattern
- **Testing**: Testing every RBAC path is mandatory
- **Monitoring**: Log of denied access for security analysis
- **Deploy**: A role change requires invalidating active sessions

## Implementation

### Router Example

```typescript
export const usersRouter = router({
  // Admin only
  create: adminOnly.input(CreateUserSchema).mutation(async ({ ctx, input }) => {
    // User creation logic
  }),

  // Admin or editor
  list: adminOrEditor.input(ListUsersSchema).query(async ({ ctx, input }) => {
    // User list logic
  }),

  // Authenticated user only
  profile: authenticatedOnly.query(async ({ ctx }) => {
    // Personal profile logic
  }),
});
```

### Helper Functions

```typescript
// Conditional checks
if (isAdmin(session)) {
  // Admin-only logic
}

if (canModifyUser(session, targetUserId)) {
  // User modification logic
}

if (canViewUser(session, targetUserId)) {
  // User viewing logic
}
```

### Testing Pattern

```typescript
describe('RBAC Enforcement', () => {
  it('admin can access every endpoint', async () => {
    const adminSession = createSession({ role: 'admin' });
    // Test every endpoint
  });

  it('editor cannot access admin-only endpoints', async () => {
    const editorSession = createSession({ role: 'editor' });
    await expect(adminOnlyEndpoint(editorSession)).rejects.toThrow('FORBIDDEN');
  });
});
```

## Detailed Policies

### Admin (`admin`)

- **Permissions**: All (`*`)
- **Operations**: Full CRUD on users, configuration, audit
- **Restrictions**: Cannot delete itself, cannot remove the last admin

### Editor (`editor`)

- **Permissions**: `read`, `update`
- **Operations**: Viewing and modifying users, configuration
- **Restrictions**: Cannot modify roles, cannot access sensitive configuration

### Viewer (`viewer`)

- **Permissions**: `read`
- **Operations**: Data viewing only
- **Restrictions**: No modification, read-only on the personal profile

## Security Considerations

### Token Version Enforcement

```typescript
// Role change → tokenVersion increment
await prisma.user.update({
  where: { id: userId },
  data: {
    role: newRole,
    tokenVersion: { increment: 1 },
  },
});

// Immediate cache invalidation
invalidateTokenVersionCache(userId);
```

### Audit Logging

```typescript
// Automatic log for privileged operations
await logAudit(ctx, {
  action: 'USER_ROLE_CHANGED',
  resource: 'user',
  resourceId: userId,
  metadata: { oldRole, newRole },
});
```

### Rate Limiting

```typescript
// Rate limit specific to RBAC operations
const rbacRateLimit = withRateLimit({
  max: 10,
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyGenerator: ctx => `rbac:${ctx.session.user.id}`,
});
```

## Alternatives Considered

### ACL (Access Control Lists)

- ❌ Complexity of managing granular permissions
- ❌ Performance overhead for multiple checks
- ❌ Difficult testing and maintenance

### RBAC with Dynamic Permissions

- ❌ Excessive complexity for current use cases
- ❌ Over-engineering for a monorepo system
- ❌ Difficult audit and compliance

### Manual Checks in the Routers

- ❌ Code duplication
- ❌ Inconsistencies between endpoints
- ❌ Difficult testing and maintenance

## References

- [RBAC Standard](https://csrc.nist.gov/Projects/role-based-access-control)
- [OWASP Access Control](https://owasp.org/www-community/Access_Control_Cheat_Sheet)
- Implementation: `apps/api/src/lib/rbac.ts`
- Coverage: `apps/api/RBAC_COVERAGE.md`
- Examples: `apps/api/src/routers/users.ts:145`
- Schema: `packages/core/src/rbac.ts`
