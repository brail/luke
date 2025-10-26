# Mappa Architetturale Luke - Flussi Brand

## Workspace Turborepo

```
luke/
├── apps/
│   ├── web/          # Next.js 14 App Router (Frontend)
│   └── api/           # Fastify + tRPC + Prisma (Backend)
├── packages/
│   └── core/          # Schemi Zod, RBAC, Utils (Shared)
└── docs/
    └── adr/           # Architecture Decision Records
```

## Dipendenze Build (Turbo)

```
packages/core (build) → apps/api (build) → apps/web (build)
```

## Flussi tRPC Brand

### 1. List Brand (Query)

```
Frontend (RSC) → tRPC Client → Backend Router → Prisma → SQLite
     ↓              ↓              ↓           ↓        ↓
page.tsx → trpc.brand.list → brandRouter.list → brand.findMany → brands[]
```

### 2. Create Brand (Mutation)

```
Frontend (CSR) → tRPC Client → Backend Router → Prisma → SQLite
     ↓              ↓              ↓           ↓        ↓
BrandDialog → trpc.brand.create → brandRouter.create → brand.create → brand{}
```

### 3. Upload Logo (Hybrid)

```
Frontend (CSR) → Next.js API Route → Fastify Route → Storage Service
     ↓              ↓                    ↓              ↓
BrandDialog → /api/upload/brand-logo → /upload/brand-logo → putObject()
```

## Boundary RSC/CSR

### RSC (Server Components)

- `apps/web/src/app/(app)/settings/brands/page.tsx` - Layout e metadata
- `apps/web/src/components/context/BrandAvatar.tsx` - Componente puro

### CSR (Client Components)

- `apps/web/src/app/(app)/settings/brands/_components/BrandDialog.tsx` - Form interattivo
- `apps/web/src/app/(app)/settings/brands/_components/BrandTable.tsx` - Tabella con azioni
- `apps/web/src/components/context/ContextSelector.tsx` - Selettori dinamici

## Type Safety End-to-End

```
packages/core/src/schemas/brand.ts (Zod) → apps/api/src/routers/brand.ts (tRPC) → apps/web/src/lib/trpc.tsx (Client)
```

## Security Layers

1. **Authentication**: NextAuth.js → JWT → tRPC middleware
2. **Authorization**: RBAC (admin/editor/viewer) → tRPC procedures
3. **Rate Limiting**: Per-route policies → In-memory store
4. **Input Validation**: Zod schemas → tRPC input validation
5. **File Upload**: MIME whitelist + size limit + filename sanitization
6. **CORS**: Dynamic origins from AppConfig/ENV
7. **Audit Logging**: Structured logging with PII redaction

## Data Flow Summary

```
User Action → Frontend Validation → tRPC Call → Backend Validation → Database → Audit Log
     ↓              ↓                   ↓              ↓              ↓           ↓
BrandDialog → Zod Schema → HTTP Batch → Zod Schema → Prisma → AuditLog
```

## Performance Considerations

- **Query Invalidation**: Centralized cache invalidation after mutations
- **Batch Requests**: tRPC httpBatchLink for multiple queries
- **Database Indexes**: Missing on Brand.name and (isActive, name)
- **Static Files**: Direct serving via Fastify static plugin
- **Rate Limiting**: LRU cache with automatic cleanup
