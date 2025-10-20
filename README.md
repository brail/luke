# Luke Monorepo

Monorepo enterprise con pnpm + Turborepo per applicazioni web moderne con focus su sicurezza, audit e qualità.

## Indice

- [Struttura](#struttura)
- [Quick Start](#quick-start)
- [Workspaces](#workspaces)
- [Scripts Disponibili](#scripts-disponibili)
- [Convenzioni Naming](#convenzioni-naming)
- [Sicurezza](#sicurezza)
- [Qualità](#qualità)
- [Database](#database)
- [Workflow](#workflow)
- [Architecture Decision Records (ADR)](#architecture-decision-records-adr)
- [Error UX & User Experience](#error-ux--user-experience)
- [UI Settings Standard](#ui-settings-standard)
- [Tecnologie](#tecnologie)
- [Manutenzione Import](#manutenzione-import)
- [Troubleshooting](#troubleshooting)
- [Note](#note)
- [Riferimenti Correlati](#riferimenti-correlati)

## Struttura

```
luke/
├── apps/
│   ├── web/          # Next.js 15 + shadcn/ui frontend
│   └── api/          # Fastify 5 + tRPC + Prisma backend
├── packages/
│   └── core/         # Zod schemas, RBAC, utilities condivise
└── [config files]    # pnpm, turbo, typescript, eslint, prettier
```

## Quick Start

### Prerequisiti

- Node.js >= 20.0.0 (usa `nvm use` per versione automatica)
- pnpm >= 8.0.0

### Setup iniziale

```bash
# Installa dipendenze
pnpm install

# Aggiorna dipendenze all'ultima versione
pnpm deps:latest

# Build tutti i workspace
pnpm build

# Esegui seed del database (genera segreti JWT e NextAuth)
pnpm --filter @luke/api run seed

# Avvia in modalità sviluppo
pnpm dev
```

## Workspaces

### `@luke/web` (apps/web)

- **Framework**: Next.js 15 con App Router
- **UI**: shadcn/ui components
- **Styling**: Tailwind CSS
- **Port**: http://localhost:3000

### `@luke/api` (apps/api)

- **Framework**: Fastify 5
- **API**: tRPC per type-safe APIs
- **Database**: Prisma ORM (SQLite → PostgreSQL)
- **Port**: http://localhost:3001

### `@luke/core` (packages/core)

- **Validation**: Zod schemas
- **RBAC**: Role-based access control
- **Utils**: Funzioni condivise tra frontend/backend

## Scripts Disponibili

```bash
# Sviluppo
pnpm dev              # Avvia tutti i workspace in dev mode
pnpm build            # Build tutti i workspace
pnpm lint             # Lint tutti i file
pnpm format           # Formatta codice con Prettier

# Dipendenze
pnpm deps:latest      # Aggiorna tutte le dipendenze all'ultima versione
pnpm install          # Installa dipendenze

# Workspace specifici
pnpm --filter @luke/web dev     # Solo frontend
pnpm --filter @luke/api dev     # Solo backend
pnpm --filter @luke/core build  # Solo core package
```

## Convenzioni Naming

- **Packages**: `@luke/*` (es. `@luke/web`, `@luke/api`, `@luke/core`)
- **Environment**: `LUKE_*` (es. `LUKE_DB_URL`, `LUKE_JWT_SECRET`)
- **JWT Issuer**: `urn:luke`
- **HTTP Headers**: `x-luke-trace-id` per tracing
- **Git**: Conventional commits

## Sicurezza

### Configurazione

- **Nessun .env**: Tutte le configurazioni sono in database (AppConfig)
- **Cifratura**: AES-256-GCM per segreti sensibili
- **Principio "mai decrypt in bulk"**: liste configurazioni non espongono mai valori cifrati in chiaro
- **Visualizzazione controllata**: modalità masked/raw con audit obbligatorio per raw
- **Enterprise LDAP**: autenticazione enterprise con role mapping e strategia configurabile
- **Master Key**:
  - File: `~/.luke/secret.key` (permessi 0600, creazione automatica)
- **JWT & NextAuth**: HS256 con secret derivato via HKDF-SHA256 dalla master key
- **Derivazione segreti**: HKDF con domini isolati (`api.jwt`, `nextauth.secret`)
- **NextAuth Secret**: Derivato automaticamente dalla master key tramite HKDF-SHA256. Non è mai esposto via rete né salvato in database

### JWT & NextAuth

- **Algoritmo**: HS256 (HMAC-SHA256) esplicito
- **Derivazione**: HKDF-SHA256 (RFC 5869) dalla master key
- **Parametri HKDF**: salt='luke', info domain-specific, length=32 bytes
- **Claim standard**: `iss: 'urn:luke'`, `aud: 'luke.api'`, `exp`, `nbf`
- **Clock tolerance**: ±60 secondi per gestire skew temporale
- **Domini isolati**:
  - `api.jwt` → JWT API backend
  - `nextauth.secret` → NextAuth web sessions
  - `cookie.secret` → Fastify cookie firmati
- **Scope**: Server-only, mai esposto via HTTP
- **Rotazione**: Rigenera `~/.luke/secret.key` per invalidare tutti i token
- **Nessun endpoint pubblico**: Segreti mai esposti via API

### Health & Readiness

- **`/livez`** (Liveness): Processo attivo, event loop responsive
- **`/readyz`** (Readiness): Sistema pronto (DB connesso, segreti disponibili)
- **Fail-fast**: Server termina con exit(1) se segreti non derivabili al boot
- **Kubernetes**: Usa `/livez` per liveness, `/readyz` per readiness probe

### Autenticazione

- **Config-driven**: Local → LDAP → OIDC (configurabile via DB)
- **RBAC**: Role-based access control con `@luke/core`
- **Guardie middleware**: `withRole()`, `roleIn()`, `adminOnly`, `adminOrEditor`
- **Audit**: Log completo di tutte le mutazioni

### Security — Session Invalidation & Hardening

#### Architettura JWT Sincronizzata

- **NextAuth JWT**: `maxAge: 8h`, `updateAge: 4h` (refresh automatico ogni 4h)
- **API JWT**: `expiresIn: 8h` (allineato con NextAuth)
- **Cookie Policy**: `httpOnly: true`, `secure: production`, `sameSite: 'lax'`
- **Clock Tolerance**: `±30s` (ridotto da 60s per maggiore sicurezza)

#### TokenVersion Enforcement Multi-Layer

- **API Middleware**: Verifica `tokenVersion` in ogni chiamata protetta con cache 5min
- **NextAuth Callback**: Verifica `tokenVersion` durante refresh JWT chiamando API
- **Middleware Next.js**: Verifica `tokenVersion` su navigazione tra pagine
- **Client-side Hook**: Verifica periodica ogni 10s + su focus/visibility change
- **Cache Invalidation**: Immediata su revoca sessioni, cambio password, logout hard

#### Logout & Revoca Sessioni

- **Soft Logout**: `auth.logout` (solo clear cookie/session)
- **Hard Logout**: `auth.logoutAll` + `me.revokeAllSessions` (incrementa `tokenVersion`)
- **Revoca Admin**: Admin può revocare sessioni di altri utenti con invalidazione immediata
- **Redirect Immediato**: Utente target viene logout automaticamente in < 1s

#### JWT Claims Standardizzati

- **NextAuth**: `nbf`, `aud: 'luke.web'`, `iss: 'urn:luke'`
- **API JWT**: `nbf`, `aud: 'luke.api'`, `iss: 'urn:luke'`
- **Logging Sicuro**: Token prefix limitato a 10 caratteri per sicurezza

#### Architettura Semplificata

- **Cookie API Rimosso**: Solo Authorization header per coerenza e riduzione superficie attacco
- **Segreti HKDF Distinti**: `nextauth.secret` vs `api.jwt` con domini isolati
- **Verifica Multi-Livello**: Server-side (middleware) + Client-side (hook periodico)
- **Performance**: Cache intelligente 5min con invalidazione proattiva

#### Flusso di Invalidazione Sessioni

```
Admin revoca sessioni → tokenVersion incrementato nel DB
├── API: Verifica tokenVersion → 401 Unauthorized ✅
├── NextAuth: Verifica tokenVersion nel callback jwt → return null → Logout automatico ✅
├── Middleware: Verifica tokenVersion su navigazione → Redirect a /login ✅
└── Client: Verifica periodica ogni 10s + su focus → Redirect immediato ✅
```

#### Sicurezza Enterprise-Level

- **Sincronizzazione Perfetta**: NextAuth e API JWT allineati (8h TTL)
- **Invalidazione Immediata**: Cache invalidata in < 1ms su revoca
- **Redirect Automatico**: Utente logout in < 1s quando sessioni revocate
- **Defense in Depth**: 4 livelli di verifica tokenVersion
- **Zero Over-Engineering**: Architettura pulita, DRY, best practices

### Email Transazionali

Luke supporta email transazionali per funzionalità di sicurezza essenziali:

#### Flussi Supportati

1. **Reset Password**
   - Utenti con identità LOCAL possono richiedere reset password via email
   - Token monouso valido 30 minuti, hash SHA-256 salvato in DB
   - Link: `{baseUrl}/auth/reset?token={token}`
   - Invalidazione automatica sessioni attive dopo reset

2. **Verifica Email**
   - Verifica indirizzo email per utenti LOCAL
   - Token monouso valido 24 ore, hash SHA-256 salvato in DB
   - Link: `{baseUrl}/auth/verify?token={token}`
   - Configurabile come obbligatoria per login (`auth.requireEmailVerification`)
   - **Invio Automatico**: Quando un admin crea un nuovo utente LOCAL, l'email di verifica viene inviata automaticamente (best-effort, non blocca la creazione se SMTP non è configurato)

#### Configurazione SMTP

Richiede configurazione in `AppConfig`:

```typescript
smtp.host; // Host server SMTP (es. smtp.gmail.com)
smtp.port; // Porta (es. 587, 465)
smtp.secure; // true per TLS/SSL, false per STARTTLS
smtp.user; // Username autenticazione
smtp.pass; // Password (cifrata con AES-256-GCM)
smtp.from; // Indirizzo mittente (es. noreply@example.com)
app.baseUrl; // URL base per link nelle email
```

**Test Email**: Il sistema permette di inviare un'email di test per verificare la configurazione SMTP. È possibile specificare un destinatario personalizzato o lasciare vuoto per inviare l'email all'indirizzo mittente configurato (`smtp.from`).

**Invio Automatico**: Quando viene creato un nuovo utente con identità LOCAL, il sistema tenta automaticamente di inviare l'email di verifica. Se SMTP non è configurato o l'invio fallisce, la creazione dell'utente **non viene bloccata** (silent fail). L'esito dell'invio è tracciato nei log e nell'audit trail.

#### Sicurezza Token

- **Token 32 byte random** (64 caratteri hex)
- **Solo hash SHA-256 salvato in DB**, mai in chiaro
- **Token usa-e-getta**: eliminato dopo uso o scadenza
- **Rate limiting**: max 3 richieste ogni 15 minuti per IP
- **Nessun segreto in AuditLog**: logging sicuro senza PII

#### DNS & Deliverability

Per produzione, configurare:

- **SPF Record**: Autorizza server SMTP a inviare per il tuo dominio
- **DKIM**: Firma digitale per autenticità email
- **DMARC**: Policy anti-spoofing (opzionale ma raccomandato)

#### Template Email

Template HTML + testo plain minimali inline, senza dipendenze esterne. Facilmente personalizzabili in `apps/api/src/lib/mailer.ts`.

#### Verifica Email Obbligatoria (Opzionale)

Configura `auth.requireEmailVerification = true` in AppConfig per:

- Bloccare login di utenti LOCAL con email non verificata
- Utenti LDAP/OIDC non soggetti a verifica (autenticati esternamente)

### Configurazioni Runtime

Per dettagli su rate-limiting, idempotency, session management, security headers e readiness checks, consulta:

- [OPERATIONS.md](OPERATIONS.md) - Documentazione operativa per SRE/DevOps
- [APP_CONFIG.md](APP_CONFIG.md) - Gestione configurazioni centralizzate

### Configurazioni AppConfig (Overview)

Il sistema utilizza un database centralizzato (29 chiavi) per tutte le configurazioni, eliminando la necessità di file `.env`:

- **Categorie**: Auth, App, Security, Rate Limit, Integrations, On-Demand
- **Cifratura**: AES-256-GCM per segreti sensibili (LDAP, SMTP, Storage)
- **Visualizzazione controllata**: Modalità masked/raw con audit obbligatorio
- **Protezione accesso**: Solo amministratori possono modificare configurazioni
- **Reset automatico**: Form si resettano al cambio di sessione

Per la tabella completa delle chiavi, policy di cifratura e best practices, consulta [APP_CONFIG.md](APP_CONFIG.md).

### Sincronizzazione Utenti

Gli utenti autenticati tramite provider esterni (LDAP oggi, OIDC domani) vengono sincronizzati automaticamente ad ogni login:

- **On-the-fly**: La sincronizzazione avviene a ogni login o creazione dell'utente
- **Campi sincronizzati**: username, password
- **Campi preservati**: email e ruolo, se modificati manualmente, non vengono più sovrascritti dalla sincronizzazione
- **Immutabilità frontend**: I campi sincronizzati non possono essere modificati manualmente dal frontend
- **Nessun job manuale**: Non è presente un job di sincronizzazione manuale; l'aggiornamento è completamente automatico

**Provider supportati:**

- LOCAL: utenti gestiti manualmente, tutti i campi modificabili
- LDAP: campi sincronizzati dal server LDAP
- OIDC (futuro): campi sincronizzati dal provider OIDC

### Protezioni Amministrative

Il sistema include protezioni robuste per la gestione degli utenti:

- **Auto-eliminazione**: Gli admin non possono eliminare o disabilitare il proprio account
- **Ultimo admin**: Non è possibile eliminare o rimuovere il ruolo admin dall'ultimo amministratore del sistema
- **Preservazione modifiche**: Email e ruolo modificati manualmente non vengono sovrascritti dalla sincronizzazione LDAP

## Qualità

- **TypeScript**: Strict mode abilitato
- **Validation**: Zod per runtime type checking
- **Linting**: ESLint + Prettier con Husky pre-commit hooks
- **Security**: helmet, cors, rate limiting
- **Logging**: Pino per structured logging
- **Monitoring**: Audit log per compliance

### Logging Policy

- **Server (API)**: Solo Pino structured logging, nessun `console.*`
- **Redaction automatica**: Campi sensibili (`*password*`, `*token*`, `*secret*`, `*key*`, `authorization`) redatti con `[REDACTED]`
- **Livelli**: `info` (business events), `warn` (anomalie), `error` (fault)
- **Client (Web)**: `debugLog()` condizionale (dev only)
- **PII/Secrets**: Mai loggati in plaintext
- **Enforcement**: ESLint `no-console` attivo in `apps/api`

## Database

- **Sviluppo**: SQLite (file locale)
- **Produzione**: PostgreSQL (Prisma compatibile)
- **Migrations**: Prisma migrate
- **Schema**: Definito in `apps/api/prisma/schema.prisma`

## Workflow

1. **Sviluppo**: `pnpm dev` avvia frontend + backend
2. **Build**: `pnpm build` compila tutto per produzione
3. **Deploy**: CI/CD con Turborepo caching
4. **Monitor**: Audit log + structured logging

## Architecture Decision Records (ADR)

Le decisioni architetturali chiave del progetto sono documentate in ADR:

- [ADR-001: JWT HS256 con HKDF-SHA256](docs/adr/001-jwt-hs256-hkdf.md) - Gestione segreti JWT con derivazione crittografica
- [ADR-002: RBAC Policy e Enforcement](docs/adr/002-rbac-policy.md) - Controllo accessi basato su ruoli
- [ADR-003: Core Package Server-Only Exports](docs/adr/003-core-server-only.md) - Isolamento codice server-only
- [ADR-004: Prisma Select-Only Pattern](docs/adr/004-prisma-select-only.md) - Prevenzione data leakage

Per contribuire al progetto, consulta le ADR per comprendere le convenzioni e i pattern adottati.

## Error UX & User Experience

Il frontend implementa un sistema di gestione errori professionale e coerente:

### Pagine di Sistema

- **404 (Not Found)**: `apps/web/src/app/not-found.tsx`
  - Layout coerente con `PageHeader`, `SectionCard`, `Logo` con aspect-ratio corretto
  - CTA verso `/dashboard` e `/support`
- **Error Runtime**: `apps/web/src/app/error.tsx`
  - Gestisce errori a livello di segment con `ErrorState` e `RetryButton`
  - Integrato con Next.js App Router (`error`, `reset`)
- **Global Error**: `apps/web/src/app/global-error.tsx`
  - Fallback root-level per errori applicativi critici

### Componenti Riusabili

- **`ErrorState`**: Display strutturato di errori con slot personalizzabili
- **`EmptyState`**: Messaggi per dataset vuoti con azioni suggerite
- **`RetryButton`**: Bottone "Riprova" con gestione auto-refresh o callback
- **`ErrorBoundary`**: Class component per wrapping di sezioni critiche

### Best Practices

- **A11y**: Focus management, `aria-label`, `aria-live="polite"`
- **Dark Mode**: Coerente via shadcn/ui design tokens
- **App-wide**: Ogni nuova route eredita automaticamente la UX di errore
- **DRY**: Componenti system riusabili in `apps/web/src/components/system/`
- **Sicurezza**: Mai mostrare stacktrace in produzione, solo messaggi neutri

### Utilizzo ErrorBoundary

```tsx
import { ErrorBoundary } from '../components/system/ErrorBoundary';

export default function CriticalPage() {
  return (
    <ErrorBoundary>
      <YourComponent />
    </ErrorBoundary>
  );
}
```

Pagine già protette: `settings/users`, `settings/config`.

## UI Settings Standard

Il progetto implementa un sistema DRY di componenti riusabili per pagine di configurazione, garantendo UX uniforme e codice pulito.

### Componenti Disponibili

#### SettingsFormShell

Wrapper standardizzato per pagine settings con gestione automatica di loading/error.

```tsx
import { SettingsFormShell } from '@/components/settings/SettingsFormShell';

<SettingsFormShell
  title="Configurazione Mail"
  description="Gestisci l'integrazione SMTP"
  isLoading={isLoading}
  error={error}
>
  {/* Contenuto pagina */}
</SettingsFormShell>;
```

#### SettingsActions

Bottoni azione standardizzati (Save + Test opzionale) con stati loading e accessibilità.

```tsx
import { SettingsActions } from '@/components/settings/SettingsActions';

<SettingsActions
  isSaving={mutation.isPending}
  onTest={handleTest}
  isTesting={testMutation.isPending}
  disabled={!formValid}
/>;
```

#### SensitiveField

Campo password con toggle show/hide per gestione sicura di credenziali.

```tsx
<FormField
  control={form.control}
  name="password"
  render={({ field }) => (
    <SensitiveField
      label="Password SMTP"
      description="Password per autenticazione"
      hasValue={hasPassword}
      placeholder="Inserisci password"
      field={field}
    />
  )}
/>
```

**Caratteristiche:**

- Toggle visibilità con icona Eye/EyeOff
- Placeholder mascherato quando `hasValue=true`
- Mai mostra valori esistenti (sicurezza)
- Integrato con React Hook Form

#### TestStatusBanner

Banner uniforme per risultati test connessione/configurazione.

```tsx
import { TestStatusBanner } from '@/components/settings/TestStatusBanner';

<TestStatusBanner
  status={testStatus} // 'idle' | 'success' | 'error'
  message={testMessage}
/>;
```

**Accessibilità:** `role="status"`, `aria-live="polite"`

#### KeyValueGrid

Grid responsive per layout uniforme di campi form.

```tsx
import { KeyValueGrid } from '@/components/settings/KeyValueGrid';

<KeyValueGrid cols={2}>
  <FormField name="host" ... />
  <FormField name="port" ... />
  <FormField name="username" ... />
  <FormField name="from" ... />
</KeyValueGrid>
```

#### FeatureToggleCard

Card per toggle abilitazione feature (es. LDAP, Mail, Storage).

```tsx
import { FeatureToggleCard } from '@/components/settings/FeatureToggleCard';

<FeatureToggleCard
  title="Abilita LDAP"
  description="Attiva autenticazione enterprise"
  enabled={enabled}
  onToggle={setEnabled}
/>;
```

### Pattern Standard

#### React Hook Form + Zod

Tutte le pagine settings usano RHF con validazione Zod:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { mailSmtpConfigSchema, type MailSmtpConfigInput } from '@luke/core';

const form = useForm<MailSmtpConfigInput>({
  resolver: zodResolver(mailSmtpConfigSchema),
  defaultValues: { ... }
});
```

#### Toast Uniformi

```tsx
// Success
toast.success('Configurazione salvata con successo');

// Error
toast.error('Errore durante il salvataggio', {
  description: error.message,
});
```

#### Gestione Segreti

- Campo sensibile usa `SensitiveField` con `hasValue` flag
- Backend espone `hasPassword: boolean`, mai valori in chiaro
- Payload esclude password se vuota (mantiene esistente)
- Validazione Zod end-to-end

### Pagine Implementate

- **Mail Settings** (`/settings/mail`): Configurazione SMTP con test email
- **LDAP Settings** (`/settings/ldap`): Autenticazione enterprise con test connessione/ricerca

### Schema Zod Centrali

Gli schema di validazione sono in `@luke/core/schemas`:

```tsx
import {
  mailSmtpConfigSchema,
  ldapConfigSchema,
  type MailSmtpConfigInput,
  type LdapConfigInput,
} from '@luke/core';
```

**Vantaggi:**

- Validazione end-to-end (frontend ↔ backend)
- Type-safety completa
- Single source of truth
- DRY: zero duplicazione

## Tecnologie

- **Monorepo**: pnpm workspaces + Turborepo
- **Frontend**: Next.js 15, React 19, shadcn/ui, Tailwind
- **Backend**: Fastify 5, tRPC, Prisma, Zod
- **Database**: SQLite (dev) → PostgreSQL (prod)
- **Auth**: JWT HS256+HKDF, RBAC, LDAP/OIDC
- **Security**: AES-256-GCM, helmet, cors, rate limiting, idempotency
- **Quality**: TypeScript strict, ESLint, Prettier, Husky

## Manutenzione Import

Il progetto include strumenti automatizzati per la pulizia e ottimizzazione degli import:

```bash
# Pulizia automatica import non utilizzati e ordinamento
pnpm -w exec eslint . --ext .ts,.tsx --fix

# Verifica variabili non utilizzate
pnpm typecheck

# Verifica errori lint residui
pnpm lint

# Validazione boundary client/server
npx tsx tools/scripts/validate-client-server-boundaries.ts

# Report import non utilizzati
npx tsx tools/scripts/detect-unused-imports.ts
```

#### Regole Import Applicate

- **Ordinamento**: `builtin` → `external` → `internal` → `parent` → `sibling` → `index` → `type`
- **Rimozione automatica**: Import non utilizzati e variabili non utilizzate
- **Boundary client/server**: Validazione import `@luke/core/server` e moduli `node:`
- **Formattazione**: Prettier per consistenza

## Troubleshooting

### Errori comuni

- **Node version**: Usa `nvm use` per versione corretta
- **pnpm install**: Assicurati di essere nella root del monorepo
- **Build errors**: Controlla che `@luke/core` sia buildato prima degli altri workspace

### Reset completo

```bash
# Rimuovi node_modules e lock files
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm pnpm-lock.yaml

# Reinstalla tutto
pnpm install
```

## Note

- **Master Key**: La prima volta, crea `~/.luke/secret.key` con una chiave AES-256
- **Database**: SQLite file viene creato automaticamente al primo avvio
- **Ports**: Frontend (3000), Backend (3001) - configurabili via AppConfig
- **Caching**: Turborepo cache in `.turbo/` (ignorato da git)
- **Segreti JWT**: Derivati automaticamente dalla master key via HKDF-SHA256 (nessun database)
- **Rotazione Segreti**: Rigenera `~/.luke/secret.key` per invalidare tutti i token
- **Nessun .env**: I segreti non devono mai essere committati in file .env (solo NEXT*PUBLIC*\* se necessario)
- **Export sicuro**: I segreti cifrati nell'export mostrano sempre `[ENCRYPTED]`, mai il plaintext

## Riferimenti Correlati

- [API_SETUP.md](API_SETUP.md) - Setup e utilizzo dell'API con esempi pratici
- [APP_CONFIG.md](APP_CONFIG.md) - Gestione configurazioni centralizzate (AppConfig)
- [OPERATIONS.md](OPERATIONS.md) - Documentazione operativa per SRE/DevOps
- [SETUP_STATUS.md](SETUP_STATUS.md) - Registro tecnico interno e roadmap
- [docs/adr/](docs/adr/) - Architecture Decision Records

---

**Luke** - Enterprise monorepo per applicazioni sicure e scalabili
