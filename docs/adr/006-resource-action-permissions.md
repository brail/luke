# ADR-006: Resource/Action Permissions System

**Status**: Accepted  
**Date**: 2025-01-27  
**Authors**: Luke Team

## Context

Il sistema Luke aveva un'implementazione RBAC iniziale con controllo accesso basato su ruoli (`adminOrEditorProcedure`) e sezioni (`withSectionAccess`), ma il modello non scalava man mano che aggiungevamo nuove risorse e azioni.

### Problemi identificati:

1. **Granularità limitata**: Solo controllo per ruolo, non per azione specifica
2. **Scalabilità**: Ogni nuova risorsa richiedeva modifiche hardcoded ai middleware
3. **Inconsistenza**: Logica diversa tra API e frontend
4. **Manutenibilità**: Controlli sparsi nei router senza pattern unificato

### Esempi di limitazioni:

```typescript
// Prima: solo controllo ruolo
adminOrEditorProcedure; // Permette tutto o niente

// Prima: controllo sezione generico
withSectionAccess('settings'); // Non distingue read/write
```

## Decision

Implementare un sistema di **Resource/Action Permissions** con modello `Resource:Action` (es. `brands:create`, `users:read`).

### Architettura scelta:

1. **Modello granulare**: `Permission = Resource:Action`
2. **Wildcard support**: `*:*`, `resource:*`, `resource:action`
3. **Cache per-request**: Performance ottimizzata
4. **Backward compatibility**: Mantiene `adminOrEditorProcedure` come alias
5. **Integrazione graduale**: Coesistenza con `UserSectionAccess`

### Implementazione:

```typescript
// Nuovo sistema
requirePermission('brands:create') // Granulare
requirePermission(['brands:create', 'brands:update']) // OR logic

// Frontend
const { can } = useAccess();
can('brands:create') && <CreateButton />

// Componenti
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

// Helper per logica condizionale
export function can(ctx: Context, permission: Permission): boolean

// Cache per-request
ctx._permissionsCache: Map<string, boolean>
```

### 3. Frontend Integration (`apps/web`)

```typescript
// Hook unificato
export function useAccess() {
  const { can, canAll, canAny, isAdmin, isAdminOrEditor } = useAccess();
}

// Componenti conditional rendering
<AccessGate permission="brands:create">
  <CreateButton />
</AccessGate>
```

### 4. Backward Compatibility

```typescript
// Mantiene funzionamento esistente
export const adminOrEditorProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(adminOrEditorMiddleware); // DEPRECATED ma funzionante

// Integrazione con UserSectionAccess
withSectionAccess('settings'); // Internamente usa 'settings:read'
```

## Consequences

### Positive:

- ✅ **Granularità**: Controllo fine per ogni azione
- ✅ **Scalabilità**: Aggiunta nuove risorse senza modifiche hardcoded
- ✅ **Consistenza**: Stesso modello API/FE
- ✅ **Performance**: Cache per-request, zero overhead
- ✅ **DX**: Hook e componenti riusabili
- ✅ **Backward compatibility**: Zero breaking changes

### Negative:

- ❌ **Complessità iniziale**: Curva di apprendimento per sviluppatori
- ❌ **Migration effort**: Refactor graduale dei router esistenti
- ❌ **Configuration overhead**: Più permissions da gestire

### Mitigazioni:

- **Documentazione**: Esempi chiari e pattern guide
- **Migration path**: Refactor incrementale, coesistenza temporanea
- **Tooling**: Helper e shortcut per casi comuni

## Migration Strategy

### Phase 1: Foundation (✅ Completed)

- [x] Core types e helpers
- [x] API middleware con cache
- [x] Frontend hook e componenti
- [x] Test unitari e integration

### Phase 2: Router Migration (🔄 In Progress)

- [x] Brand router migrato
- [ ] Users router
- [ ] Config router
- [ ] Audit router

### Phase 3: Cleanup (📋 Planned)

- [ ] Deprecation warnings per `adminOrEditorProcedure`
- [ ] Rimozione codice legacy
- [ ] Documentazione completa

## Examples

### Before vs After:

```typescript
// BEFORE: Controllo generico
adminOrEditorProcedure; // Tutto o niente

// AFTER: Controllo granulare
requirePermission('brands:create'); // Solo creazione brand
requirePermission('brands:update'); // Solo modifica brand
requirePermission('brands:delete'); // Solo eliminazione brand
```

### Frontend Usage:

```tsx
// BEFORE: Controllo manuale
{
  user.role === 'admin' || user.role === 'editor' ? <CreateButton /> : null;
}

// AFTER: Controllo dichiarativo
<AccessGate permission="brands:create">
  <CreateButton />
</AccessGate>;
```

### Multiple Permissions:

```typescript
// OR logic: almeno una permission
requirePermission(['brands:create', 'brands:update'])

// Frontend: tutte le permissions
<AccessAll permissions={['brands:read', 'brands:update']}>
  <AdvancedEditor />
</AccessAll>
```

## Monitoring & Observability

### Logging:

- Structured logs per FORBIDDEN: `{traceId, userId, permission, resource, action}`
- NO PII in logs (solo IDs)
- Audit trail per violazioni

### Metrics (Future):

- Counter: `permission_checks_total{permission, result}`
- Histogram: `permission_check_duration_ms`

## Future Enhancements

### Phase 2: ABAC (Attribute-Based Access Control)

```typescript
// Context-aware permissions
hasPermission(user, 'brands:update', { brandId: 'brand-123' });
// Verifica ownership o team membership
```

### Phase 3: Dynamic Permissions

```typescript
// Runtime configuration via UI
// Permissions per team/progetto
// Time-based access
```

## References

- [RBAC vs ABAC Comparison](https://example.com/rbac-abac)
- [Permission System Best Practices](https://example.com/permissions)
- [tRPC Middleware Patterns](https://example.com/trpc-middleware)

---

**Decision Record Template**: [ADR Template](https://github.com/joelparkerhenderson/architecture-decision-record)
