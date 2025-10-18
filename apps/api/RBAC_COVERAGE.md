# RBAC Coverage & Guard Rails — Documentazione

## Panoramica

Questo documento mappa la copertura RBAC (Role-Based Access Control) su tutte le mutazioni sensibili dell'API Luke, garantendo enforcement uniforme e test di integrazione robusti.

## Ruoli Disponibili

| Ruolo    | Descrizione                  | Permessi                    |
| -------- | ---------------------------- | --------------------------- |
| `admin`  | Amministratore completo      | Tutti i permessi            |
| `editor` | Editor con privilegi elevati | Lettura e modifica limitata |
| `viewer` | Visualizzatore               | Solo lettura                |

## Copertura Endpoint

### 🔴 Admin-Only Mutations

Queste mutazioni richiedono il ruolo `admin` e sono protette da `adminProcedure`:

| Endpoint                           | Guardia          | Ruoli Autorizzati | Note di Sicurezza                |
| ---------------------------------- | ---------------- | ----------------- | -------------------------------- |
| `users.create`                     | `adminProcedure` | `admin`           | Creazione utenti con credenziali |
| `users.update`                     | `adminProcedure` | `admin`           | Modifica dati utente e ruoli     |
| `users.delete`                     | `adminProcedure` | `admin`           | Soft delete utenti               |
| `users.hardDelete`                 | `adminProcedure` | `admin`           | Eliminazione definitiva          |
| `users.revokeUserSessions`         | `adminProcedure` | `admin`           | Revoca sessioni utenti           |
| `config.set`                       | `adminProcedure` | `admin`           | Configurazioni critiche          |
| `config.update`                    | `adminProcedure` | `admin`           | Aggiornamento configurazioni     |
| `config.delete`                    | `adminProcedure` | `admin`           | Eliminazione configurazioni      |
| `integrations.storage.saveConfig`  | `adminProcedure` | `admin`           | Credenziali storage (SMB/Drive)  |
| `integrations.mail.saveConfig`     | `adminProcedure` | `admin`           | Credenziali SMTP                 |
| `integrations.auth.saveLdapConfig` | `adminProcedure` | `admin`           | Configurazione LDAP globale      |

### 🟡 Admin or Editor Queries

Queste query richiedono `admin` o `editor` e sono protette da `adminOrEditorProcedure`:

| Endpoint     | Guardia                  | Ruoli Autorizzati | Note di Sicurezza       |
| ------------ | ------------------------ | ----------------- | ----------------------- |
| `users.list` | `adminOrEditorProcedure` | `admin`, `editor` | Lista utenti con filtri |

### 🟢 Protected Mutations

Queste mutazioni richiedono autenticazione e sono protette da `protectedProcedure`:

| Endpoint               | Guardia              | Ruoli Autorizzati           | Note di Sicurezza               |
| ---------------------- | -------------------- | --------------------------- | ------------------------------- |
| `me.updateProfile`     | `protectedProcedure` | `admin`, `editor`, `viewer` | Aggiornamento profilo personale |
| `me.changePassword`    | `protectedProcedure` | `admin`, `editor`, `viewer` | Solo utenti LOCAL               |
| `me.revokeAllSessions` | `protectedProcedure` | `admin`, `editor`, `viewer` | Revoca proprie sessioni         |

### 🔵 Public Endpoints

Questi endpoint sono pubblici e non richiedono autenticazione:

| Endpoint            | Guardia           | Ruoli Autorizzati | Note di Sicurezza           |
| ------------------- | ----------------- | ----------------- | --------------------------- |
| `auth.login`        | `publicProcedure` | Pubblico          | Autenticazione utenti       |
| `integrations.test` | `publicProcedure` | Pubblico          | Test endpoint (placeholder) |

### 🟠 Config Granular Access

Accesso granulare alle configurazioni:

| Endpoint                           | Guardia                         | Ruoli Autorizzati           | Note di Sicurezza              |
| ---------------------------------- | ------------------------------- | --------------------------- | ------------------------------ |
| `config.list`                      | `loggedProcedure`               | `admin`, `editor`, `viewer` | Lista configurazioni           |
| `config.get`                       | `loggedProcedure`               | `admin`, `editor`, `viewer` | Lettura configurazione         |
| `config.viewValue(mode: 'masked')` | `loggedProcedure`               | `admin`, `editor`, `viewer` | Valori mascherati              |
| `config.viewValue(mode: 'raw')`    | `loggedProcedure` + check admin | `admin`                     | Valori decrittati (solo admin) |

## Test Coverage

### Suite di Test Implementata

- **File**: `test/rbac.spec.ts`
- **Framework**: Vitest
- **Copertura**: 20+ test parametrizzati

### Scenari Testati

1. **Admin-only Mutations**: Verifica che solo `admin` possa eseguire mutazioni critiche
2. **Role-based Denial**: Verifica che `editor`/`viewer`/`anonymous` siano negati
3. **Protected Operations**: Verifica accesso per utenti autenticati
4. **Public Access**: Verifica accesso pubblico per endpoint appropriati
5. **Granular Config Access**: Verifica accesso granulare alle configurazioni

### Helper Functions

- `createCallerAs(role)` — Crea caller per ruolo specifico
- `expectAuthorized()` — Verifica operazione autorizzata
- `expectUnauthorized()` — Verifica operazione negata
- `setupTestDb()` / `teardownTestDb()` — Gestione DB isolato

## Implementazione Guardie

### Guardie Centralizzate

Tutte le guardie sono centralizzate in `apps/api/src/lib/trpc.ts`:

```typescript
// Procedure base
export const publicProcedure = t.procedure;
export const protectedProcedure = publicProcedure.use(authMiddleware);
export const adminProcedure = publicProcedure.use(adminMiddleware);
export const adminOrEditorProcedure = publicProcedure.use(
  adminOrEditorMiddleware
);

// Helper per controlli granulari
export function ensureRoles(
  session: UserSession | null,
  allowedRoles: Role[]
): void;
```

### Helper RBAC

Helper aggiuntivi in `apps/api/src/lib/rbac.ts`:

```typescript
export function canAccess(
  session: UserSession | null,
  allowedRoles: Role[]
): boolean;
export function isAdmin(session: UserSession | null): boolean;
export function isAdminOrEditor(session: UserSession | null): boolean;
export function canModifyUser(
  session: UserSession | null,
  targetUserId: string
): boolean;
```

## Sicurezza e Validazione

### Enforcement Server-side

- **Fonte di verità**: Tutte le verifiche RBAC sono server-side
- **Errori coerenti**: `TRPCError` con codici `UNAUTHORIZED`/`FORBIDDEN`
- **Nessun dato sensibile**: Messaggi di errore generici

### Audit Logging

Tutte le operazioni sensibili sono loggate in `AuditLog`:

- Creazione/aggiornamento/eliminazione utenti
- Modifiche configurazioni critiche
- Operazioni di sicurezza (revoca sessioni)

### Test Infrastructure

- **DB isolato**: SQLite in-memory per test
- **Mock context**: Context tRPC mockato per test
- **Cleanup automatico**: Pulizia DB tra test

## Comandi di Validazione

```bash
# Lint e typecheck
pnpm -w lint && pnpm -w typecheck

# Build
pnpm -w build

# Run test suite
pnpm -w -F @luke/api test

# Dev server
pnpm -w dev
```

## Status Implementazione

- ✅ **Guardie centralizzate**: Implementate in `lib/trpc.ts`
- ✅ **Integrations router**: Fixato da `publicProcedure` a `adminProcedure`
- ✅ **Test infrastructure**: Vitest configurato con helpers
- ✅ **Suite RBAC**: 20+ test parametrizzati implementati
- ✅ **Documentazione**: Coverage completa documentata

## Note di Sicurezza

1. **Configurazioni critiche**: LDAP, SMTP, Storage credentials sono sempre protette da `adminProcedure`
2. **Self-profile**: Utenti possono modificare solo il proprio profilo
3. **Provider locking**: Campi sincronizzati (LDAP/OIDC) non modificabili
4. **Token versioning**: Revoca sessioni tramite incremento `tokenVersion`
5. **Audit trail**: Tutte le operazioni sensibili sono tracciate

---

**Ultimo aggiornamento**: $(date)  
**Versione**: 1.0  
**Status**: ✅ Implementazione completata
