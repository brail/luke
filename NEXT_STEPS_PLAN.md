# Next Steps Plan - RBAC Resource/Action Permissions

## 🎯 Obiettivo

Completare la migration del sistema RBAC da ruoli legacy a Resource:Action permissions, ottimizzare l'implementazione e preparare il sistema per funzionalità avanzate.

## 📊 Stato Attuale

- ✅ **Core System**: Implementato completamente
- ✅ **Brand Router**: Migrato completamente
- ✅ **Frontend Components**: Hook e componenti pronti
- ✅ **Testing**: Coverage completa
- ✅ **Documentation**: ADR creato

## 🚀 Phase 2: Router Migration (Priority: HIGH)

### 2.1 Users Router Migration

**File**: `apps/api/src/routers/users.ts`
**Effort**: 2-3 ore
**Dependencies**: Nessuna

**Tasks**:

- [ ] Analizzare procedure esistenti in `users.ts`
- [ ] Mappare operazioni a permissions:
  - `list` → `users:read`
  - `create` → `users:create`
  - `update` → `users:update`
  - `remove` → `users:delete`
- [ ] Sostituire `adminOrEditorProcedure` con `requirePermission()`
- [ ] Aggiornare test per verificare permissions per ruolo
- [ ] Testare con utenti admin/editor/viewer

**Acceptance Criteria**:

- ✅ Editor può read/update users (no create/delete)
- ✅ Viewer può solo read users
- ✅ Admin può tutte le operazioni
- ✅ Test integration verdi

### 2.2 Config Router Migration

**File**: `apps/api/src/routers/config.ts`
**Effort**: 1-2 ore
**Dependencies**: Nessuna

**Tasks**:

- [ ] Analizzare procedure esistenti in `config.ts`
- [ ] Mappare operazioni a permissions:
  - `get` → `config:read`
  - `set` → `config:update`
- [ ] Sostituire middleware legacy con `requirePermission()`
- [ ] Aggiornare test
- [ ] Verificare che solo admin possa modificare config

**Acceptance Criteria**:

- ✅ Solo admin può update config
- ✅ Editor/viewer possono solo read config
- ✅ Test verdi per tutti i ruoli

### 2.3 Audit Router Migration

**File**: `apps/api/src/routers/audit.ts` (se esiste)
**Effort**: 1 ora
**Dependencies**: Nessuna

**Tasks**:

- [ ] Verificare esistenza router audit
- [ ] Mappare operazioni a `audit:read`
- [ ] Applicare `requirePermission('audit:read')`
- [ ] Testare accesso per ruolo

**Acceptance Criteria**:

- ✅ Solo admin/editor/viewer possono read audit
- ✅ Nessuno può create/update/delete audit logs

## 🔧 Phase 3: System Optimization (Priority: MEDIUM)

### 3.1 Performance Optimization

**Effort**: 2-3 ore
**Dependencies**: Router migration completata

**Tasks**:

- [ ] **Cache Strategy Enhancement**:
  - Implementare cache Redis per multi-istanza (opzionale)
  - Ottimizzare cache key strategy
  - Aggiungere TTL configurabile
- [ ] **Permission Precomputation**:
  - Pre-calcolare permissions per ruolo al startup
  - Cache statica per performance massima
- [ ] **Middleware Optimization**:
  - Batch permission checks per multiple operazioni
  - Lazy loading per permissions non critiche

**Metrics da implementare**:

```typescript
// Counter per monitoring
permission_checks_total{permission, result, role}
permission_check_duration_ms{permission}

// Dashboard metrics
- Permission check latency
- Cache hit ratio
- Most denied permissions
```

### 3.2 Developer Experience Enhancement

**Effort**: 3-4 ore
**Dependencies**: Nessuna

**Tasks**:

- [ ] **TypeScript Improvements**:
  - Generare types automatici da `ROLE_PERMISSIONS`
  - Type-safe permission strings con autocomplete
  - Utility types per permission checking
- [ ] **Developer Tools**:
  - CLI tool per verificare permissions: `pnpm check-permissions user@example.com brands:create`
  - Debug component per visualizzare permissions utente
  - Permission testing utilities
- [ ] **Documentation**:
  - Guide per sviluppatori su come usare il sistema
  - Esempi pratici per ogni pattern
  - Migration guide per altri router

**File da creare**:

```
tools/
├── check-permissions.ts
├── debug-permissions.tsx
└── migration-guide.md
```

## 🔐 Phase 4: Advanced Features (Priority: LOW)

### 4.1 Attribute-Based Access Control (ABAC)

**Effort**: 1-2 settimane
**Dependencies**: Sistema base stabile

**Tasks**:

- [ ] **Context-Aware Permissions**:
  ```typescript
  // Esempi di ABAC
  hasPermission(user, 'brands:update', { brandId: 'brand-123' });
  hasPermission(user, 'users:update', { targetUserId: 'user-456' });
  ```
- [ ] **Ownership Rules**:
  - Utenti possono modificare solo i propri dati
  - Brand ownership per team-based access
  - Resource-level permissions
- [ ] **Team-Based Access**:
  - Permissions per team membership
  - Hierarchical permissions (team lead > member)
  - Cross-team collaboration rules

**Implementation**:

```typescript
interface PermissionContext {
  brandId?: string;
  userId?: string;
  teamId?: string;
  organizationId?: string;
}

// Enhanced permission checking
hasPermission(user, permission, context);
```

### 4.2 Dynamic Permissions

**Effort**: 2-3 settimane
**Dependencies**: ABAC implementato

**Tasks**:

- [ ] **Runtime Configuration**:
  - UI per configurare permissions per ruolo
  - Permission templates per scenari comuni
  - A/B testing per permission changes
- [ ] **Time-Based Access**:
  - Permissions con scadenza temporale
  - Accesso limitato per progetti specifici
  - Emergency access override
- [ ] **Audit & Compliance**:
  - Permission change tracking
  - Compliance reporting
  - Automated permission reviews

## 🧹 Phase 5: Cleanup & Deprecation (Priority: LOW)

### 5.1 Legacy Code Removal

**Effort**: 1-2 ore
**Dependencies**: Tutti i router migrati

**Tasks**:

- [ ] **Deprecation Warnings**:
  - Aggiungere console.warn per `adminOrEditorProcedure`
  - Deprecation notice in documentazione
  - Timeline per rimozione (3 mesi)
- [ ] **Code Cleanup**:
  - Rimuovere `adminOrEditorProcedure`
  - Pulire import non utilizzati
  - Aggiornare documentazione
- [ ] **Migration Verification**:
  - Audit completo per usage legacy
  - Verifica zero breaking changes
  - Performance comparison

### 5.2 Documentation & Training

**Effort**: 2-3 ore
**Dependencies**: Sistema completo

**Tasks**:

- [ ] **Developer Documentation**:
  - Complete API reference
  - Best practices guide
  - Common patterns e anti-patterns
- [ ] **Team Training**:
  - Workshop su nuovo sistema
  - Code review guidelines
  - Troubleshooting guide

## 📋 Implementation Timeline

### Week 1-2: Router Migration

- **Day 1-2**: Users router migration + testing
- **Day 3**: Config router migration + testing
- **Day 4**: Audit router migration + testing
- **Day 5**: Integration testing e bug fixes

### Week 3: Optimization

- **Day 1-2**: Performance optimization
- **Day 3-4**: Developer experience enhancement
- **Day 5**: Documentation e testing

### Week 4+: Advanced Features (Optional)

- **Week 4-5**: ABAC implementation
- **Week 6-7**: Dynamic permissions
- **Week 8**: Cleanup e deprecation

## 🎯 Success Metrics

### Technical Metrics

- ✅ **100% Router Migration**: Tutti i router usano nuovo sistema
- ✅ **Zero Breaking Changes**: Backward compatibility mantenuta
- ✅ **Performance**: <1ms permission check latency
- ✅ **Test Coverage**: >95% per permission logic

### Business Metrics

- ✅ **Developer Productivity**: Riduzione tempo per aggiungere nuove permissions
- ✅ **Security**: Granularità fine per access control
- ✅ **Maintainability**: Codice più pulito e organizzato
- ✅ **Scalability**: Sistema pronto per crescita

## 🚨 Risk Mitigation

### Technical Risks

- **Risk**: Breaking changes durante migration
- **Mitigation**: Extensive testing, gradual rollout, rollback plan

### Business Risks

- **Risk**: Developer confusion durante transition
- **Mitigation**: Training, documentation, gradual deprecation

### Performance Risks

- **Risk**: Permission checks impact performance
- **Mitigation**: Caching strategy, performance monitoring

## 📞 Next Actions

### Immediate (This Week)

1. **Start Users Router Migration** - Priorità massima
2. **Setup Performance Monitoring** - Baseline metrics
3. **Create Migration Checklist** - Template per altri router

### Short Term (Next 2 Weeks)

1. **Complete Router Migration** - Users, Config, Audit
2. **Performance Optimization** - Cache e monitoring
3. **Developer Tools** - CLI e debug utilities

### Long Term (Next Month+)

1. **ABAC Implementation** - Context-aware permissions
2. **Dynamic Permissions** - Runtime configuration
3. **Legacy Cleanup** - Deprecation e removal

---

**Ready to start?** 🚀

Il piano è strutturato per essere incrementale e sicuro, con ogni fase che aggiunge valore senza rompere il sistema esistente. Possiamo iniziare con la migration del Users router per continuare il momentum!
