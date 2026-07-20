# Luke Project — Claude Rules

# /Users/brail/code/cursor/luke/CLAUDE.md

## Regole di ingaggio (prima di ogni modifica)

1. Elenca i file che intendi modificare e spiega l'approccio
2. Attendi conferma se tocchi più di 3 file o uno qualsiasi tra:
   crypto/auth, RBAC/section definitions, AppConfigRegistry, pricing logic,
   schema.prisma, release workflow
3. **Mai `git commit` senza esplicita approvazione** — mostra il diff, chiedi conferma,
   aspetta il via libera, poi committa
4. Quando vieni corretto su qualcosa, aggiungi immediatamente una regola in `lessons.md`
5. Dopo ogni modifica: lint + typecheck del package toccato, riporta i risultati

---

## Monorepo

```
apps/
  web/          → Next.js 15 + shadcn/ui (frontend, porta 3000)
  api/          → Fastify 5 + tRPC + Prisma (backend, porta 3001)
packages/
  core/         → @luke/core: schemas, RBAC, pricing, storage, crypto, URL utils
  nav/          → @luke/nav: NAV sync layer (mssql pool, sync modules)
  eslint-plugin-luke/ → custom ESLint rules
```

Dev: `pnpm dev` avvia tutto via Turbo.
Se API fallisce con "Cannot find module @luke/core/dist": `pnpm --filter @luke/core build`.
Turbo cache può essere stale — se i dist mancano, build manuale.
Dopo modifiche a router tRPC in `apps/api`: `cd apps/api && npx tsc -b`
(altrimenti `apps/web` tsc non vede il nuovo shape).

## Stack Constraints

- **Package manager**: pnpm only — mai npm o yarn.
  Comandi: `pnpm --filter <app> <script>` dalla root, o cd nel package
- **ORM**: Prisma — raw SQL solo in `packages/nav/src/` (mai in application logic).
  Eccezioni consentite, solo con commento che giustifica: health-probe `SELECT 1`
  (`observability/readiness.ts`); query su tabelle di dominio applicativo (non NAV)
  che richiedono feature SQL non esprimibili in Prisma ORM (es. `DISTINCT ON` +
  `json_agg ... FILTER`) — usare sempre `Prisma.sql` tagged template, mai
  `$queryRawUnsafe`/`$executeRawUnsafe` per queste.
- **API layer**: tRPC per tutte le route dashboard/UI; Prisma diretto per AI agent queries
- **Validation**: schemi Zod da `@luke/core` — mai ridefinire inline.
  Catalogo in `packages/core/src/schemas/` — verificare sempre lì prima di crearne uno.
  Principali: `userSchema`, `ldapConfigSchema`/`navConfigSchema` (+ `*ResponseSchema`
  senza password), `brandSchema`/`seasonSchema`/`vendorSchema`,
  `pricingParameterSetInputSchema`, `collectionLayoutRowInputSchema`,
  `appConfigSchema`/`AppConfigRegistry`, `sectionEnum`/`SECTION_TO_PERMISSION`/
  `SECTION_ACCESS_DEFAULTS`, `rbacSchema`, `authSchemas`, `mailSchema`,
  `RateLimitConfigSchema`/`LdapResilienceSchema`
- **TypeScript**: strict mode — no `any`, no type assertion senza commento esplicativo
- **URLs in frontend**: mai hardcode `localhost:3001` in `apps/web/src` — usare
  `buildApiUrl()`, `buildTrpcUrl()` da `@luke/core/net/url`
  (check manuale: `pnpm codemod:check-urls` — non ancora una regola ESLint in
  `packages/eslint-plugin-luke/`, né wired in CI/husky)

---

## Development Patterns — Regole Obbligatorie

1. **`$transaction` per ogni write multi-tabella** — upsert su 2+ tabelle correlate
   sempre in `prisma.$transaction(async tx => { ... })`
2. **try/catch individuale nei sync batch** — in `syncAll()` e simili, ogni
   `await syncXxx()` ha il suo try/catch: un errore non blocca le altre entità
3. **`$transaction` per check-then-act** — "leggi → valida → scrivi" sempre in
   transaction (race condition)
4. **Audit logging su ogni mutation** — create/update/delete/restore/unlink →
   `withAuditLog` middleware o `logAudit()` esplicito
5. **`requirePermission()` su ogni endpoint protetto** — READ → `entity:read`,
   CREATE → `entity:create`, ecc. Mai `update` per query read-only
6. **`onDelete` esplicito su ogni `@relation` Prisma** — default sicuro
   `onDelete: Restrict`; `Cascade` solo se intenzionale e commentato
7. **Mai duplicare schema/tipi** — se esiste in `@luke/core`, importarlo da lì
8. **Indici su FK e colonne filtrate** — ogni FK e colonna in WHERE (`isActive`,
   `vendorId`, ...) → `@@index([campo])`
9. **Allineamento versioni dependency** — dopo ogni upgrade, stessa versione in
   tutti i `package.json` del workspace
10. **Mai `console.*`** — API: `logger.*` (Pino); Web: `debugLog/debugWarn/debugError`
    da `lib/debug.ts`
11. **Query context-dependent: params espliciti** — ogni procedura tRPC che dipende
    da brand/season DEVE ricevere `brandId`/`seasonId` come input Zod espliciti,
    MAI leggerli da `userPreference` server-side. Il frontend li passa da
    `useAppContext()` con `enabled: !!brand?.id && !!season?.id` → React Query
    refetch automatico al cambio contesto.
    Pattern di riferimento: `pricing.parameterSets.list`, `collectionLayout.get`,
    `sales.statistics.portafoglio.getFilters`

### Soft delete pattern

- `remove()`: `isActive=false` — mai hard delete; `restore()`: `isActive=true`
- `list()`: filtra `isActive=true` default; `includeInactive=true` per admin
- Riga inattiva in tabella: `className={!item.isActive ? 'opacity-50' : undefined}`

---

## AppConfig System

Tutta la configurazione runtime vive nella tabella `AppConfig` (Postgres KV).
`AppConfigRegistry` in `packages/core/src/schemas/config.ts` è la **single source of truth**.

- **Mai `process.env.*` nel codice applicativo** — usare `getConfigValue(prisma, key)`
  o il tRPC config router. Env var solo per bootstrap (URL, NODE_ENV)
- **Ogni nuova chiave config va aggiunta a `AppConfigRegistry`** col suo schema Zod
- Valori in DB sempre stringhe — `z.coerce.*` per numeri/boolean,
  `.transform(s => JSON.parse(s))` per JSON blob
- Valori sensitivi letti con `decrypt: true` in `getConfig()`
- `CRITICAL_CONFIG_KEYS`: solo `auth.strategy`. Aggiungere solo se l'assenza deve
  bloccare il boot

## Auth & Crypto — NON TOCCARE senza richiesta esplicita

- Master key: `~/.luke/secret.key` (32 bytes, mode 0600) — auto-generata al primo avvio
- Segreti derivati via HKDF-SHA256: `nextauth.secret`, `api.jwt`, `cookie.secret`
- Crypto utilities **server-only** — importare da `@luke/core/server`, mai da
  `@luke/core` (lancia eccezione nel browser)
- `packages/core/src/crypto/secrets.server.ts` — non modificare senza commento
  che spiega l'intent di sicurezza

## RBAC & Section Access

Due layer distinti che devono restare in sync.

**Layer 1 — Resource:Action** (`packages/core/src/auth/permissions.ts`, statico):

- Ruoli: `admin` (`*:*`), `editor`, `viewer`
- Sempre `hasPermission(user, 'resource:action')` — mai `user.role === 'admin'` inline
- Ogni endpoint tRPC protetto: `requirePermission('entity:action')` obbligatorio

**Layer 2 — Section visibility** (dot-notation: `product.pricing`, `settings.ldap`, ...):

- Accesso valutato da `effectiveSectionAccess()`, precedenza a 4 livelli:
  kill switch → override utente → AppConfig role defaults → RBAC fallback
- **Nuova sezione = aggiornare TRE posti in sync**: `sectionEnum`,
  `SECTION_TO_PERMISSION`, `SECTION_ACCESS_DEFAULTS` (tutti e tre i ruoli)
- `SECTION_ACCESS_DEFAULTS` è statico (version-controlled); override runtime
  per-ruolo in AppConfig (`rbac.sectionAccessDefaults`)
- Sempre `invalidateRbacCache()` dopo write su chiavi RBAC in AppConfig

## LDAP

- Quattro strategie via `auth.strategy` in AppConfig:
  `local-first` | `ldap-first` | `local-only` | `ldap-only` — mai hardcodare
- Circuit breaker attivo (`breakerFailureThreshold` / `breakerCooldownMs`) —
  non bypassare il resilience wrapper
- `roleMapping`: JSON string che mappa gruppi LDAP → ruoli Luke

## Pricing Engine

- Tre modalità in `PricingModeSchema`: `forward` | `inverse` | `margin`
- **Write riservato ad admin** — `pricing:update` non è nel ruolo editor (solo
  `pricing:read`). Mai esporre mutation di parameter set all'editor
- `PricingParameterSetInputSchema` definisce tutti i campi — non aggiungerne fuori
- Calcoli sempre scoped a `brandId` + `seasonId`
- Valute: solo quelle in `PRICING_CURRENCIES`
  (`packages/core/src/schemas/pricing.ts`) — non aggiungerne senza aggiornarla

## Collection Layout

Modello a due livelli: **Groups** contengono **Rows**, ordering indipendente.

- Max `COLLECTION_COLUMNS_MAX_VISIBLE` (7) colonne visibili simultaneamente.
  Sempre visibili: `#`, `line`, `skuForecast`, `actions`.
  Default nascoste: `gender`, `designer`, `styleStatus`
- Sempre gli enum definiti, mai stringhe libere: `COLLECTION_GENDER`,
  `COLLECTION_STRATEGY`, `COLLECTION_STATUS`, `COLLECTION_PROGRESS`
  (ordinamento fisso `01 - FASE DI DESIGN` → `06 - SMS LANCIATI`)
- `skuBudget` appartiene al Group, `skuForecast` alla Row — non invertire
- Upload foto: `buildCollectionRowPictureUploadUrl(rowId)` — mai path manuali

## Storage Layer

`IStorageProvider` è un'interfaccia intenzionale per futuri provider (local/samba/gdrive).

- Mai file handling fuori da un'implementazione `IStorageProvider`
- Bucket validi: quelli accettati da `isValidBucket()` in
  `packages/core/src/storage/config.ts` — mai aggiungere bucket senza aggiornare
  `localStorageConfigSchema`
- Sempre le builder functions — mai costruire path `/upload/...` a mano
- `enableProxy`: non hardcodare — leggere da config

## NAV / packages/nav

Dettagli tabelle NAV e decisioni sync: `docs/nav-integration.md`

- Table names: sempre `[${sanitizeCompany(config.company)}$TableName]`
- `packages/nav` NON importa da `apps/api` — config injettata via `GetConfigFn`
- Nuovi sync module: `buildNavSyncFilter` + `buildWhereClause` + `processInBatches`
  da `sync/utils.ts`, batch 100, `request.timeout = 60_000`
- Wrap NAV replica + local upsert in `prisma.$transaction()`
- Mai auto-riattivare entità soft-deleted durante sync; sync aggiorna SOLO campi
  provenienti da NAV (tipicamente `name`) — mai `isActive` né campi arricchiti
- Nuove query/tipi: `packages/nav/src/queries/` e `packages/nav/src/types/`
- `Brand.code` max 20 chars, `Season.code` max 10 chars (allineato a NAV nvarchar)
- DAB: solo bridge LLM→NAV, non per il sync layer

---

## Frontend — apps/web

### shadcn/ui strict

- Solo componenti shadcn/ui — mai import Radix diretti, mai MUI.
  Nuovi componenti via CLI: `pnpm dlx shadcn@latest add <component>`
- Tailwind utility classes only — no `style={{}}`, no CSS modules.
  Arbitrary values (`w-[327px]`) solo con commento che giustifica
- Colori via CSS variables (`--background`, `--primary`, ...) — mai hex/rgb hardcodati
- className sempre via `cn()` da `lib/utils`; varianti multiple → CVA

### UI Patterns obbligatori

**Permission-aware UI** (uniforme su tutte le pagine):

- Creation buttons: `<CreateActionButton>` — sempre visibile, disabled + tooltip
  se no permesso
- Table actions: Modifica/Elimina sempre visibili, disabled + tooltip se no permesso.
  Disabled style: `className="opacity-50 cursor-not-allowed"` +
  `<TooltipProvider><Tooltip>` con messaggio "Non hai i permessi per [azione] [risorsa]"
- Config pages (mail, storage, LDAP): save button gated con `can('config:update')`

**Delete confirmation**: SEMPRE `<ConfirmDialog>` da `components/ConfirmDialog.tsx` —
mai `globalThis.confirm()`.

**Permission hooks** (`usePermission`):

- Boolean props: `canCreate`, `canUpdate`, `canDelete`, `canList` — NO parentesi
- Function methods: `canEdit()`, `isReadOnly()`, `isAdmin()`, `isAdminOrEditor()`,
  `can()`, `canAll()`, `canAny()` — SÌ parentesi

**Error handling**: `getTrpcErrorMessage(error, entityOverrides?)` da
`lib/trpcErrorMessages.ts`

**i18n (futuro)**: non bloccare il lavoro attuale, ma evitare stringhe hardcoded
in componenti profondi senza possibilità di estrazione (date, numeri, stringhe UI).

### ESLint Import Order

Gruppi: (1) builtin + external uniti, alfabetico, NO blank line tra loro;
(2) blank line; (3) internal (path relativi), alfabetico.

```tsx
import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageHeader } from '../../../../components/PageHeader';
import { cn } from '../../../../lib/utils';
```

---

## Env Policy — Regola Architetturale Ferma

`.env` ammette SOLO bootstrap infrastrutturale. Tutto il resto va in AppConfig.

**Ammesso in `.env` API**: `DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`,
`LUKE_CORS_ALLOWED_ORIGINS`, `OTEL_*`, `LOG_LEVEL`, `APP_VERSION`
(metadata build-time iniettata come Docker `ARG`/`ENV` dal git tag in CI —
non un segreto, mai letta da AppConfig per evitare drift dall'immagine in esecuzione)

**Ammesso in `.env` Web** (eccezioni framework): `INTERNAL_API_URL`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FRONTEND_URL`, `NEXTAUTH_URL`,
`NEXTAUTH_SECRET`, `COOKIE_SECURE`, `NEXT_PUBLIC_APP_VERSION` (stesso pattern build-time)

**Vietato in `.env`**: credenziali SMTP, LDAP, storage, token, password applicative.

Enforcement: `assertEnvPolicy()` in `apps/api/src/server.ts` blocca il boot in
produzione se trova pattern vietati (`SMTP_*`, `LDAP_*`, `JWT_*`, `*_SECRET`,
`*_PASSWORD`, `*_API_KEY`, `*_TOKEN`).

---

## Prisma Migration Workflow

Ogni modifica a `schema.prisma` richiede migration versionata.
Workflow completo (Postgres temporaneo porta 5433 → `migrate dev` → `db push` su
5432 → commit del file migration): **`docs/prisma-migration-workflow.md`**

In produzione: `entrypoint.sh` esegue `prisma migrate deploy`.
Mai `prisma migrate reset` in produzione.

## Versioning & Release

**SemVer**: `patch` = fix/refactor/chore/migration senza feature;
`minor` = nuova funzionalità visibile; `major` = breaking change API/contratti.

**Prima di ogni `git tag vX.Y.Z`** (workflow obbligatorio):

1. Bump tutti i `package.json` del monorepo a X.Y.Z
2. Commit `"chore: bump version to X.Y.Z"`
3. `git tag vX.Y.Z && git push origin vX.Y.Z`

**Release flow**: push su `main` → solo CI (lint + typecheck);
tag `vX.Y.Z` → build Docker → `ghcr.io` → Portainer pull & redeploy.
**MAI cancellare il volume `luke_api_data`** — la master key vive lì.

**Al cambio di develop branch** (es. `develop-2.1` → `develop-2.2`):
aggiornare `target-branch` in `.github/dependabot.yml` (blocchi `github-actions` e
`docker`) e la lista `branches` in `.github/workflows/ci.yml` (`push` e `pull_request`)
— altrimenti lint/typecheck CI smette di girare sul nuovo branch senza segnalarlo.

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) — alimentano il
CHANGELOG via `git-cliff`, validati da `.husky/commit-msg` (commitlint).

- Format: `<type>(<scope>)?: <description>`
- Types: `feat` (minor) | `fix` (patch) | `docs` | `style` | `refactor` | `perf` |
  `test` | `chore` | `ci`
- Breaking: `!` dopo il type (`feat!:`) oppure footer `BREAKING CHANGE: ...`
- Scope consigliati: `core`, `api`, `web`, `nav`, e domini funzionali
  (`merch`, `pricing`, `rbac`, `sourcing`, `auth`, `dashboard`, `calendar`, `company`)

Esempi: `feat(calendar): add MilestoneDependency model` ·
`fix(rbac): correct section access fallback for editor role` ·
`feat(api)!: rename collection.rows to collection.layoutRows`
