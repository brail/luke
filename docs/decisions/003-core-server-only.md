# ADR-003: Core Package Server-Only Exports

## Status

**Accepted** - 2024-01-XX

## Context

Il progetto Luke è un monorepo con codice condiviso tra:

- **Frontend**: Next.js 15 con App Router (client-side rendering)
- **Backend**: Fastify 5 + tRPC (server-side only)
- **Shared**: Utilities, schemi, logica business comune

Il problema critico è il **rischio di data leakage**: codice server-only (segreti, crypto, DB access) potrebbe essere accidentalmente importato nel frontend, causando:

- **Bundle bloat**: Codice server incluso nel bundle client
- **Security risk**: Segreti esposti nel browser
- **Runtime errors**: Codice server eseguito in ambiente browser
- **Performance**: Bundle client più pesanti del necessario

## Decision

Abbiamo implementato un sistema di **split exports** con controlli runtime:

### Struttura Package

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
  throw new Error('secrets.server.ts può essere importato solo server-side');
}
```

### Import Patterns

```typescript
// ✅ Safe per client e server
import { UserSchema, Role } from '@luke/core';

// ✅ Server-only (API, SSR, build-time)
import { getApiJwtSecret } from '@luke/core/server';

// ❌ Errore runtime se importato nel client
import { getMasterKey } from '@luke/core/server';
```

## Consequences

### ✅ Vantaggi

- **Zero Risk Leakage**: Impossibile importare segreti nel frontend
- **Tree Shaking Efficace**: Bundle client contiene solo codice necessario
- **Fail-Fast**: Errore esplicito se import errato
- **Type Safety**: TypeScript previene import errati a compile-time
- **Performance**: Bundle client più leggeri e veloci
- **Security**: Nessun segreto mai esposto nel browser

### ⚠️ Trade-off

- **Complessità Build**: Gestione multipli entry point
- **Dev Experience**: Import path diversi da ricordare
- **Bundle Size**: Duplicazione di codice tra bundle (accettabile)
- **Learning Curve**: Sviluppatori devono conoscere pattern import

### 🔧 Implicazioni Operative

- **Build Process**: Compilazione separata per safe/server exports
- **Import Rules**: Documentazione chiara su cosa importare dove
- **Testing**: Test separati per client/server imports
- **Deploy**: Verificare che bundle client non contenga codice server

## Implementazione

### Server-Only Module

```typescript
// packages/core/src/crypto/secrets.server.ts
/**
 * @luke/core/crypto - Gestione sicura dei segreti (SERVER-ONLY)
 *
 * ⚠️ IMPORTANTE: Questo modulo può essere importato solo server-side
 */

// Runtime check: fail se eseguito nel browser
if (typeof window !== 'undefined') {
  throw new Error('secrets.server.ts può essere importato solo server-side');
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
// Safe per client e server
export * from './schemas/user';
export * from './schemas/appConfig';
export * from './rbac';
export * from './pricing';
```

### Server-Only Exports

```typescript
// packages/core/src/server/index.ts
/**
 * @luke/core/server - Moduli server-only
 *
 * ⚠️ IMPORTANTE: Non importare questi moduli in componenti client
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

## Esempi d'Uso

### ✅ Corretto - Frontend

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

### ✅ Corretto - Backend

```typescript
// apps/api/src/lib/jwt.ts
import { getApiJwtSecret } from '@luke/core/server';
import jwt from 'jsonwebtoken';

const secret = getApiJwtSecret();
const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
```

### ❌ Errore - Frontend

```typescript
// apps/web/src/components/SomeComponent.tsx
import { getApiJwtSecret } from '@luke/core/server';
// Runtime Error: "secrets.server.ts può essere importato solo server-side"
```

### ❌ Errore - Build

```typescript
// Questo causerà errore di build se importato nel frontend
import { getMasterKey } from '@luke/core/server';
```

## Testing Strategy

### Unit Tests

```typescript
describe('Server-only imports', () => {
  it('dovrebbe fallire se importato nel browser', () => {
    // Mock window object
    Object.defineProperty(global, 'window', {
      value: {},
      writable: true,
    });

    expect(() => {
      require('@luke/core/server');
    }).toThrow('secrets.server.ts può essere importato solo server-side');
  });
});
```

### Integration Tests

```typescript
describe('Bundle analysis', () => {
  it('bundle client non dovrebbe contenere codice server', () => {
    const bundleContent = fs.readFileSync('dist/client/bundle.js', 'utf8');
    expect(bundleContent).not.toContain('getMasterKey');
    expect(bundleContent).not.toContain('secrets.server');
  });
});
```

## Alternative Considerate

### Single Package con Runtime Checks

- ❌ Bundle bloat: codice server incluso nel client
- ❌ Security risk: possibilità di leakage accidentale
- ❌ Performance: bundle client più pesanti

### Package Separati

- ❌ Duplicazione: codice comune duplicato
- ❌ Manutenzione: aggiornamenti in più posti
- ❌ Type Safety: perdita di type safety tra package

### Build-time Exclusions

- ❌ Complessità: configurazione build complessa
- ❌ Errori silenti: import errati non rilevati
- ❌ Dev Experience: difficoltà debugging

## Monitoring e Alerting

### Bundle Analysis

```bash
# Verifica che bundle client non contenga codice server
pnpm build:analyze
```

### Runtime Monitoring

```typescript
// Log errori di import server-only nel client
if (typeof window !== 'undefined' && error.message.includes('server-side')) {
  logger.error('Import server-only nel client', { stack: error.stack });
}
```

## References

- [Node.js Package Exports](https://nodejs.org/api/packages.html#exports)
- [TypeScript Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
- [Webpack Tree Shaking](https://webpack.js.org/guides/tree-shaking/)
- Implementazione: `packages/core/src/server/index.ts`
- Runtime check: `packages/core/src/crypto/secrets.server.ts:16-18`
- Esempio uso: `apps/api/src/lib/jwt.ts:13`
