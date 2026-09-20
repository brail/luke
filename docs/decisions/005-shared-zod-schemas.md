# ADR-005: Shared Zod Schemas Pattern

## Status

**Accepted** - 2025-01-26

## Context

The Luke project uses Zod for data validation both in the backend (tRPC) and in the frontend (React Hook Form). Duplicated schemas currently exist:

- `apps/api/src/routers/brand.ts`: `brandInputSchema`, `brandIdSchema`
- `apps/web/src/app/(app)/settings/brands/_components/BrandDialog.tsx`: `brandFormSchema`

This creates:

- **Technical debt**: Schema changes require manual syncing
- **Drift risk**: Frontend and backend can diverge
- **Costly maintenance**: Duplication of validation logic

## Decision

Centralize every Zod schema in `packages/core/src/schemas/` to guarantee:

1. **DRY (Don't Repeat Yourself)**: A single source of truth
2. **End-to-end type safety**: Shared inferred types
3. **Maintainability**: Changes in a single place
4. **Consistency**: A uniform pattern for every model

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

// Inferred types
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
      // input is typed as BrandInput
    }),

  remove: adminOrEditorProcedure
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      // input.id is typed as string (UUID)
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
// ... other schemas
```

## Migration Strategy

### Phase 1: Backend (Immediate)

- ✅ Create `packages/core/src/schemas/brand.ts`
- ✅ Migrate `apps/api/src/routers/brand.ts`
- ✅ Test that the tRPC procedures work

### Phase 2: Frontend (Future)

- Migrate `BrandDialog.tsx` to use `BrandInputSchema`
- Update other components that use local schemas
- Remove duplicated schemas

### Phase 3: New Models

- Apply the pattern to Season, Product, Collection
- Document guidelines for new schemas

## Benefits

1. **Type Safety**: Type errors caught at compile time
2. **Consistency**: Identical validation in frontend/backend
3. **Maintainability**: Schema changes in a single place
4. **Developer Experience**: Complete IntelliSense
5. **Testing**: Schemas reusable in tests

## Trade-offs

### Pros

- Elimination of code duplication
- End-to-end type safety
- Improved maintainability
- A pattern that scales to new models

### Cons

- Overhead build: `@luke/core` → `api` → `web`
- Coupling between frontend and backend
- Learning curve for developers

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

- `{Model}InputSchema`: For create/update operations
- `{Model}IdSchema`: For operations on a single record
- `{Model}Schema`: For the complete output
- `{Model}ListInputSchema`: For queries with filters

### Validation Rules

- Use error messages in Italian
- Define reasonable limits (max length, etc.)
- Include business-logic validations when appropriate
- Use `.optional()` and `.nullable()` explicitly

### Type Exports

- Always export the inferred types
- Use consistent naming: `{Model}Input`, `{Model}Id`, `{Model}`

## Related ADRs

- ADR-001: JWT HS256 HKDF (crypto patterns)
- ADR-002: RBAC Policy (authorization patterns)
- ADR-003: Core Server Only (server utilities)

## References

- [Zod Documentation](https://zod.dev/)
- [tRPC Input Validation](https://trpc.io/docs/server/input-validation)
- [React Hook Form + Zod](https://react-hook-form.com/get-started#SchemaValidation)
