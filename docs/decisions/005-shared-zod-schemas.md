# ADR-005: Shared Zod Schemas Pattern

## Status

**Accepted** - 2025-01-26

## Context

Il progetto Luke utilizza Zod per validazione dati sia nel backend (tRPC) che nel frontend (React Hook Form). Attualmente esistono schemi duplicati:

- `apps/api/src/routers/brand.ts`: `brandInputSchema`, `brandIdSchema`
- `apps/web/src/app/(app)/settings/brands/_components/BrandDialog.tsx`: `brandFormSchema`

Questo crea:

- **Debito tecnico**: Modifiche schema richiedono sync manuale
- **Rischio drift**: Frontend e backend possono divergere
- **Manutenzione costosa**: Duplicazione di logica di validazione

## Decision

Centralizzare tutti gli schemi Zod in `packages/core/src/schemas/` per garantire:

1. **DRY (Don't Repeat Yourself)**: Un'unica fonte di verità
2. **Type-safety end-to-end**: Tipi inferiti condivisi
3. **Manutenibilità**: Modifiche in un solo punto
4. **Coerenza**: Pattern uniforme per tutti i modelli

## Implementation Pattern

### 1. Schema Definition

```typescript
// packages/core/src/schemas/brand.ts
import { z } from 'zod';

export const BrandInputSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(128),
  logoUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const BrandIdSchema = z.object({
  id: z.string().uuid(),
});

export const BrandSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Tipi inferiti
export type BrandInput = z.infer<typeof BrandInputSchema>;
export type BrandId = z.infer<typeof BrandIdSchema>;
export type Brand = z.infer<typeof BrandSchema>;
```

### 2. Backend Usage (tRPC)

```typescript
// apps/api/src/routers/brand.ts
import { BrandInputSchema, BrandIdSchema } from '@luke/core';

export const brandRouter = router({
  create: adminOrEditorProcedure
    .input(BrandInputSchema)
    .mutation(async ({ input, ctx }) => {
      // input è tipizzato come BrandInput
    }),

  remove: adminOrEditorProcedure
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      // input.id è tipizzato come string (UUID)
    }),
});
```

### 3. Frontend Usage (React Hook Form)

```typescript
// apps/web/src/app/(app)/settings/brands/_components/BrandDialog.tsx
import { BrandInputSchema } from '@luke/core';
import { zodResolver } from '@hookform/resolvers/zod';

const form = useForm<BrandInput>({
  resolver: zodResolver(BrandInputSchema),
  defaultValues: {
    code: '',
    name: '',
    logoUrl: null,
    isActive: true,
  },
});
```

### 4. Export Pattern

```typescript
// packages/core/src/index.ts
export * from './schemas/brand';
export * from './schemas/user';
export * from './schemas/appConfig';
// ... altri schemi
```

## Migration Strategy

### Phase 1: Backend (Immediate)

- ✅ Creare `packages/core/src/schemas/brand.ts`
- ✅ Migrare `apps/api/src/routers/brand.ts`
- ✅ Testare che tRPC procedures funzionino

### Phase 2: Frontend (Future)

- Migrare `BrandDialog.tsx` per usare `BrandInputSchema`
- Aggiornare altri componenti che usano schemi locali
- Rimuovere schemi duplicati

### Phase 3: New Models

- Applicare pattern a Season, Product, Collection
- Documentare guidelines per nuovi schemi

## Benefits

1. **Type Safety**: Errori di tipo catturati a compile-time
2. **Consistency**: Validazione identica frontend/backend
3. **Maintainability**: Modifiche schema in un solo punto
4. **Developer Experience**: IntelliSense completo
5. **Testing**: Schemi riutilizzabili nei test

## Trade-offs

### Pros

- Eliminazione duplicazione codice
- Type-safety end-to-end
- Manutenibilità migliorata
- Pattern scalabile per nuovi modelli

### Cons

- Overhead build: `@luke/core` → `api` → `web`
- Coupling tra frontend e backend
- Learning curve per sviluppatori

## Examples

### Current (Duplicated)

```typescript
// Backend
const brandInputSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(128),
});

// Frontend
const brandFormSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(128),
});
```

### After (Shared)

```typescript
// packages/core/src/schemas/brand.ts
export const BrandInputSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(128),
});

// Backend
import { BrandInputSchema } from '@luke/core';

// Frontend
import { BrandInputSchema } from '@luke/core';
```

## Guidelines

### Schema Naming

- `{Model}InputSchema`: Per create/update operations
- `{Model}IdSchema`: Per operazioni su singolo record
- `{Model}Schema`: Per output completo
- `{Model}ListInputSchema`: Per query con filtri

### Validation Rules

- Usare messaggi di errore in italiano
- Definire limiti ragionevoli (max length, etc.)
- Includere validazioni business logic quando appropriato
- Usare `.optional()` e `.nullable()` esplicitamente

### Type Exports

- Esportare sempre i tipi inferiti
- Usare naming consistente: `{Model}Input`, `{Model}Id`, `{Model}`

## Related ADRs

- ADR-001: JWT HS256 HKDF (crypto patterns)
- ADR-002: RBAC Policy (authorization patterns)
- ADR-003: Core Server Only (server utilities)

## References

- [Zod Documentation](https://zod.dev/)
- [tRPC Input Validation](https://trpc.io/docs/server/input-validation)
- [React Hook Form + Zod](https://react-hook-form.com/get-started#SchemaValidation)
