# ADR-002: RBAC Policy e Enforcement

## Status

Potentially stale — review needed

## Context

Il progetto Luke è un sistema enterprise multi-tenant che richiede:

- **Controllo accessi granulare**: Diversi livelli di privilegi per utenti
- **Sicurezza per default**: Principio del minimo privilegio
- **Audit trail**: Tracciamento completo degli accessi privilegiati
- **Manutenibilità**: Codice DRY senza duplicazione di logica RBAC
- **Testing**: Coverage verificabile per tutti i controlli di accesso

Il sistema deve gestire operazioni sensibili come:

- Gestione utenti (creazione, modifica, eliminazione)
- Configurazioni di sistema (LDAP, autenticazione)
- Visualizzazione dati sensibili (audit log, configurazioni)

## Decision

Abbiamo implementato un sistema RBAC centralizzato con le seguenti caratteristiche:

### Modello Ruoli

```typescript
enum Role {
  admin = 'admin', // Tutti i permessi
  editor = 'editor', // Lettura e modifica
  viewer = 'viewer', // Solo lettura
}
```

### Middleware Composabili

```typescript
// Middleware per singolo ruolo
export function withRole(role: Role): MiddlewareFunction;

// Middleware per ruoli multipli
export function roleIn(roles: Role[]): MiddlewareFunction;

// Alias predefiniti
export const adminOnly: MiddlewareFunction;
export const adminOrEditor: MiddlewareFunction;
export const authenticatedOnly: MiddlewareFunction;
```

### Enforcement Multi-Livello

1. **Middleware tRPC**: Controllo automatico su ogni endpoint
2. **Helper Functions**: Controlli condizionali nel codice
3. **Type Safety**: TypeScript per prevenire errori a compile-time

### Policy Centralizzata

- **Definizioni**: `@luke/core` package
- **Implementazione**: `apps/api/src/lib/rbac.ts`
- **Testing**: Coverage documentato in `RBAC_COVERAGE.md`

## Consequences

### ✅ Vantaggi

- **Codice DRY**: Zero duplicazione di logica RBAC nei router
- **Type Safety**: Controlli a compile-time con TypeScript
- **Testing Centralizzato**: Coverage verificabile e documentato
- **Audit Automatico**: Log di tutti gli accessi privilegiati
- **Manutenibilità**: Modifiche RBAC in un solo posto
- **Composabilità**: Middleware riusabili e combinabili

### ⚠️ Trade-off

- **Performance**: Check su ogni chiamata protetta (mitigato con cache)
- **Complessità**: Apprendimento pattern middleware per nuovi sviluppatori
- **Token Invalidation**: Cambio ruoli richiede incremento `tokenVersion`

### 🔧 Implicazioni Operative

- **Onboarding**: Sviluppatori devono conoscere pattern middleware
- **Testing**: Obbligatorio testare tutti i path RBAC
- **Monitoring**: Log di accessi negati per security analysis
- **Deploy**: Cambio ruoli richiede invalidazione sessioni attive

## Implementazione

### Esempio Router

```typescript
export const usersRouter = router({
  // Solo admin
  create: adminOnly.input(CreateUserSchema).mutation(async ({ ctx, input }) => {
    // Logica creazione utente
  }),

  // Admin o editor
  list: adminOrEditor.input(ListUsersSchema).query(async ({ ctx, input }) => {
    // Logica lista utenti
  }),

  // Solo utente autenticato
  profile: authenticatedOnly.query(async ({ ctx }) => {
    // Logica profilo personale
  }),
});
```

### Helper Functions

```typescript
// Controlli condizionali
if (isAdmin(session)) {
  // Logica admin-only
}

if (canModifyUser(session, targetUserId)) {
  // Logica modifica utente
}

if (canViewUser(session, targetUserId)) {
  // Logica visualizzazione utente
}
```

### Testing Pattern

```typescript
describe('RBAC Enforcement', () => {
  it('admin può accedere a tutti gli endpoint', async () => {
    const adminSession = createSession({ role: 'admin' });
    // Test tutti gli endpoint
  });

  it('editor non può accedere a endpoint admin-only', async () => {
    const editorSession = createSession({ role: 'editor' });
    await expect(adminOnlyEndpoint(editorSession)).rejects.toThrow('FORBIDDEN');
  });
});
```

## Policy Dettagliate

### Admin (`admin`)

- **Permessi**: Tutti (`*`)
- **Operazioni**: CRUD completo su utenti, configurazioni, audit
- **Restrizioni**: Non può eliminare se stesso, non può rimuovere ultimo admin

### Editor (`editor`)

- **Permessi**: `read`, `update`
- **Operazioni**: Visualizzazione e modifica utenti, configurazioni
- **Restrizioni**: Non può modificare ruoli, non può accedere a configurazioni sensibili

### Viewer (`viewer`)

- **Permessi**: `read`
- **Operazioni**: Solo visualizzazione dati
- **Restrizioni**: Nessuna modifica, solo lettura profilo personale

## Security Considerations

### Token Version Enforcement

```typescript
// Cambio ruolo → incremento tokenVersion
await prisma.user.update({
  where: { id: userId },
  data: {
    role: newRole,
    tokenVersion: { increment: 1 },
  },
});

// Invalidazione immediata cache
invalidateTokenVersionCache(userId);
```

### Audit Logging

```typescript
// Log automatico per operazioni privilegiate
await logAudit(ctx, {
  action: 'USER_ROLE_CHANGED',
  resource: 'user',
  resourceId: userId,
  metadata: { oldRole, newRole },
});
```

### Rate Limiting

```typescript
// Rate limit specifico per operazioni RBAC
const rbacRateLimit = withRateLimit({
  max: 10,
  windowMs: 15 * 60 * 1000, // 15 minuti
  keyGenerator: ctx => `rbac:${ctx.session.user.id}`,
});
```

## Alternative Considerate

### ACL (Access Control Lists)

- ❌ Complessità gestione permessi granulari
- ❌ Performance overhead per check multipli
- ❌ Difficile testing e manutenzione

### RBAC con Permessi Dinamici

- ❌ Complessità eccessiva per use case attuali
- ❌ Over-engineering per sistema monorepo
- ❌ Difficile audit e compliance

### Controlli Manuali nei Router

- ❌ Duplicazione codice
- ❌ Inconsistenze tra endpoint
- ❌ Difficile testing e manutenzione

## References

- [RBAC Standard](https://csrc.nist.gov/Projects/role-based-access-control)
- [OWASP Access Control](https://owasp.org/www-community/Access_Control_Cheat_Sheet)
- Implementazione: `apps/api/src/lib/rbac.ts`
- Coverage: `apps/api/RBAC_COVERAGE.md`
- Esempi: `apps/api/src/routers/users.ts:145`
- Schema: `packages/core/src/rbac.ts`
