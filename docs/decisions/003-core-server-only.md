# ADR-003: Core Package Server-Only Exports

## Status

**Accepted** - 2024-01-XX

## Context

The Luke project is a monorepo with code shared between:

- **Frontend**: Next.js 15 with App Router (client-side rendering)
- **Backend**: Fastify 5 + tRPC (server-side only)
- **Shared**: Utilities, schemas, common business logic

The critical problem is the **risk of data leakage**: server-only code (secrets, crypto, DB access) could be imported into the frontend by accident, causing:

- **Bundle bloat**: Server code included in the client bundle
- **Security risk**: Secrets exposed in the browser
- **Runtime errors**: Server code executed in a browser environment
- **Performance**: Client bundles heavier than necessary

## Decision

We implemented a **split exports** system with runtime checks:

### Package Structure

```
@luke/core/
├── src/
│   ├── index.ts              # Safe exports (client + server)
│   ├── server/
│   │   └── index.ts          # Server-only exports
│   └── crypto/
│       └── secrets.server.ts # Server-only crypto
└── dist/
    ├── index.js              # Safe bundle
    └── server/
        └── index.js          # Server-only bundle
```

### Export Conditions

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    },
    "./server": {
      "import": "./dist/server/index.js",
      "require": "./dist/server/index.js"
    }
  }
}
```

### Runtime Checks

```typescript
// packages/core/src/crypto/secrets.server.ts
if (typeof window !== 'undefined') {
  throw new Error('secrets.server.ts can only be imported server-side');
}
```

### Import Patterns

```typescript
// ✅ Safe for client and server
import { UserSchema, Role } from '@luke/core';

// ✅ Server-only (API, SSR, build-time)
import { getApiJwtSecret } from '@luke/core/server';

// ❌ Runtime error if imported in the client
import { getMasterKey } from '@luke/core/server';
```

## Consequences

### ✅ Advantages

- **Zero Risk Leakage**: Impossible to import secrets into the frontend
- **Effective Tree Shaking**: The client bundle contains only necessary code
- **Fail-Fast**: Explicit error on a wrong import
- **Type Safety**: TypeScript prevents wrong imports at compile time
- **Performance**: Lighter and faster client bundles
- **Security**: No secret is ever exposed in the browser

### ⚠️ Trade-off

- **Build Complexity**: Managing multiple entry points
- **Dev Experience**: Different import paths to remember
- **Bundle Size**: Code duplication between bundles (acceptable)
- **Learning Curve**: Developers must know the import pattern

### 🔧 Operational Implications

- **Build Process**: Separate compilation for safe/server exports
- **Import Rules**: Clear documentation on what to import where
- **Testing**: Separate tests for client/server imports
- **Deploy**: Check that the client bundle contains no server code

## Implementation

### Server-Only Module

```typescript
// packages/core/src/crypto/secrets.server.ts
/**
 * @luke/core/crypto - Secure secret management (SERVER-ONLY)
 *
 * ⚠️ IMPORTANT: This module can only be imported server-side
 */

// Runtime check: fail if executed in the browser
if (typeof window !== 'undefined') {
  throw new Error('secrets.server.ts can only be imported server-side');
}

export function getMasterKey(): Buffer {
  /* ... */
}
export function getApiJwtSecret(): string {
  /* ... */
}
export function getNextAuthSecret(): string {
  /* ... */
}
```

### Safe Exports

```typescript
// packages/core/src/index.ts
// Safe for client and server
export * from './schemas/user';
export * from './schemas/appConfig';
export * from './rbac';
export * from './pricing';
```

### Server-Only Exports

```typescript
// packages/core/src/server/index.ts
/**
 * @luke/core/server - Server-only modules
 *
 * ⚠️ IMPORTANT: Do not import these modules in client components
 */

// Export crypto utilities (server-only)
export * from '../crypto/secrets.server.js';
```

### Build Configuration

```json
// packages/core/package.json
{
  "scripts": {
    "build": "tsc && tsc -p tsconfig.server.json",
    "build:server": "tsc -p tsconfig.server.json"
  }
}
```

```json
// packages/core/tsconfig.server.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/server"
  },
  "include": ["src/server/**/*", "src/crypto/**/*"]
}
```

## Usage Examples

### ✅ Correct - Frontend

```typescript
// apps/web/src/components/UserForm.tsx
import { UserSchema, Role } from '@luke/core';
import { z } from 'zod';

const formSchema = UserSchema.pick({
  email: true,
  firstName: true,
  lastName: true,
});
```

### ✅ Correct - Backend

```typescript
// apps/api/src/lib/jwt.ts
import { getApiJwtSecret } from '@luke/core/server';
import jwt from 'jsonwebtoken';

const secret = getApiJwtSecret();
const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
```

### ❌ Error - Frontend

```typescript
// apps/web/src/components/SomeComponent.tsx
import { getApiJwtSecret } from '@luke/core/server';
// Runtime Error: "secrets.server.ts can only be imported server-side"
```

### ❌ Error - Build

```typescript
// This will cause a build error if imported into the frontend
import { getMasterKey } from '@luke/core/server';
```

## Testing Strategy

### Unit Tests

```typescript
describe('Server-only imports', () => {
  it('should fail if imported in the browser', () => {
    // Mock window object
    Object.defineProperty(global, 'window', {
      value: {},
      writable: true,
    });

    expect(() => {
      require('@luke/core/server');
    }).toThrow('secrets.server.ts can only be imported server-side');
  });
});
```

### Integration Tests

```typescript
describe('Bundle analysis', () => {
  it('client bundle should not contain server code', () => {
    const bundleContent = fs.readFileSync('dist/client/bundle.js', 'utf8');
    expect(bundleContent).not.toContain('getMasterKey');
    expect(bundleContent).not.toContain('secrets.server');
  });
});
```

## Alternatives Considered

### Single Package with Runtime Checks

- ❌ Bundle bloat: server code included in the client
- ❌ Security risk: possibility of accidental leakage
- ❌ Performance: heavier client bundles

### Separate Packages

- ❌ Duplication: common code duplicated
- ❌ Maintenance: updates in more places
- ❌ Type Safety: loss of type safety between packages

### Build-time Exclusions

- ❌ Complexity: complex build configuration
- ❌ Silent errors: wrong imports not detected
- ❌ Dev Experience: debugging difficulty

## Monitoring and Alerting

### Bundle Analysis

```bash
# Check that the client bundle contains no server code
pnpm build:analyze
```

### Runtime Monitoring

```typescript
// Log server-only import errors in the client
if (typeof window !== 'undefined' && error.message.includes('server-side')) {
  logger.error('Server-only import in the client', { stack: error.stack });
}
```

## References

- [Node.js Package Exports](https://nodejs.org/api/packages.html#exports)
- [TypeScript Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
- [Webpack Tree Shaking](https://webpack.js.org/guides/tree-shaking/)
- Implementation: `packages/core/src/server/index.ts`
- Runtime check: `packages/core/src/crypto/secrets.server.ts:16-18`
- Usage example: `apps/api/src/lib/jwt.ts:13`
