# ADR-001: JWT HS256 with HKDF-SHA256 Derivation

## Status

**Accepted** - 2024-01-XX

## Context

The Luke project requires an enterprise-grade authentication system with the following characteristics:

- **Centralized secret management**: A single point of control for all JWT secrets
- **Simple rotation**: The ability to invalidate every token with one operation
- **Cryptographic security**: Standard algorithms and best practices
- **Domain isolation**: Separation between the backend API and web sessions
- **Zero DB storage**: No secret saved in the database

The system must handle two types of token:

1. **API JWT**: For backend authentication (tRPC, Fastify)
2. **NextAuth JWT**: For web sessions (Next.js, cookies)

## Decision

We adopted a strategy based on **HS256 + HKDF-SHA256** with the following characteristics:

### Algorithm and Configuration

- **Algorithm**: HS256 (HMAC-SHA256), explicit
- **Clock tolerance**: ±5 seconds (NTP skew, reduces the replay window)
- **Standard claims**: `iss: 'urn:luke'`, `aud: 'luke.api'`, `exp`, `nbf`
- **TTL**: 8 hours for both token types (perfect synchronization)

### Secret Derivation

- **Master Key**: File `~/.luke/secret.key` (32 bytes, permissions 0600)
- **Derivation**: HKDF-SHA256 (RFC 5869) with parameters:
  - Salt: `'luke'`
  - Info domains: `'api.jwt'` and `'nextauth.secret'`
  - Length: 32 bytes (256 bits)
- **Output format**: Base64URL for compatibility

### Domain Isolation

```typescript
// API Backend
const apiSecret = deriveSecret('api.jwt');

// Web Sessions
const nextAuthSecret = deriveSecret('nextauth.secret');

// Fastify Cookies
const cookieSecret = deriveSecret('cookie.secret');
```

### Secret Rotation

To invalidate every token:

1. Delete `~/.luke/secret.key`
2. Restart the application → a new master key is generated
3. All existing tokens become invalid

## Consequences

### ✅ Advantages

- **Simple rotation**: One operation invalidates every token
- **Zero DB storage**: No secret in the database
- **Determinism**: Same host → same secret across restarts
- **Perfect isolation**: A NextAuth compromise does not compromise the API
- **Enterprise-grade**: Standard algorithms and best practices
- **Fail-fast**: The server terminates if the master key is not accessible

### ⚠️ Trade-off

- **Shared secret**: HS256 vs asymmetric RS256 (acceptable for a monorepo)
- **Bulk invalidation**: Master key rotation invalidates ALL tokens
- **File system dependency**: The master key must be accessible
- **Clock sync**: Requires time synchronization between client and server

### 🔧 Operational Implications

- **Deploy**: The master key must be present on every server
- **Backup**: The master key must NOT be in backups (security)
- **Monitoring**: Check master key accessibility in the health check
- **Development**: The master key is created automatically on first startup

## Implementation

### Key Files

- **Derivation**: `packages/core/src/crypto/secrets.server.ts`
- **JWT Helper**: `apps/api/src/lib/jwt.ts`
- **Configuration**: `README.md:107-119`

### Usage Example

```typescript
// ✅ Correct - Server-side
import { getApiJwtSecret } from '@luke/core/server';

const secret = getApiJwtSecret();
const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
```

```typescript
// ❌ Error - Client-side
import { getApiJwtSecret } from '@luke/core/server';
// Runtime error: "secrets.server.ts can only be imported server-side"
```

### Health Check

```typescript
// Check master key in readiness probe
export function validateMasterKey(): boolean {
  try {
    const masterKey = getMasterKey();
    return masterKey.length === 32;
  } catch {
    return false;
  }
}
```

## Alternatives Considered

### RS256 (Asymmetric)

- ❌ Complexity of managing public/private keys
- ❌ More complex rotation
- ❌ Lower verification performance

### Secrets in the Database

- ❌ Risk of DB compromise
- ❌ Rotation complexity
- ❌ Performance overhead

### Environment Variables

- ❌ Manual management for every deploy
- ❌ Risk of leakage in logs/config
- ❌ No deterministic derivation

## References

- [RFC 5869 - HKDF](https://tools.ietf.org/html/rfc5869)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [HMAC-SHA256](https://tools.ietf.org/html/rfc4868)
- Implementation: `apps/api/src/lib/jwt.ts`
- Derivation: `packages/core/src/crypto/secrets.server.ts`
- Documentation: `README.md:107-119`
