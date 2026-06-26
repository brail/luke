# Luke Project — Claude Rules

# /Users/brail/code/cursor/luke/CLAUDE.md

## Monorepo Structure

```
apps/
  web/          → Next.js 15 + shadcn/ui (frontend, porta 3000)
  api/          → Fastify 5 + tRPC + Prisma (backend, porta 3001)
packages/
  core/         → @luke/core: schemas, RBAC, pricing, storage, crypto, URL utils
  nav/          → @luke/nav: NAV sync layer (mssql pool, sync modules)
  eslint-plugin-luke/ → @luke/eslint-plugin-luke: custom ESLint rules
```

Dev: `pnpm dev` avvia tutto via Turbo.
Se API fallisce con "Cannot find module @luke/core/dist": `pnpm --filter @luke/core build` prima.
Turbo cache può essere stale — se i dist mancano, build manuale.

---

## Stack Constraints

- **Package manager**: pnpm only — mai npm o yarn
- **Monorepo commands**: `pnpm --filter <app> <script>` dalla root, o cd nel package
- **ORM**: Prisma — raw SQL solo in `packages/nav/src/` (mai in application logic)
- **API layer**: tRPC per tutte le route dashboard/UI; Prisma diretto per AI agent queries
- **Validation**: schemi Zod da `@luke/core` — mai ridefinire inline
- **TypeScript**: strict mode — no `any`, no type assertion senza commento esplicativo
- **URLs in frontend**: mai hardcode `localhost:3001` in `apps/web/src` — usare
  `buildApiUrl()`, `buildTrpcUrl()` da `@luke/core/net/url`.
  ESLint rule `@luke/no-hardcoded-url` lo enforcea automaticamente.

---

## @luke/core — Schema Catalog

Prima di scrivere qualsiasi schema Zod, verificare se esiste già qui.

`userSchema`, `userProfileSchema` — identità utente
`ldapConfigSchema`, `ldapConfigResponseSchema` — LDAP (password omessa nella response)
`navConfigSchema`, `navConfigResponseSchema` — NAV SQL Server
`brandSchema`, `seasonSchema`, `vendorSchema` — master data
`pricingParameterSetInputSchema`, `pricingCalculateInputSchema` — pricing engine
`collectionLayoutRowInputSchema`, `collectionGroupInputSchema` — collection domain
`appConfigSchema`, `AppConfigRegistry` — config KV system
`sectionEnum`, `SECTION_TO_PERMISSION`, `SECTION_ACCESS_DEFAULTS` — navigation/access
`rbacSchema` — RBAC definitions
`authSchemas` — password reset, email verification
`mailSchema` — SMTP configuration
`RateLimitConfigSchema`, `LdapResilienceSchema` — infra config

---

## AppConfig System

Tutta la configurazione runtime vive nella tabella `AppConfig` (Postgres KV).
`AppConfigRegistry` in `packages/core/src/schemas/config.ts` è la **single source of truth**.

- **Mai `process.env.*` nel codice applicativo** — usare `getConfigValue(prisma, key)` o
  il tRPC config router. Le env var sono solo per bootstrap (URL, NODE_ENV).
- **Ogni nuova chiave config va aggiunta a `AppConfigRegistry`** con il suo schema Zod.
- Valori in DB sempre come stringhe — usare `z.coerce.*` per numeri/boolean,
  `.transform(s => JSON.parse(s))` per JSON blob.
- Valori sensitivi (password, secret) letti con `decrypt: true` in `getConfig()`.
- `CRITICAL_CONFIG_KEYS`: solo `auth.strategy` attualmente. Aggiungere solo se l'assenza
  deve bloccare il boot.

---

## Auth & Crypto — NON TOCCARE senza richiesta esplicita

- Master key: `~/.luke/secret.key` (32 bytes, mode 0600) — auto-generata al primo avvio
- Segreti derivati via HKDF-SHA256: `nextauth.secret`, `api.jwt`, `cookie.secret`
- Crypto utilities **server-only** — importare sempre da `@luke/core/server`,
  mai da `@luke/core` (lancia eccezione se importato nel browser)
- `packages/core/src/crypto/secrets.server.ts` — non modificare senza commento
  che spiega l'intent di sicurezza

---

## RBAC & Section Access

Due layer distinti che devono restare in sync.

### Layer 1 — Resource:Action permissions

Definito staticamente in `packages/core/src/auth/permissions.ts`.

- Ruoli: `admin` (`*:*`), `editor`, `viewer`
- Usare sempre `hasPermission(user, 'resource:action')` — mai `user.role === 'admin'` inline
- Ogni endpoint tRPC protetto: `requirePermission('entity:action')` obbligatorio

### Layer 2 — Section visibility (dot-notation)

`product.pricing`, `settings.ldap`, `admin.vendors` ecc.
Accesso valutato da `effectiveSectionAccess()` con precedenza a 4 livelli:
kill switch → override utente → AppConfig role defaults → RBAC fallback

**Aggiungere una nuova sezione richiede aggiornare TRE posti in sync:**

1. `sectionEnum` — aggiungere la chiave
2. `SECTION_TO_PERMISSION` — mappare a `resource:action`
3. `SECTION_ACCESS_DEFAULTS` — impostare `true/false` per tutti e tre i ruoli

`SECTION_ACCESS_DEFAULTS` è intenzionalmente statico (version-controlled).
Override runtime per-ruolo vivono in AppConfig (`rbac.sectionAccessDefaults`).
Chiamare sempre `invalidateRbacCache()` dopo write su chiavi RBAC in AppConfig.

---

## LDAP Authentication

Quattro strategie via `auth.strategy` in AppConfig:
`local-first` | `ldap-first` | `local-only` | `ldap-only`

- Mai hardcodare la strategia auth — sempre leggere da AppConfig
- Circuit breaker attivo: `breakerFailureThreshold` fallimenti consecutivi → apre il circuito
  per `breakerCooldownMs` ms. Non bypassare il resilience wrapper.
- `roleMapping`: JSON string che mappa gruppi LDAP → ruoli Luke

---

## Pricing Engine

Tre modalità in `PricingModeSchema`: `forward` | `inverse` | `margin`

- **Write riservato ad admin** — `pricing:update` non è nel ruolo editor (solo `pricing:read`)
  Mai esporre mutation di parameter set al ruolo editor.
- `PricingParameterSetInputSchema` definisce tutti i campi — non aggiungere campi pricing fuori
- Calcoli sempre scoped a `brandId` + `seasonId`
- Valute supportate: `USD`, `EUR`, `GBP`, `CHF`, `CNY` (da `PRICING_CURRENCIES`) — non aggiungerne
  altre senza aggiornare la costante

---

## Collection Layout

Modello a due livelli: **Groups** contengono **Rows**. Entrambi hanno ordering indipendente.

- Max `COLLECTION_COLUMNS_MAX_VISIBLE` (7) colonne visibili simultaneamente
- Sempre visibili: `#`, `line`, `skuForecast`, `actions`
- Default nascoste: `gender`, `designer`, `styleStatus`
- Usare sempre gli enum definiti — mai stringhe libere:
  - `COLLECTION_GENDER`: `MAN` | `WOMAN`
  - `COLLECTION_STRATEGY`: `CORE` | `INNOVATION`
  - `COLLECTION_STATUS`: `CARRY_OVER` | `NEW`
  - `COLLECTION_PROGRESS`: `01 - FASE DI DESIGN` → `06 - SMS LANCIATI` (ordinamento fisso)
- `skuBudget` appartiene al Group, `skuForecast` alla Row — non invertire
- Upload foto: `buildCollectionRowPictureUploadUrl(rowId)` — mai costruire path manualmente

---

## Storage Layer

`IStorageProvider` è un'interfaccia intenzionale per supportare futuri provider (local/samba/gdrive).

- Mai file handling fuori da un'implementazione `IStorageProvider`
- Bucket validi: `uploads`, `exports`, `assets`, `brand-logos`, `temp-brand-logos`,
  `collection-row-pictures`, `temp-collection-row-pictures`
  — mai aggiungere bucket senza aggiornare `localStorageConfigSchema`
- Usare sempre le builder functions — mai costruire path `/upload/...` a mano
- `enableProxy`: non hardcodare true/false — leggere da config

---

## NAV / packages/nav

Per dettagli su tabelle NAV e decisioni sync: `docs/nav-architecture.md`

- Table names: sempre `[${sanitizeCompany(config.company)}$TableName]` — non parametrizzabili
- `packages/nav` NON importa da `apps/api` — config injettata via `GetConfigFn`
- Nuovi sync module: `buildNavSyncFilter` + `buildWhereClause` + `processInBatches`
  da `sync/utils.ts`, batch 100, `request.timeout = 60_000`
- Wrap NAV replica + local upsert in `prisma.$transaction()`
- Mai auto-riattivare entità soft-deleted durante sync
- Sync aggiorna SOLO campi provenienti da NAV (tipicamente `name`) — mai `isActive` né campi arricchiti
- Nuove query/tipi: `packages/nav/src/queries/` e `packages/nav/src/types/`
- `Brand.code` max 20 chars, `Season.code` max 10 chars (allineato a NAV nvarchar)
- DAB: solo bridge LLM→NAV, non per il sync layer

---

## Frontend — apps/web

### shadcn/ui strict

- Solo componenti shadcn/ui — mai import Radix diretti, mai MUI
- Nuovi componenti sempre via CLI: `pnpm dlx shadcn@latest add <component>`
- Tailwind utility classes only — no `style={{}}`, no CSS modules
- Colori via CSS variables: `--background`, `--foreground`, `--primary`, `--muted`, ecc.
  Mai valori hex/rgb hardcodati
- className sempre via `cn()` da `lib/utils` — mai concatenazione di stringhe
- Varianti multiple → CVA (class-variance-authority)
- Arbitrary Tailwind values (`w-[327px]`) solo con commento che giustifica

### UI Patterns obbligatori

**Permission-aware UI** (uniforme su tutte le pagine):

- Creation buttons: `<CreateActionButton>` — sempre visibile, disabled + tooltip se no permesso
- Table actions: Modifica/Elimina sempre visibili, disabled + tooltip se no permesso
- Disabled style: `className="opacity-50 cursor-not-allowed"` + `<TooltipProvider><Tooltip>`
- Tooltip message: "Non hai i permessi per [azione] [risorsa]"
- Config pages (mail, storage, LDAP): save button gated con `can('config:update')`

**Delete confirmation**: SEMPRE `<ConfirmDialog>` da `components/ConfirmDialog.tsx`
Mai `globalThis.confirm()` — rimosso completamente.

**Permission hooks**:

- Boolean props: `canCreate`, `canUpdate`, `canDelete`, `canList` — NO parentesi (non funzioni)
- Function methods: `canEdit()`, `isReadOnly()`, `isAdmin()`, `isAdminOrEditor()` — SI parentesi
- Hook: `can()`, `canAll()`, `canAny()` da `usePermission`

**Error handling**: usare `getTrpcErrorMessage(error, entityOverrides?)` da `lib/trpcErrorMessages.ts`

**i18n (futuro)**: non bloccare il lavoro attuale, ma evitare stringhe hardcoded in componenti
profondi senza possibilità di estrazione. Tenere presente su date, numeri, stringhe UI.

---

## Development Patterns — Regole Obbligatorie

### 1. `$transaction` per ogni write multi-tabella

Upsert su 2+ tabelle correlate → sempre `prisma.$transaction(async tx => { ... })`.
Senza transaction: se il secondo upsert fallisce, il primo è già committato — dati inconsistenti.

### 2. try/catch individuale nei sync batch

In `syncAll()` e simili, ogni `await syncXxx()` ha il suo try/catch.
Un errore in un'entità non deve bloccare le altre.

### 3. `$transaction` per check-then-act

Pattern "leggi → valida → scrivi" sempre in transaction per evitare race condition.

### 4. Audit logging su ogni mutation

Ogni create/update/delete/restore/unlink deve avere `withAuditLog` middleware
o chiamata esplicita `logAudit()`. Senza audit trail: compliance issue.

### 5. `requirePermission()` su ogni endpoint protetto

READ → `entity:read`, CREATE → `entity:create`, UPDATE → `entity:update`,
DELETE → `entity:delete`. Mai usare `update` per query read-only.

### 6. `onDelete` esplicito su ogni `@relation` Prisma

Mai lasciare che Prisma inferisca il cascade. Default sicuro: `onDelete: Restrict`.
`onDelete: Cascade` solo se intenzionale e commentato.

### 7. Mai duplicare schema/tipi

Se uno schema Zod esiste in `@luke/core`, importarlo da lì. Mai ridefinire localmente.

### 8. Indici su FK e colonne filtrate

Ogni FK e ogni colonna usata in WHERE (`isActive`, `vendorId`, ecc.) → `@@index([campo])`.

### 9. Allineamento versioni dependency nel monorepo

Dopo ogni upgrade di una dependency, verificare che la stessa versione sia usata
in tutti i `package.json` del workspace.

### 10. Mai `console.*`

API: `logger.info/warn/error()` (Pino). Web: `debugLog/debugWarn/debugError` da `lib/debug.ts`.

### 11. Query context-dependent: params espliciti, mai lettura server-side

Ogni procedura tRPC che dipende da brand/season corrente DEVE ricevere `brandId` e `seasonId`
come input espliciti (schema Zod), NON leggerli da `userPreference` server-side.

Il frontend li passa da `useAppContext()` con `enabled: !!brand?.id && !!season?.id`.
Questo garantisce che React Query veda il key-change al cambio contesto → refetch automatico.

```typescript
// ❌ MAI
protectedProcedure.query(async ({ ctx }) => {
  const { lastBrandId } = await getUserPrefContext(userId, ctx.prisma); // legge DB
})

// ✅ SEMPRE
protectedProcedure
  .input(z.object({ brandId: z.string(), seasonId: z.string() }))
  .query(async ({ ctx, input }) => { ... })
```

Pattern di riferimento: `pricing.parameterSets.list`, `collectionLayout.get`,
`sales.statistics.portafoglio.getFilters`.

### Soft delete pattern

- `remove()`: `isActive=false` — mai hard delete
- `restore()`: `isActive=true`
- `list()`: filtra `isActive=true` default; `includeInactive=true` per admin
- Riga inattiva in tabella: `className={!item.isActive ? 'opacity-50' : undefined}`

---

## Env Policy — Regola Architetturale Ferma

`.env` ammette SOLO bootstrap infrastrutturale. Tutto il resto va in AppConfig.

**Ammesso in `.env` API**: `DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`,
`LUKE_CORS_ALLOWED_ORIGINS`, `OTEL_*`, `LOG_LEVEL`

**Ammesso in `.env` Web** (eccezioni framework): `INTERNAL_API_URL`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FRONTEND_URL`, `NEXTAUTH_URL`,
`NEXTAUTH_SECRET`, `COOKIE_SECURE`

**Vietato in `.env`**: credenziali SMTP, LDAP, storage, token, password applicative.

Enforcement automatico: `assertEnvPolicy()` in `apps/api/src/server.ts`
blocca il boot in produzione se trova pattern vietati (`SMTP_*`, `LDAP_*`, `JWT_*`,
`*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`).

---

## ESLint Import Order

Import ordinati alfabeticamente all'interno dei gruppi, blank line tra gruppi.

**Ordine gruppi:**

1. Builtin + External (uniti, NO blank line tra loro, alfabetico)
2. _(blank line)_
3. Internal (path relativi: components, contexts, hooks, lib, ecc.)

```tsx
// ✅ CORRETTO
import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '../../../../components/PageHeader';
import { cn } from '../../../../lib/utils';
```

---

## Prisma Migration Workflow

Ogni modifica a `apps/api/prisma/schema.prisma` richiede migration. Workflow obbligatorio:

```bash
# 1. Postgres temporaneo su porta 5433
docker run --rm -d --name luke-pg-migrate -p 5433:5432 \
  -e POSTGRES_DB=luke -e POSTGRES_USER=luke -e POSTGRES_PASSWORD=luke \
  postgres:16-alpine
sleep 4 && docker exec luke-pg-migrate pg_isready -U luke -d luke

# 2. Genera migration
cd apps/api
DATABASE_URL="postgresql://luke:luke@localhost:5433/luke" \
  pnpm exec prisma migrate dev --name <nome_descrittivo> --skip-seed

# 3. Stop container
docker stop luke-pg-migrate

# 4. Applica al DB dev (porta 5432)
cd apps/api && npx prisma db push

# 5. Committa il file migration insieme alle modifiche allo schema
```

In produzione: `entrypoint.sh` esegue `prisma migrate deploy`.
Mai `prisma migrate reset` in produzione.

---

## Versioning & Release

**SemVer criteri:**

- `patch`: fix, refactor, chore, cleanup, dependency alignment, migration senza nuove feature
- `minor`: nuova funzionalità visibile all'utente (endpoint, pagina, capability)
- `major`: breaking change su API/contratti (rimozione endpoint, cambio shape response)

**Workflow obbligatorio prima di ogni `git tag vX.Y.Z`:**

1. Bump tutti i `package.json` del monorepo a X.Y.Z
2. Commit `"chore: bump version to X.Y.Z"`
3. `git tag vX.Y.Z && git push origin vX.Y.Z`

**Release flow:**

- Push su `main` → solo CI (lint + typecheck), nessuna immagine
- Tag `vX.Y.Z` → build Docker images → push su `ghcr.io` → Portainer pull & redeploy
- **MAI cancellare `luke_api_data` volume** — la master key vive lì

Per il processo completo: `docs/release-process.md`

---

## Before Making Changes

1. Elenca i file che intendi modificare
2. Spiega l'approccio e perché
3. Attendi conferma se tocchi più di 3 file o uno qualsiasi tra:
   crypto/auth, RBAC/section definitions, AppConfigRegistry, pricing logic,
   schema.prisma, release workflow
4. **Mai `git commit` senza esplicita approvazione** — mostra il diff, chiedi conferma,
   aspetta il via libera, poi committa

## Lessons Log

Quando vieni corretto su qualcosa, aggiungi immediatamente una regola in `lessons.md`.

## Commit Conventions — Conventional Commits

Ogni commit segue [Conventional Commits](https://www.conventionalcommits.org/) per alimentare il CHANGELOG automatico via `git-cliff`.

**Format**: `<type>(<scope>)?: <description>`

**Types ammessi**:

- `feat` — nuova funzionalità (minor bump)
- `fix` — bugfix (patch bump)
- `docs` — solo documentazione
- `style` — formattazione, no cambio logico (skip dal changelog)
- `refactor` — refactor senza nuove feature o fix
- `perf` — ottimizzazione performance
- `test` — aggiunta/modifica test
- `chore` — maintenance, deps, build, release
- `ci` — CI/CD changes

**Breaking change**: appendere `!` dopo il type (es. `feat!:`) oppure footer `BREAKING CHANGE: ...`.

**Scope consigliati**: `core`, `api`, `web`, `nav`, `calendar`, e i domini funzionali (`merch`, `pricing`, `rbac`, `sourcing`, `auth`, `dashboard`, `calendar`, `company`).

**Esempi**:

- `feat(calendar): add MilestoneDependency model`
- `fix(rbac): correct section access fallback for editor role`
- `feat(api)!: rename collection.rows to collection.layoutRows`
- `chore(deps): bump prisma to 6.0`

I commit sono validati dal hook `.husky/commit-msg` (commitlint). Se non rispetti il format il commit è rifiutato.
