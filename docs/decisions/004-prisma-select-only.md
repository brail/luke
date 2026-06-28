# ADR-004: Prisma Select-Only Pattern

## Status

**Accepted** - 2024-01-XX

## Context

Il progetto Luke gestisce dati sensibili che devono essere protetti da **data leakage**:

- **Password hash**: `LocalCredential.passwordHash` (irreversibile ma sensibile)
- **Segreti cifrati**: Configurazioni LDAP con password cifrate
- **PII sensibili**: Metadata utenti, informazioni personali
- **Audit data**: Log di accesso e modifiche utenti

Il problema critico è che Prisma, per default, restituisce **tutti i campi** di un modello:

```typescript
// ❌ PERICOLOSO - Espone tutti i campi
const user = await prisma.user.findUnique({
  where: { id: userId },
});
// Include: passwordHash, metadata, localCredential, etc.
```

Questo può causare:

- **Data leakage**: Campi sensibili esposti in API response
- **Security breach**: Password hash o segreti in log/network
- **Compliance issues**: Violazione GDPR/privacy regulations
- **Performance**: Fetch di dati non necessari

## Decision

Abbiamo adottato il pattern **Prisma Select-Only** con le seguenti regole:

### Regola Fondamentale

**MAI** usare `findMany()`, `findUnique()`, `findFirst()` senza `select` esplicito.

### Pattern Whitelist

```typescript
// ✅ CORRETTO - Solo campi sicuri
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

### Campi Sempre Esclusi

```typescript
// ❌ MAI includere questi campi
const SENSITIVE_FIELDS = [
  'passwordHash', // LocalCredential
  'localCredential', // Intera relazione
  'metadata', // Identity metadata
  'value', // AppConfig (può essere cifrato)
  'auditLogs', // Log sensibili
];
```

### Relazioni Sicure

```typescript
// ✅ Corretto - Solo campi sicuri delle relazioni
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

### ✅ Vantaggi

- **Zero Data Leakage**: Solo campi esplicitamente approvati esposti
- **Audit Semplificato**: Review su `select` block invece di tutto il codice
- **Performance**: Fetch solo campi necessari (meno network, meno memory)
- **Security by Default**: Impossibile esporre dati sensibili per errore
- **Compliance**: Rispetto automatico di privacy regulations
- **Type Safety**: TypeScript inferisce tipi corretti dai select

### ⚠️ Trade-off

- **Verbosità**: `select` block ripetitivi (mitigabile con helper functions)
- **Manutenzione**: Aggiornare tutti i select se schema cambia
- **Learning Curve**: Sviluppatori devono conoscere pattern
- **Code Review**: Review obbligatorio per nuove query Prisma

### 🔧 Implicazioni Operative

- **Code Review**: Verificare `select` in ogni PR
- **Testing**: Test che verificano assenza di campi sensibili
- **Monitoring**: Log di query senza select per audit
- **Documentation**: Esempi chiari per onboarding sviluppatori

## Implementazione

### Esempio Corretto - User Profile

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

### Esempio Corretto - User List

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

### Helper Functions (Futuro)

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

// Uso
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

### ESLint Rule (Futuro)

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
  it('dovrebbe escludere campi sensibili', async () => {
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
  it('API response non dovrebbe contenere campi sensibili', async () => {
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
  it('bundle non dovrebbe contenere query senza select', () => {
    const bundleContent = fs.readFileSync('dist/bundle.js', 'utf8');
    expect(bundleContent).not.toMatch(/prisma\.user\.findUnique\(\{[^}]*\}\)/);
  });
});
```

## Schema Sensibile

### Modelli con Dati Sensibili

```prisma
// apps/api/prisma/schema.prisma

model LocalCredential {
  id           String   @id @default(uuid())
  identityId   String   @unique
  passwordHash String   // ❌ SENSIBILE - Mai esporre
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Identity {
  id         String   @id @default(uuid())
  userId     String
  provider   Provider
  providerId String
  metadata   Json?    // ❌ SENSIBILE - Può contenere PII
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model AppConfig {
  id         String   @id @default(uuid())
  key        String   @unique
  value      String   // ❌ SENSIBILE - Può essere cifrato
  isEncrypted Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

## Alternative Considerate

### Prisma Middleware

- ❌ Complessità: Middleware per filtrare campi
- ❌ Performance: Overhead su ogni query
- ❌ Debugging: Difficile tracciare filtri applicati

### DTO Pattern

- ❌ Duplicazione: DTO per ogni endpoint
- ❌ Manutenzione: Aggiornare DTO quando schema cambia
- ❌ Type Safety: Perdita di type safety Prisma

### Database Views

- ❌ Complessità: Gestione view separate
- ❌ Performance: Overhead database
- ❌ Manutenzione: Sincronizzazione view con schema

## Monitoring e Compliance

### Audit Logging

```typescript
// Log query senza select per audit
if (!query.select) {
  logger.warn('Query Prisma senza select', {
    model: query.model,
    operation: query.action,
    userId: ctx.session?.user?.id,
  });
}
```

### Security Scanning

```bash
# Verifica assenza di campi sensibili in output
pnpm test:security-scan
```

## References

- [Prisma Select Fields](https://www.prisma.io/docs/concepts/components/prisma-client/select-fields)
- [OWASP Data Protection](https://owasp.org/www-community/controls/Implementing_Data_Protection)
- [GDPR Compliance](https://gdpr.eu/data-protection-by-design-and-by-default/)
- Esempi: `apps/api/src/routers/me.ts:31-51`
- Esempi: `apps/api/src/routers/users.ts:200-218`
- Schema: `apps/api/prisma/schema.prisma:67-78`
