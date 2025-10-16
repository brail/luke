# Luke Monorepo

Monorepo enterprise con pnpm + Turborepo per applicazioni web moderne con focus su sicurezza, audit e qualità.

## 🏗️ Struttura

```
luke/
├── apps/
│   ├── web/          # Next.js 15 + shadcn/ui frontend
│   └── api/          # Fastify 5 + tRPC + Prisma backend
├── packages/
│   └── core/         # Zod schemas, RBAC, utilities condivise
└── [config files]    # pnpm, turbo, typescript, eslint, prettier
```

## 🚀 Quick Start

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

## 📦 Workspaces

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

## 🛠️ Scripts Disponibili

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

## 🏷️ Convenzioni Naming

- **Packages**: `@luke/*` (es. `@luke/web`, `@luke/api`, `@luke/core`)
- **Environment**: `LUKE_*` (es. `LUKE_DB_URL`, `LUKE_JWT_SECRET`)
- **JWT Issuer**: `urn:luke`
- **HTTP Headers**: `x-luke-trace-id` per tracing
- **Git**: Conventional commits

## 🔐 Sicurezza

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
- **Scope**: Server-only, mai esposto via HTTP
- **Rotazione**: Rigenera `~/.luke/secret.key` per invalidare tutti i token
- **Nessun endpoint pubblico**: Segreti mai esposti via API

### Health & Readiness

- **`/healthz`** (Liveness): Processo attivo, event loop responsive
- **`/readyz`** (Readiness): Sistema pronto (DB connesso, segreti disponibili)
- **Fail-fast**: Server termina con exit(1) se segreti non derivabili al boot
- **Kubernetes**: Usa `/healthz` per liveness, `/readyz` per readiness probe

### Autenticazione

- **Config-driven**: Local → LDAP → OIDC (configurabile via DB)
- **RBAC**: Role-based access control con `@luke/core`
- **Guardie middleware**: `withRole()`, `roleIn()`, `adminOnly`, `adminOrEditor`
- **Audit**: Log completo di tutte le mutazioni

### Rate Limiting

- **Due livelli**: Globale (100 req/min) + Critico (10 req/min)
- **Endpoint critici**: `/trpc/users.*`, `/trpc/config.*`, `/trpc/auth.login`
- **Configurabile**: Parametri via AppConfig con fallback hardcoded
- **Dev mode**: Limiti permissivi (1000/100 req/min)

### Idempotency

- **Header**: `Idempotency-Key: <uuid-v4>`
- **Store**: In-memory LRU cache (max 1000 keys, TTL 5min)
- **Scope**: Mutazioni critiche (users, config)
- **Hash**: SHA256(method + path + body) per validazione

### Configurazioni di Autenticazione

**IMPORTANTE: Le configurazioni di autenticazione sono GLOBALI per l'applicazione**

- **Natura globale**: Tutte le configurazioni LDAP e di autenticazione sono salvate con chiavi globali (`auth.*`) nel database
- **Accesso uniforme**: Tutti gli amministratori vedono e modificano le stesse configurazioni di autenticazione
- **Nessuna configurazione per-utente**: Non esistono configurazioni di autenticazione specifiche per singoli utenti
- **Cifratura**: I parametri sensibili (bindDN, bindPassword) sono cifrati con AES-256-GCM
- **Protezione accesso**: Solo gli amministratori possono accedere alle pagine di configurazione (`/settings/*`)
- **Reset automatico**: Al cambio di sessione (logout/login), i form si resettano completamente

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

## 🎯 Qualità

- **TypeScript**: Strict mode abilitato
- **Validation**: Zod per runtime type checking
- **Linting**: ESLint + Prettier con Husky pre-commit hooks
- **Security**: helmet, cors, rate limiting
- **Logging**: Pino per structured logging
- **Monitoring**: Audit log per compliance

## 🗄️ Database

- **Sviluppo**: SQLite (file locale)
- **Produzione**: PostgreSQL (Prisma compatibile)
- **Migrations**: Prisma migrate
- **Schema**: Definito in `apps/api/prisma/schema.prisma`

## 🔄 Workflow

1. **Sviluppo**: `pnpm dev` avvia frontend + backend
2. **Build**: `pnpm build` compila tutto per produzione
3. **Deploy**: CI/CD con Turborepo caching
4. **Monitor**: Audit log + structured logging

## 📚 Tecnologie

- **Monorepo**: pnpm workspaces + Turborepo
- **Frontend**: Next.js 15, React 19, shadcn/ui, Tailwind
- **Backend**: Fastify 5, tRPC, Prisma, Zod
- **Database**: SQLite (dev) → PostgreSQL (prod)
- **Auth**: JWT HS256+HKDF, RBAC, LDAP/OIDC
- **Security**: AES-256-GCM, helmet, cors, rate limiting, idempotency
- **Quality**: TypeScript strict, ESLint, Prettier, Husky

## 🆘 Troubleshooting

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

## 📝 Note

- **Master Key**: La prima volta, crea `~/.luke/secret.key` con una chiave AES-256
- **Database**: SQLite file viene creato automaticamente al primo avvio
- **Ports**: Frontend (3000), Backend (3001) - configurabili via AppConfig
- **Caching**: Turborepo cache in `.turbo/` (ignorato da git)
- **Segreti JWT**: Derivati automaticamente dalla master key via HKDF-SHA256 (nessun database)
- **Rotazione Segreti**: Rigenera `~/.luke/secret.key` per invalidare tutti i token
- **Nessun .env**: I segreti non devono mai essere committati in file .env (solo NEXT*PUBLIC*\* se necessario)
- **Export sicuro**: I segreti cifrati nell'export mostrano sempre `[ENCRYPTED]`, mai il plaintext

---

**Luke** - Enterprise monorepo per applicazioni sicure e scalabili 🚀
