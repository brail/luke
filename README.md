# Luke Monorepo

<!-- luke-docs:start:overview -->
Luke is the internal management platform for the wholesale fashion supply chain. It covers the full season cycle — from the collection plan to pricing, from merchandising to order-portfolio statistics — with native Microsoft Dynamics NAV integration as the reference ERP, and support for the ISO 9001:2015 quality process that governs collection revisions.

It is built as a pnpm + Turborepo monorepo with seven workspaces: a Next.js frontend, a Fastify + tRPC backend, and shared packages for schemas and RBAC, the Prisma schema and client, the NAV sync layer, the Google Calendar integration, and an internal ESLint plugin carrying Luke's own coding rules.
<!-- luke-docs:end:overview -->

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
- [Integrazione NAV](#integrazione-nav-microsoft-dynamics)
- [Manutenzione Import](#manutenzione-import)
- [Troubleshooting](#troubleshooting)
- [Note](#note)
- [Riferimenti Correlati](#riferimenti-correlati)

## Struttura

<!-- luke-docs:start:structure -->
| Workspace | Type | Description |
|-----------|------|-------------|
| [`apps/web`](apps/web/README.md) | App | Next.js frontend — dashboard, collection, pricing, calendar, sales |
| [`apps/api`](apps/api/README.md) | App | Fastify + tRPC + Prisma backend — RBAC API, audit log, NAV integration |
| [`packages/core`](packages/core/README.md) | Package | Zod schemas, RBAC, AppConfigRegistry, storage helpers and server-only crypto |
| [`packages/db`](packages/db/README.md) | Package | Prisma schema, versioned migrations and generated client; `createPrismaClient` |
| [`packages/nav`](packages/nav/README.md) | Package | One-way Microsoft Dynamics NAV → PostgreSQL sync layer (mssql) |
| [`packages/calendar`](packages/calendar/README.md) | Package | Google Calendar integration, milestone sync engine, iCal feed generation |
| [`packages/eslint-plugin-luke`](packages/eslint-plugin-luke/README.md) | Package | Internal ESLint rules (e.g. `no-uncommented-any`, `no-uncommented-tailwind-arbitrary`) |
<!-- luke-docs:end:structure -->

## Quick Start

### Prerequisiti

<!-- luke-docs:start:prerequisites -->
- Node.js and pnpm — the supported ranges are `engines` and `packageManager` in the root `package.json`, which is the only source for them
- Docker — local PostgreSQL, the integration test database, and the S3-compatible storage container
- PostgreSQL — development and production alike; the image is pinned in the `docker-compose.*.yml` files
- An S3-compatible object store — only when `storage.type` is `s3` in AppConfig
- Microsoft SQL Server — only for the NAV sync feature
<!-- luke-docs:end:prerequisites -->

### Setup iniziale

<!-- luke-docs:start:quickstart -->
```bash
# Install dependencies
pnpm install

# Build every workspace
pnpm build

# Seed the database
pnpm db:seed

# Start every workspace in development mode
pnpm dev
```
<!-- luke-docs:end:quickstart -->

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

<!-- luke-docs:start:scripts -->
| Script | Description |
|--------|-------------|
| `pnpm dev` | Starts every workspace in development mode (via Turbo) |
| `pnpm build` | Full build of every workspace |
| `pnpm lint` | Lints every TypeScript file |
| `pnpm typecheck` | Type checks every workspace |
| `pnpm format` | Formats the code with Prettier |
| `pnpm db:seed` | Seeds the database (`apps/api/prisma/seed.ts`) |
| `pnpm test` | Runs every workspace's tests (via Turbo) |
| `pnpm test:integration:local` | Brings the test database up and runs the integration suite |
| `pnpm test:tools` | Tests for the control-plane scripts in `tools/scripts/` |
| `pnpm check:drift` | Runs the blocking skill, documentation, platform, tsconfig, and workflow checks; see the [drift-check contracts](tools/README.md#drift-checks). |
| `pnpm security` | SAST (semgrep) + secrets (gitleaks) + dependencies (osv-scanner) |
| `pnpm release:prepare <tag>` | The only release entry point: validates the tag and writes the `CHANGELOG.md` section |
| `pnpm changelog` | Prints the git-cliff output to **stdout** with no range and no version: a generic preview, **not** the notes `release:prepare` will produce |
| `pnpm changelog:bump` / `changelog:tag` | Rewrite `CHANGELOG.md` with an `## [Unreleased]` section, **with no version and no checks** — never for a release: use `pnpm release:prepare <tag>` |

Workspace-specific commands: `pnpm --filter @luke/web dev` · `pnpm --filter @luke/api dev` · `pnpm --filter @luke/core build`
<!-- luke-docs:end:scripts -->

## Convenzioni Naming

- **Packages**: `@luke/*` (es. `@luke/web`, `@luke/api`, `@luke/core`)
- **Environment**: `LUKE_*` (es. `LUKE_DB_URL`, `LUKE_JWT_SECRET`)
- **JWT Issuer**: `urn:luke`
- **HTTP Headers**: `x-luke-trace-id` per tracing
- **Git**: Conventional commits

## Sicurezza

### Configurazione

- **Config-in-DB**: Tutte le configurazioni applicative (credenziali, segreti, endpoint) vivono in AppConfig (database). I file `.env` sono riservati esclusivamente al bootstrap infrastrutturale — vedi [Policy env var](#policy-env-var)
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
- **Clock tolerance**: ±5 secondi (sufficiente per skew NTP, riduce finestra replay)
- **Domini isolati**:
  - `api.jwt` → JWT API backend
  - `nextauth.secret` → NextAuth web sessions
  - `cookie.secret` → Fastify cookie firmati
- **Scope**: Server-only, mai esposto via HTTP
- **Rotation**: replacing `~/.luke/secret.key` is **not** a supported way to revoke sessions. It does invalidate API JWTs, but the same key also decrypts every `isEncrypted` `AppConfig` row and unwraps every backup's data-encryption key, so replacing it without keeping the original leaves those unreadable. Scope and consequences: [ADR-020](docs/decisions/020-master-key-scope-and-rotation-limits.md). For supported session revocation: [ADR-019](docs/decisions/019-tokenversion-session-revocation.md)
- **Nessun endpoint pubblico**: Segreti mai esposti via API

### Health & Readiness

- **`/livez`** (Liveness): Processo attivo, event loop responsive
- **`/readyz`** (Readiness): Sistema pronto (DB connesso, segreti disponibili)
- **Fail-fast**: Server termina con exit(1) se segreti non derivabili al boot
- **Kubernetes**: Usa `/livez` per liveness, `/readyz` per readiness probe

### Autenticazione

- **Config-driven**: Local → LDAP → OIDC (configurabile via DB)
- **RBAC**: Resource:Action permissions con `@luke/core`
- **Guardie middleware**: `requirePermission('resource:action')` in `apps/api/src/lib/permissions.ts`
- **Audit**: Log completo di tutte le mutazioni

### Security — Session Invalidation & Hardening

#### Architettura JWT Sincronizzata

- **NextAuth JWT**: `maxAge: 8h`, `updateAge: 4h` (refresh automatico ogni 4h)
- **API JWT**: `expiresIn: 8h` (allineato con NextAuth)
- **Cookie Policy**: `httpOnly: true`, `secure: production`, `sameSite: 'lax'`
- **Clock Tolerance**: `±5s`

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

### Policy env var

Luke adotta una separazione netta tra **bootstrap infrastrutturale** e **configurazione applicativa**.

#### Cosa può stare in `.env` — API

| Variabile | Motivo |
|---|---|
| `DATABASE_URL` | Prisma richiede l'URL DB prima del boot |
| `PORT` / `HOST` | Override porta/bind opzionale |
| `NODE_ENV` | Runtime mode — **impostare `development` in locale**, vedi sotto |
| `LUKE_CORS_ALLOWED_ORIGINS` | Override CORS di deploy (non segreto) |
| `OTEL_*`, `LOG_LEVEL` | Observability infra standard |

> **`NODE_ENV=development` va messa a mano in `apps/api/.env`.**
> Lo script dev è `tsx watch --env-file=.env`: nessuno la imposta al posto tuo, e
> `isDevelopment()` confronta esattamente con `'development'`. Senza quella riga
> l'API locale gira con la **postura di produzione** — CSP e HSTS attivi, e
> soprattutto il rate limit a 100 req/min *senza* l'allowList per localhost che
> `server.ts` prevede apposta per lo sviluppo. Il sintomo non è un errore chiaro:
> sono 429 sporadici che nel browser arrivano come "Backend non raggiungibile" e
> nelle suite E2E come login falliti. `apps/api/.env` è gitignored, quindi la riga
> non arriva da sola su una macchina nuova.
> Dettagli: [`docs/quality-hardening-plan.md`](docs/quality-hardening-plan.md) §5.

#### Cosa può stare in `.env` — Web (eccezioni framework)

| Variabile | Motivo |
|---|---|
| `INTERNAL_API_URL` | Next.js rewrites — risolto a build-time, non disponibile a runtime |
| `NEXT_PUBLIC_API_URL` | Baked nel bundle client-side — impossibile venire da DB nel browser |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | Vincolo framework NextAuth — non può leggere da DB |
| `COOKIE_SECURE` | Setting deploy (HTTP vs HTTPS), letto prima del DB |

#### Cosa NON può stare in `.env`

Qualsiasi configurazione applicativa deve vivere in **AppConfig** (database):
credenziali SMTP, bind LDAP, chiavi API, token, `app.baseUrl`, endpoint storage, ecc.

#### Enforcement automatico (API server)

Al boot, `assertEnvPolicy()` in `server.ts` verifica che nessuna variabile vietata sia presente.
Pattern bloccati: `SMTP_*`, `LDAP_*`, `JWT_*`, `NEXTAUTH_*`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`.

- **Produzione**: `exit(1)` — il server non parte
- **Sviluppo**: warning esplicito in console

### Configurazioni Runtime

Per dettagli su rate-limiting, idempotency, session management, security headers e readiness checks, consulta:

- [OPERATIONS.md](OPERATIONS.md) - Documentazione operativa per SRE/DevOps

### Configurazioni AppConfig (Overview)

Il sistema utilizza un database centralizzato per tutte le configurazioni sensibili:

- **Categorie**: Auth, App, Security, Rate Limit, Integrations, On-Demand
- **Cifratura**: AES-256-GCM per segreti sensibili (LDAP, SMTP, Storage)
- **Visualizzazione controllata**: Modalità masked/raw con audit obbligatorio
- **Protezione accesso**: Solo amministratori possono modificare configurazioni
- **Reset automatico**: Form si resettano al cambio di sessione

Registered keys and their validation schemas are defined in
[AppConfigRegistry](packages/core/src/schemas/config.ts). See
[ADR-018](docs/decisions/018-runtime-configuration-and-bootstrap-environment.md)
for the runtime-configuration and bootstrap-environment decision, and
[Password policy](OPERATIONS.md#password-policy) for storage and fallback behavior.

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

- **Sviluppo e Produzione**: PostgreSQL 16 (via Prisma ORM)
- **Migrations**: Prisma migrate (`prisma migrate deploy` in produzione, workflow Docker su porta 5433 per generazione)
- **Schema**: Definito in `packages/db/prisma/*.prisma` (multi-file per dominio, workspace `@luke/db`)

## Workflow

<!-- luke-docs:start:deployment -->
The release flow is triggered by pushing a `vX.Y.Z` tag. A provenance gate proves the tag may publish from the line it was cut on, then GitHub Actions builds the Docker images and publishes them to `ghcr.io`; Portainer picks the new images up and redeploys the stack. Release-candidate artifacts come from the release train and publish `rc-latest`, stable artifacts come from `main` and publish `latest` plus the `X.Y` series tag. A push to a branch runs CI only — no image is ever built outside a tag.

The `luke_api_data` volume holds the master key (`~/.luke/secret.key`) and must never be deleted. In production, `entrypoint.sh` runs `prisma migrate deploy` before the server starts.
<!-- luke-docs:end:deployment -->

## Architecture Decision Records (ADR)

<!-- luke-docs:start:adr-link -->
Relevant architectural decisions are documented in [`docs/decisions/`](docs/decisions/README.md).
<!-- luke-docs:end:adr-link -->

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

Gli schema di validazione vivono in `packages/core/src/schemas/` e si importano
dal barrel `@luke/core`: il package pubblica solo `.`, `./server` e
`./utils/date`, quindi `@luke/core/schemas` non è un specifier importabile.

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

<!-- luke-docs:start:architecture -->
Luke is a pnpm + Turborepo monorepo with seven workspaces. The backend (`apps/api`) exposes type-safe tRPC APIs on Fastify, over PostgreSQL through Prisma, with granular `resource:action` RBAC. The frontend (`apps/web`) is a Next.js App Router application built on shadcn/ui and React, and it consumes the API's router types end to end — a contract change fails the type check instead of reaching runtime. Microsoft Dynamics NAV synchronisation lives in `packages/nav` (direct mssql, one-way NAV → Luke). Season milestones are handled by `packages/calendar`, which syncs them to Google Calendar and generates the iCal feed.

Runtime configuration is not spread across environment variables: `.env` carries infrastructural bootstrap only, and everything else lives in the `AppConfig` table behind the registry in `@luke/core`.

The versions this stack currently sits on are read from the workspace manifests, never restated here. For the key architectural decisions: [`docs/decisions/`](docs/decisions/README.md).
<!-- luke-docs:end:architecture -->

## Manutenzione Import

Il progetto include strumenti automatizzati per la pulizia e ottimizzazione degli import:

```bash
# Pulizia automatica import non utilizzati e ordinamento
pnpm -w exec eslint . --ext .ts,.tsx --fix

# Verifica variabili non utilizzate
pnpm typecheck

# Verifica errori lint residui
pnpm lint
```

#### Regole Import Applicate

- **Ordinamento**: `builtin` → `external` → `internal` → `parent` → `sibling` → `index` → `type`
- **Rimozione automatica**: `eslint --fix` (`@typescript-eslint/no-unused-vars`)
- **Boundary client/server**: `@luke/core/server` è importabile in `apps/web` solo da `WEB_SERVER_ENTRYPOINT_IMPORTERS` (`eslint.config.mjs`), in ogni forma di riferimento statico (`@luke/no-restricted-module-references`)
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
- **Database**: PostgreSQL 16 — connessione via `DATABASE_URL` in `.env`
- **Ports**: Frontend (3000), Backend (3001) - configurabili via AppConfig
- **Caching**: Turborepo cache in `.turbo/` (ignorato da git)
- **Segreti JWT**: Derivati automaticamente dalla master key via HKDF-SHA256 (nessun database)
- **Secret rotation**: replacing `~/.luke/secret.key` is **not** a supported revocation procedure — it also leaves encrypted `AppConfig` rows and existing backups unreadable unless the original key is kept. See [ADR-020](docs/decisions/020-master-key-scope-and-rotation-limits.md)
- **Nessun .env**: I segreti non devono mai essere committati in file .env (solo NEXT*PUBLIC*\* se necessario)
- **Export sicuro**: I segreti cifrati nell'export mostrano sempre `[ENCRYPTED]`, mai il plaintext

## Integrazione NAV (Microsoft Dynamics)

Il pacchetto `@luke/nav` gestisce la sincronizzazione bidirezionale con Microsoft Dynamics NAV via connessione diretta SQL Server (mssql).

### Entità sincronizzate

| Entità | Tabella NAV | Replica locale | Entità interna | Sync |
|--------|-------------|----------------|----------------|------|
| Vendor | `[COMPANY$Vendor]` | `nav_vendors` | `vendors` | Differenziale (watermark) |
| Brand | `[COMPANY$Brand]` | `nav_brands` | `brands` | Full sync |
| Season | `[COMPANY$Season]` | `nav_seasons` | `seasons` | Full sync |

### Pattern architetturale

- **Entità duale**: tabella `nav_*` (replica fedele) + tabella locale (anagrafica arricchita)
- **Soft delete**: `isActive=false`, mai hard delete — il sync NAV non tocca mai `isActive`
- **Guard logic**: se un record locale esiste senza NAV link, il sync non lo sovrascrive
- **Filtri configurabili**: whitelist/exclude/all per entità, con scheduling automatico

Per dettagli completi, vedi [docs/nav-integration.md](docs/nav-integration.md).

## Storage

Il sistema storage è astratto tramite l'interfaccia `IStorageProvider` con due provider supportati: filesystem locale e S3-compatible (nello stack Docker: SeaweedFS; l'implementazione usa solo l'API S3 generica, quindi qualsiasi backend S3-compatible funziona — MinIO, Ceph RGW, ecc.). Il provider attivo è selezionato da `storage.type` in AppConfig — nessuna env var, nessuna ricompilazione.

### Chiavi nel database, non URL

I modelli salvano la **chiave** del file (`logoKey`, `pictureKey`, `key`), non l'URL completo. L'URL pubblico viene calcolato a runtime tramite `makeUrlResolver(prisma)`. Cambiare provider o configurazione non richiede migrazioni dati.

### Two-Phase Upload

Il file viene caricato come **pending** (`FileObject.confirmedAt = null`) prima che l'entità esista. La conferma avviene nella stessa transaction Prisma che crea l'entità. File pending abbandonati vengono rimossi dal job di cleanup periodico.

```
1. POST /upload/{bucket}  →  FileObject (confirmedAt = null) + publicUrl + fileObjectId
2. trpc.brand.create({ ..., fileObjectId })
   └─ tx: Brand.create + FileObject.confirmedAt = now + Brand.logoKey = file.key
```

### Provider URL

Con **S3**: le immagini sono servite tramite la route Next.js autenticata `/api/uploads/[...path]`. I bucket rimangono privati.

Con **local** (`enableProxy=true`, default): stesso proxy per consistenza. Con `enableProxy=false`: URL pubblico diretto via `publicBaseUrl`.

### Configurazione (AppConfig)

| Chiave | Descrizione |
|--------|-------------|
| `storage.type` | `local` \| `s3` |
| `storage.local.basePath` | Directory base locale (default `/data/uploads`) |
| `storage.local.enableProxy` | Forza proxy URL (default `true`) |
| `storage.local.publicBaseUrl` | Base URL pubblico se proxy disabilitato |
| `storage.s3.endpoint` | Endpoint storage S3-compatible (es. `seaweedfs:8333`) |
| `storage.s3.accessKey` / `secretKey` | Credenziali S3 (cifrate in DB) |
| `storage.s3.publicBaseUrl` | Base URL pubblico per i bucket pubblici |
| `storage.s3.presignedPutTtl` / `presignedGetTtl` | TTL URL presigned in secondi |

### Bucket validi

`uploads`, `exports`, `assets`, `brand-logos`, `collection-row-pictures`, `merchandising-specsheet-images`

Per l'architettura completa: [docs/decisions/007-storage-layer-refactor.md](docs/decisions/007-storage-layer-refactor.md)

## Dashboard Widget System

La dashboard è un sistema di widget card configurabili per utente. Ogni utente può abilitare/disabilitare i widget e, per quelli configurabili, personalizzare i settings tramite il pannello "Personalizza".

### Widget disponibili (v1)

| ID | Label | Fonte dati | Configurabile |
|----|-------|-----------|---------------|
| `kpi-stats` | Statistiche | Prisma (brand, season, utenti attivi, righe collezione) | No |
| `season-progress` | Avanzamento stagione | Prisma (`CollectionLayout` KPI) | No |
| `clocks` | Orologi mondo | `Intl.DateTimeFormat` (nessuna API) | Sì (fusi orari IANA) |
| `forex` | Cambi valuta | `api.frankfurter.app` (BCE, gratuito, no API key) | Sì (coppie valuta) |
| `weekly-sales` | Ordini settimanali | NAV replica (`nav_pf_sales_header`) | No |
| `tasks` | Attività personali | Prisma (`DashboardTask`) | No |

### Aggiungere un nuovo widget

1. **Core schema** — aggiungere l'ID in `WIDGET_IDS` (`packages/core/src/schemas/dashboard.ts`)
2. **Componente** — creare `apps/web/src/components/dashboard/widgets/MyWidget.tsx`
3. **Registry** — aggiungere `WidgetDefinition` in `apps/web/src/components/dashboard/widgetRegistry.ts`)
4. **Router** (se serve dati) — aggiungere procedure in `apps/api/src/routers/dashboard.ts`

### Schema configurazione JSON

```json
{
  "widgets": [
    { "id": "forex", "enabled": true, "position": 4, "settings": { "pairs": ["EUR/CNY", "EUR/USD"] } },
    { "id": "clocks", "enabled": true, "position": 5, "settings": { "timezones": ["Europe/Rome", "Asia/Shanghai"] } },
    { "id": "kpi-stats", "enabled": false, "position": 0 }
  ]
}
```

### Variabili d'ambiente

Nessuna variabile aggiuntiva richiesta. Il widget Forex usa `api.frankfurter.app` (dati BCE, gratuito).

---

## Riferimenti Correlati

- [Documentation index](docs/README.md) - Task-oriented entry point for architecture, runbooks, reference material, work items, and historical evidence
- [Engineering rules](CLAUDE.md) - Operational and architectural rules for repository changes
- [Agent instructions](AGENTS.md) - Codex instructions; Claude Code is governed by `CLAUDE.md`
- [Changelog](CHANGELOG.md) - Release notes derived from Conventional Commits
- [Repository tooling](tools/README.md) - Deterministic checks, release gates, one codemod, and historical reports
- [API documentation](apps/api/README.md) - API reference, LDAP resilience and local tracing
- [OPERATIONS.md](OPERATIONS.md) - Documentazione operativa per SRE/DevOps
- [Archived setup snapshot](docs/archive/SETUP_STATUS.md) - Historical setup and roadmap; not current operating guidance
- [docs/nav-integration.md](docs/nav-integration.md) - Architettura integrazione NAV
- [docs/collection-layout-versioning.md](docs/collection-layout-versioning.md) - Collection Layout Versioning — registro qualità ISO 9001:2015 per le revisioni del piano di collezione
- [docs/storage-immutable-bucket.md](docs/storage-immutable-bucket.md) - Bucket immutabile per le foto delle revisioni
- [Architecture Decision Records](docs/decisions/README.md) - Canonical decision index with status and supersession links

## Release

<!-- luke-docs:start:release -->
The project uses [Conventional Commits](https://www.conventionalcommits.org/) to generate the CHANGELOG automatically through `git-cliff`. Commit messages are validated by the `.husky/commit-msg` hook (commitlint).

Tag naming: `vX.Y.Z` (stable) or `vX.Y.Z-rc.N` (release candidate) — SemVer criteria: `patch` for a fix or refactor, `minor` for new functionality, `major` for a breaking change to a supported compatibility contract.

**The git tag is the release identity.** No manifest declares a version: there is no second number to keep aligned with the tag, and none to drift.

**`pnpm release:prepare <tag>` is the only supported entry point**: you name the version. The script refreshes the tags and `origin/main` itself and stops if it cannot, then `tools/scripts/check-release-train.ts --validate` proves the tag **before anything is written**; only afterwards does it generate the CHANGELOG section over the validated range and re-check the result with `check-release-tree.ts --worktree`. **`CHANGELOG.md` is the only file it writes.**

The validator starts from the highest stable tag **reachable from HEAD** and uses the range `base..HEAD` — a set difference on the commit graph, not a walk in date order. It refuses a tag that already exists, a base that is not reachable, a stable hotfix on another line that outranks that base (merge it first), a target other than the open train's frozen one, an rc counter that skips, a range with nothing releasable in it, and **any version below the minimum bump** git-cliff computes for the commits since the base: equal or higher passes, and there is no flag to bypass it.

`changelog:bump` and `changelog:tag` remain installed but **must not be used**: they write an `## [Unreleased]` heading, which the checker refuses anywhere in a release tree. If you ran one by mistake: read `git diff CHANGELOG.md`, remove by hand only the `## [Unreleased]` section the command prepended, keep every change that was already there, and do not run `release:prepare` on top of that output. Never restore the whole file (`checkout`/`restore`/`reset`): that would throw away the pre-existing work too.

```bash
pnpm release:prepare v3.0.0-rc.1  # First candidate (does not commit or tag)
pnpm release:prepare v3.0.0-rc.2  # Next candidate on the same train
pnpm release:prepare v3.0.0       # Promote the train to its stable version
pnpm release:prepare v3.0.1       # Hotfix on the stable line
# git-cliff with no range: generic stdout preview, not the release notes
pnpm changelog
```

`.github/workflows/release.yml` is authoritative: immediately after the provenance gate, the same job runs `tools/scripts/check-release-tree.ts` against the exact commit the gate resolved and verifies that **that tree** has exactly one `## [X.Y.Z]` section in `CHANGELOG.md` for the tag's version, with at least one `- ` entry. If it fails, `verify` and both image-build jobs do not start, and no image is published.

This check is deliberately narrow: it proves that the tagged tree ships notes for its own tag, not that a release was prepared. `check-release-train.ts --validate` proves the **number** during preparation; the provenance gate proves the **line**.

`.husky/pre-push` runs the same checker against the object being pushed: it is **early feedback, not enforcement** — `--no-verify` skips it, and another clone may not have it.

Notes are generated only from Conventional Commits: merge commits (`Merge pull request …`, `Merge branch …`) are excluded. A candidate whose only new commits are merges is therefore rejected by the validator during preparation — the range contains nothing releasable — before any write starts. The empty-section rejection in `check-release-tree.ts` is not what stops it; that remains a backstop for an empty section reaching the release tree by another route. This is the intended behaviour.
<!-- luke-docs:end:release -->

---

**Luke** - Enterprise monorepo per applicazioni sicure e scalabili
