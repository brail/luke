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
- **Master Key**:
  - Primario: keytar (keychain OS)
  - Fallback: `~/.luke/secret.key`
- **JWT**: RS256 con chiavi asimmetriche
- **Segreti**: JWT_SECRET e NEXTAUTH_SECRET generati automaticamente e cifrati in AppConfig

### Autenticazione

- **Config-driven**: Local → LDAP → OIDC (configurabile via DB)
- **RBAC**: Role-based access control con `@luke/core`
- **Audit**: Log completo di tutte le mutazioni

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
- **Auth**: JWT RS256, RBAC, LDAP/OIDC
- **Security**: AES-256-GCM, helmet, cors, rate limiting
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
- **Segreti**: JWT_SECRET e NEXTAUTH_SECRET vengono generati automaticamente durante il seed e cifrati in AppConfig
- **Rotazione Segreti**: Aggiorna i valori in AppConfig e riavvia il server per applicare le modifiche
- **Nessun .env**: I segreti non devono mai essere committati in file .env (solo NEXT*PUBLIC*\* se necessario)

---

**Luke** - Enterprise monorepo per applicazioni sicure e scalabili 🚀
