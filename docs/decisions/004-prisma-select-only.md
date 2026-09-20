# ADR-004: Prisma Select-Only Pattern

## Status

**Accepted** - 2024-01-XX

## Context

The Luke project handles sensitive data that must be protected from **data leakage**:

- **Password hash**: `LocalCredential.passwordHash` (irreversible but sensitive)
- **Encrypted secrets**: LDAP configuration with encrypted passwords
- **Sensitive PII**: User metadata, personal information
- **Audit data**: Access log and user changes

The critical problem is that Prisma returns **every field** of a model by default:

```typescript
// ❌ DANGEROUS - Exposes every field
const user = await prisma.user.findUnique({
  where: { id: userId },
});
// Includes: passwordHash, metadata, localCredential, etc.
```

This can cause:

- **Data leakage**: Sensitive fields exposed in API responses
- **Security breach**: Password hashes or secrets in logs/network
- **Compliance issues**: Violation of GDPR/privacy regulations
- **Performance**: Fetching unnecessary data

## Decision

We adopted the **Prisma Select-Only** pattern with the following rules:

### Fundamental Rule

**NEVER** use `findMany()`, `findUnique()`, `findFirst()` without an explicit `select`.

### Whitelist Pattern

```typescript
// ✅ CORRECT - Safe fields only
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    email: true,
    username: true,
    firstName: true,
    lastName: true,
    role: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    // NO passwordHash, NO localCredential, NO metadata
  },
});
```

### Always-Excluded Fields

```typescript
// ❌ NEVER include these fields
const SENSITIVE_FIELDS = [
  'passwordHash', // LocalCredential
  'localCredential', // Entire relation
  'metadata', // Identity metadata
  'value', // AppConfig (may be encrypted)
  'auditLogs', // Sensitive logs
];
```

### Safe Relations

```typescript
// ✅ Correct - Only safe fields from the relations
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    email: true,
    identities: {
      select: {
        id: true,
        provider: true,
        providerId: true,
        // NO localCredential, NO metadata
      },
    },
  },
});
```

## Consequences

### ✅ Advantages

- **Zero Data Leakage**: Only explicitly approved fields are exposed
- **Simplified Audit**: Review the `select` block instead of all the code
- **Performance**: Fetch only necessary fields (less network, less memory)
- **Security by Default**: Impossible to expose sensitive data by mistake
- **Compliance**: Automatic respect for privacy regulations
- **Type Safety**: TypeScript infers correct types from the select

### ⚠️ Trade-off

- **Verbosity**: Repetitive `select` blocks (mitigable with helper functions)
- **Maintenance**: Update every select if the schema changes
- **Learning Curve**: Developers must know the pattern
- **Code Review**: Mandatory review for new Prisma queries

### 🔧 Operational Implications

- **Code Review**: Check `select` in every PR
- **Testing**: Tests that verify the absence of sensitive fields
- **Monitoring**: Log of queries without select for audit
- **Documentation**: Clear examples for developer onboarding

## Implementation

### Correct Example - User Profile

```typescript
// apps/api/src/routers/me.ts:31-51
const user = await ctx.prisma.user.findUnique({
  where: { id: ctx.session.user.id },
  select: {
    id: true,
    email: true,
    username: true,
    firstName: true,
    lastName: true,
    locale: true,
    timezone: true,
    role: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    lastLoginAt: true,
    loginCount: true,
    identities: {
      select: {
        provider: true,
        // NO localCredential, NO metadata
      },
    },
  },
});
```

### Correct Example - User List

```typescript
// apps/api/src/routers/users.ts:200-218
const users = await ctx.prisma.user.findMany({
  where,
  select: {
    id: true,
    email: true,
    username: true,
    firstName: true,
    lastName: true,
    role: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    identities: {
      select: {
        id: true,
        provider: true,
        providerId: true,
        // NO localCredential, NO metadata
      },
    },
  },
});
```

### Helper Functions (Future)

```typescript
// packages/core/src/prisma/selects.ts
export const USER_SAFE_FIELDS = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const IDENTITY_SAFE_FIELDS = {
  id: true,
  provider: true,
  providerId: true,
} as const;

// Usage
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    ...USER_SAFE_FIELDS,
    identities: {
      select: IDENTITY_SAFE_FIELDS,
    },
  },
});
```

### ESLint Rule (Future)

```typescript
// .eslintrc.js
module.exports = {
  rules: {
    'prisma/no-select-less-queries': 'error',
    'prisma/no-sensitive-fields': 'error',
  },
};
```

## Testing Strategy

### Unit Tests

```typescript
describe('Prisma Select Pattern', () => {
  it('should exclude sensitive fields', async () => {
    const user = await prisma.user.findUnique({
      where: { id: 'test-id' },
      select: { id: true, email: true },
    });

    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('localCredential');
    expect(user).not.toHaveProperty('metadata');
  });
});
```

### Integration Tests

```typescript
describe('API Response Security', () => {
  it('API response should not contain sensitive fields', async () => {
    const response = await request(app)
      .get('/api/trpc/me.get')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('localCredential');
  });
});
```

### Bundle Analysis

```typescript
describe('Bundle Security', () => {
  it('bundle should not contain queries without select', () => {
    const bundleContent = fs.readFileSync('dist/bundle.js', 'utf8');
    expect(bundleContent).not.toMatch(/prisma\.user\.findUnique\(\{[^}]*\}\)/);
  });
});
```

## Sensitive Schema

### Models with Sensitive Data

```prisma
// packages/db/prisma/schema.prisma

model LocalCredential {
  id           String   @id @default(uuid())
  identityId   String   @unique
  passwordHash String   // ❌ SENSITIVE - Never expose
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Identity {
  id         String   @id @default(uuid())
  userId     String
  provider   Provider
  providerId String
  metadata   Json?    // ❌ SENSITIVE - May contain PII
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model AppConfig {
  id         String   @id @default(uuid())
  key        String   @unique
  value      String   // ❌ SENSITIVE - May be encrypted
  isEncrypted Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

## Alternatives Considered

### Prisma Middleware

- ❌ Complexity: Middleware to filter fields
- ❌ Performance: Overhead on every query
- ❌ Debugging: Hard to trace applied filters

### DTO Pattern

- ❌ Duplication: A DTO for every endpoint
- ❌ Maintenance: Update the DTO when the schema changes
- ❌ Type Safety: Loss of Prisma type safety

### Database Views

- ❌ Complexity: Managing separate views
- ❌ Performance: Database overhead
- ❌ Maintenance: Synchronizing views with the schema

## Monitoring and Compliance

### Audit Logging

```typescript
// Log queries without select for audit
if (!query.select) {
  logger.warn('Prisma query without select', {
    model: query.model,
    operation: query.action,
    userId: ctx.session?.user?.id,
  });
}
```

### Security Scanning

```bash
# Check the absence of sensitive fields in the output
pnpm test:security-scan
```

## References

- [Prisma Select Fields](https://www.prisma.io/docs/concepts/components/prisma-client/select-fields)
- [OWASP Data Protection](https://owasp.org/www-community/controls/Implementing_Data_Protection)
- [GDPR Compliance](https://gdpr.eu/data-protection-by-design-and-by-default/)
- Examples: `apps/api/src/routers/me.ts:31-51`
- Examples: `apps/api/src/routers/users.ts:200-218`
- Schema: `packages/db/prisma/schema.prisma:67-78`
