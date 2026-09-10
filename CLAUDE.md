# Luke Project — Claude Rules

## Rules of engagement (before every change)

1. List the files you intend to modify and explain your approach
2. Wait for confirmation if you touch more than 3 files or any of:
   crypto/auth, RBAC/section definitions, AppConfigRegistry, pricing logic,
   the Prisma schema (`packages/db/prisma/*.prisma`), release workflow
3. **Never `git commit` without explicit approval** — show the diff, ask for
   confirmation, wait for the go-ahead, then commit

## Canonical Language and Documentation Impact

- Write mutable technical documentation, repository instructions, source
  comments, developer-facing diagnostics and logs, and all other technical
  prose only in English, regardless of the language of the conversation.
- Italian is temporarily allowed only in genuine product UI and end-user
  interaction pending the i18n cycle. Audience decides the exception, not the
  source file containing the text.
- Any future Italian documentation is derived from canonical English, never an
  independently maintained source. Do not invent a translation layout or
  pipeline before a real derived translation is authorized.
- Preserve the existing language of frozen historical bodies. Write any new
  material appended to them in English.
- Before staging or requesting commit approval for any code change, report
  `Documentation impact: none` with supporting evidence, or
  `Documentation impact: update required` with the affected material and why.
- For changes to architecture, public or API behavior, configuration,
  operations, release or deployment, developer workflows, or repository
  structure, invoke `/luke-docs audit --since <baseline>` automatically.
  The audit is read-only; documentation writes remain separately reviewed.

Rationale, rejected alternatives, and the one-time pre-ADR-015 translation
exception: `docs/decisions/015-documentation-architecture-and-canonical-language.md`.

---

## Monorepo

```
apps/
  web/          → Next.js + shadcn/ui (frontend, port 3000)
  api/          → Fastify + tRPC + Prisma (backend, port 3001)
packages/
  core/         → @luke/core: schemas, RBAC, pricing, storage, crypto, URL utils
  db/           → @luke/db: Prisma schema, migrations, generated client, createPrismaClient
  nav/          → @luke/nav: NAV sync layer (mssql pool, sync modules)
  calendar/     → @luke/calendar: calendar domain, Google sync, ICS generation
  eslint-plugin-luke/ → custom ESLint rules
```

**No version numbers in this file.** The architectural choice — Next, Fastify,
tRPC, Prisma, Zod, pnpm — is stable and belongs here; the version it currently
sits on is not. Read that from the workspace manifests (`apps/*/package.json`,
`packages/*/package.json`, the root `package.json` for `engines` and
`packageManager`) and the configs they point at. `/luke-deps platform` governs
and verifies that those pins stay coherent with each other.

A version repeated here is a second source of truth, and it drifts: this block
said "Next.js 15" for months while `apps/web` was on 16.

Dev: `pnpm dev` starts everything via Turbo.
If the API fails with "Cannot find module @luke/core/dist": `pnpm --filter @luke/core build`.
Turbo cache can be stale — if the dist files are missing, build manually.
`apps/web` resolves `@luke/api` through the package's `exports` map to `dist`,
not to `src`. While `pnpm dev` runs, the API's `dev:types` watch re-emits those
declarations on every router change, so nothing else is needed. With dev
stopped, `pnpm --filter @luke/api build`
refreshes them; every `build` script deletes its outputs first, so a renamed
or removed source leaves no stale declaration behind.
Do not run emitting builds or tests (`pnpm build`, `pnpm test`, `pnpm typecheck`,
the pre-push hook) in a worktree where `pnpm dev` is running: a build that is
interrupted between its clean and its emit leaves a partial `dist` that the
running watch will not restore. Use a second worktree, or stop dev first.

## Stack Constraints

- **Package manager**: pnpm only — never npm or yarn.
  Commands: `pnpm --filter <app> <script>` from the root, or cd into the package
- **ORM**: Prisma, owned by `@luke/db` — the schema (`packages/db/prisma/*.prisma`,
  a flat multi-file layout split by domain — `identity`, `platform`, `catalog`,
  `collection`, `merchandising`, `nav-analytics`, `company`, `calendar` — plus a
  header `schema.prisma` holding only `generator`/`datasource`; `prisma.config.ts`
  declares `schema: 'prisma'` so the CLI reads the whole directory),
  the migrations, `prisma.config.ts` and the generated client all live there, and
  every Prisma type is imported from `@luke/db`, never from `@prisma/client`.
  A client is constructed in exactly one place, `createPrismaClient` — enforced by
  `.semgrep/rules/prisma-client-instantiation.yml`. Run any `prisma` CLI command
  from `packages/db/`; it is the only directory that resolves config, schema and
  migrations together. Domain seeds and the `db:*` operational scripts stay in
  `@luke/api`: they apply business rules and import `apps/api/src/`.
  `apps/api` keeps `@prisma/client` as a **devDependency** — no source imports it,
  but its emitted `.d.ts` graph names `@prisma/client/runtime/client`, and dropping
  it breaks `apps/web`'s build while `apps/api` stays green (gated by
  `DECLARATION_GRAPH_DEPENDENCIES` in `tools/scripts/check-platform-integrity.ts`).
  Raw SQL only in `packages/nav/src/` (never in application logic).
  Allowed exceptions, only with a justifying comment: health-probe `SELECT 1`
  (`observability/readiness.ts`); queries on application-domain tables (not NAV)
  that require SQL features not expressible in the Prisma ORM (e.g. `DISTINCT ON` +
  `json_agg ... FILTER`) — always use the `Prisma.sql` tagged template, never
  `$queryRawUnsafe`/`$executeRawUnsafe` for these.
- **API layer**: tRPC for all dashboard/UI routes; direct Prisma for AI agent queries
- **Validation**: Zod schemas from `@luke/core` — never redefine inline.
  Catalog in `packages/core/src/schemas/` — always check there before creating a new one.
  Main ones: `userSchema`, `ldapConfigSchema`/`navConfigSchema` (+ `*ResponseSchema`
  without password), `brandSchema`/`seasonSchema`/`vendorSchema`,
  `pricingParameterSetInputSchema`, `collectionLayoutRowInputSchema`,
  `appConfigSchema`/`AppConfigRegistry`, `sectionEnum`/`SECTION_TO_PERMISSION`/
  `SECTION_ACCESS_DEFAULTS`, `rbacSchema`, `authSchemas`, `mailSchema`,
  `RateLimitConfigSchema`/`LdapResilienceSchema`
- **TypeScript**: strict mode — no `any`, no type assertion without an explanatory comment
- **URLs in frontend**: never hardcode `localhost:3001` in `apps/web/src` — use
  `buildApiUrl()`, `buildTrpcUrl()` from `@luke/core`. They are declared in
  `packages/core/src/net/url.ts` and re-exported by the barrel; the package
  publishes only `.`, `./server` and `./utils/date`, so `@luke/core/net/url`
  is not an importable specifier
  (manual check: `pnpm codemod:check-urls` — not yet an ESLint rule in
  `packages/eslint-plugin-luke/`, nor wired into CI/husky)

---

## Development Patterns — Mandatory Rules

1. **`$transaction` for every multi-table write** — upsert on 2+ related tables
   always inside `prisma.$transaction(async tx => { ... })`
2. **individual try/catch in sync batches** — in `syncAll()` and similar, every
   `await syncXxx()` has its own try/catch: one error must not block the other entities
3. **`$transaction` for check-then-act** — "read → validate → write" always in
   a transaction (race condition)
4. **Audit logging on every mutation** — create/update/delete/restore/unlink →
   `withAuditLog` middleware or explicit `logAudit()`. Metadata keys are typed
   against `SAFE_KEY_LIST` (`apps/api/src/lib/auditLog.ts`): an unlisted key
   fails the build, adding one there is a deliberate decision that it is safe
   to persist. The type only sees **properties written literally**, so
   `metadata` must be a spread-free object literal — enforced by
   `@luke/audit-metadata-object-literal`. Write `x: cond ? v : undefined`, never
   `...(cond && { x: v })`: `undefined` is dropped by the sanitizer, so the row
   is identical and the key stays visible to the type. Outside production an
   unlisted key **throws**; in production it is redacted as before. A key whose
   value is a map (its keys are data, not field names) goes in
   `MAP_VALUED_KEYS` — otherwise the allowlist is asked to vouch for the data
   and silently eats it. Pre-session flows (login, email verification, password reset)
   legitimately write `actorId: null` — they must still set `targetId` to the
   `User.id`, which is what lets the read path attribute the event to a person
   instead of rendering an anonymous "Sistema"
5. **`requirePermission()` on every protected endpoint** — READ → `entity:read`,
   CREATE → `entity:create`, etc. Never `update` for a read-only query
6. **Explicit `onDelete` on every Prisma `@relation`** — safe default
   `onDelete: Restrict`; `Cascade` only if intentional and commented
7. **Never duplicate schema/types** — if it exists in `@luke/core`, import it from there
8. **Indexes on FKs and filtered columns** — every FK and every column used in a
   WHERE (`isActive`, `vendorId`, ...) → `@@index([field])`
9. **Dependency version alignment** — after every upgrade, same version across
   all `package.json` files in the workspace
10. **Never `console.*`** — API: `logger.*` (Pino); Web: `debugLog/debugWarn/debugError`
    from `lib/debug.ts`
11. **Context-dependent queries: explicit params** — every tRPC procedure that
    depends on brand/season MUST receive `brandId`/`seasonId` as explicit Zod
    inputs, NEVER read them from `userPreference` server-side. The frontend
    passes them from `useAppContext()` with `enabled: !!brand?.id && !!season?.id`
    → automatic React Query refetch on context change.
    Reference pattern: `pricing.parameterSets.list`, `collectionLayout.get`,
    `sales.statistics.portafoglio.getFilters`
12. **Auth-adjacent endpoint → double rate limit (IP + account)** — login and
    every endpoint that verifies credentials/tokens must have both an
    `keyBy: 'ip'` bucket and one `keyBy` on identity (username/account): the
    former alone doesn't stop a password-spray distributed across many IPs
    against a single account.
    Reference pattern: `auth.login` (`login` + `loginByUsername` in
    `apps/api/src/lib/ratelimit.ts`)
13. **Server-to-server web→api calls: always forward the real client IP** —
    any fetch made by `apps/web` to `apps/api` on behalf of a user request
    (not just NextAuth `authorize()`) must propagate the real IP
    (`X-Forwarded-For`), otherwise a `keyBy: 'ip'` rate-limit bucket on
    apps/api silently collapses onto a single key shared by all users
    (the web container's address) instead of being per-attacker. Fastify
    trusts that header only because apps/api is never directly reachable
    from the Internet (no published port) — do not generalize
    `trustProxy: true` to a publicly exposed service without re-evaluating
    spoofing risk. A `keyBy: 'ip'` bucket added on a server-to-server path
    must always come with a test that demonstrates per-attacker behavior,
    not just per-config-format (see `apps/api/test/ratelimit.integration.spec.ts`,
    describe `blocks valid credentials too`).
14. **Code comments always in English** — `//`, `/** */`, Prisma `///`:
    always English, everywhere, **including domain terms** (stagione → season,
    campionario → collection/catalog, reso → return, etc.) — no exception for
    Italian vocabulary. With i18n coming on develop-2.2, Italian gets no
    privileged treatment in the source code. Merge logic on existing comments
    (leave untouched if accurate, extend if incomplete, rewrite if drifted):
    see `.claude/skills/luke-docs/references/inline-rules.md`.
15. **An allowlist that gates persisted or displayed data must be bound to a
    type** — every hand-maintained list of permitted keys/values
    (`SAFE_KEY_LIST`, `PRICING_CURRENCIES`, valid storage buckets, ...) gets
    `as const` plus a union derived from it, used in the signature of whatever
    consumes it, so a call site outside the list fails `tsc` instead of
    drifting. Filter paths fail **closed and silently**: drift produces
    `[REDACTED]`, `{}` or a dropped field, never an error, so nothing surfaces
    it until someone reads the output months later. Corollary: never stack a
    second allowlist in front of the first "for safety" — each ends up
    maintained as if the other were authoritative, and the outer one discards
    what the inner one would have kept.

### Soft delete pattern

- `remove()`: `isActive=false` — never hard delete; `restore()`: `isActive=true`
- `list()`: filters `isActive=true` by default; `includeInactive=true` for admin
- Inactive row in a table: `className={!item.isActive ? 'opacity-50' : undefined}`

---

## AppConfig System

All runtime configuration lives in the `AppConfig` table (Postgres KV).
`AppConfigRegistry` in `packages/core/src/schemas/config.ts` is the **single source of truth**.

- **Never `process.env.*` in application code** — use `getConfigValue(prisma, key)`
  or the tRPC config router. Env vars only for bootstrap (URL, NODE_ENV)
- **Every new config key must be added to `AppConfigRegistry`** with its Zod schema —
  not a convention: `saveConfig(prisma, key: AppConfigKey, ...)` won't compile
  without it, and it validates the value against that schema before writing
  (on the plaintext, before `encryptValue`). Never widen a schema to accommodate
  a write: a key that means "not configured" is *absent*, so the write path calls
  `deleteConfig`, never `saveConfig(key, '')` — `getConfig` already returns `null`
  for an absent key, and `''` would be a second spelling of the same state
- Values in the DB are always strings — `z.coerce.*` for numbers/booleans,
  **`jsonConfigSchema(Inner)`** for JSON blobs, never
  `.transform(s => Inner.parse(JSON.parse(s)))`: a `parse` (or a `JSON.parse`
  `SyntaxError`) inside a bare `transform` **throws through `safeParse`** instead of
  populating `result.error`, so every caller would have to know to wrap that key.
  Pinned by a test over the whole registry, not a sample
- **Defaults live in `APP_CONFIG_DEFAULTS`**, once, in the string form AppConfig
  stores — never spelled at the call site. Read such a key with
  `getConfigOrDefault(prisma, key)`, which returns the parsed value and never
  null, so no caller writes a fallback or a coercion. The seed reads the same
  declaration. They had drifted: `storage.s3.endpoint` fell back to `seaweedfs`
  in the settings router and `localhost` in the provider that opens the
  connection. Credentials are deliberately absent — a default credential is a
  dev seed, not a default, and the reader refuses to start rather than
  substituting one (`loadS3Provider`, mirroring `getSmtpConfig`)
- **Numeric bounds belong on the registry schema**, not on the reader. Seven
  `max` values used to live only in `configManager`'s numeric getters, so
  `saveConfig` accepted an out-of-range write, stored it, and the reader
  silently returned the default instead
- Sensitive values read with `decrypt: true` in `getConfig()`. `getConfig`
  remains correct for a plain string with no default (a URL, a credential); it
  is the manual `parseInt`/`=== 'true'` on its result that does not
- `CRITICAL_CONFIG_KEYS`: only `auth.strategy`. Add only if its absence must
  block boot

## Auth & Crypto — DO NOT TOUCH without an explicit request

- Master key: `~/.luke/secret.key` (32 bytes, mode 0600) — auto-generated on first boot
- Secrets derived via HKDF-SHA256: `nextauth.secret`, `api.jwt`, `cookie.secret`
- Crypto utilities are **server-only** — import from `@luke/core/server`, never from
  `@luke/core` (throws in the browser)
- `packages/core/src/crypto/secrets.server.ts` — don't modify without a comment
  explaining the security intent

## RBAC & Section Access

Two distinct layers that must stay in sync.

**Layer 1 — Resource:Action** (`packages/core/src/auth/permissions.ts`, static):

- Roles: `admin` (`*:*`), `editor`, `viewer`
- Always `hasPermission(user, 'resource:action')` — never inline `user.role === 'admin'`
- Every protected tRPC endpoint: `requirePermission('entity:action')` mandatory

**Layer 2 — Section visibility** (dot-notation: `product.pricing`, `settings.ldap`, ...):

- Access evaluated by `effectiveSectionAccess()`, 4-level precedence:
  kill switch → user override → AppConfig role defaults → RBAC fallback
- **New section = update THREE places in sync**: `sectionEnum`,
  `SECTION_TO_PERMISSION`, `SECTION_ACCESS_DEFAULTS` (all three roles)
- `SECTION_ACCESS_DEFAULTS` is static (version-controlled); per-role runtime
  override lives in AppConfig (`rbac.sectionAccessDefaults`)
- Always `invalidateRbacCache()` after writing to RBAC keys in AppConfig

## LDAP

- Four strategies via `auth.strategy` in AppConfig:
  `local-first` | `ldap-first` | `local-only` | `ldap-only` — never hardcode
- Circuit breaker active (`breakerFailureThreshold` / `breakerCooldownMs`) —
  don't bypass the resilience wrapper
- `roleMapping`: JSON string mapping LDAP groups → Luke roles

## Pricing Engine

- Three modes in `PricingModeSchema`: `forward` | `inverse` | `margin`
- **Write reserved to admin** — `pricing:update` is not in the editor role (only
  `pricing:read`). Never expose parameter set mutations to the editor
- `PricingParameterSetInputSchema` defines all fields — don't add any outside it
- Calculations always scoped to `brandId` + `seasonId`
- Currencies: only those in `PRICING_CURRENCIES`
  (`packages/core/src/schemas/pricing.ts`) — don't add any without updating it

## Collection Layout

Two-level model: **Groups** contain **Rows**, independent ordering.

- Max `COLLECTION_COLUMNS_MAX_VISIBLE` (7) columns visible at once.
  Always visible: `#`, `line`, `skuForecast`, `actions`.
  Hidden by default: `gender`, `designer`, `styleStatus`
- Always use the defined enums, never free strings: `COLLECTION_GENDER`,
  `COLLECTION_STRATEGY`, `COLLECTION_STATUS`, `COLLECTION_PROGRESS`
  (fixed ordering `01 - FASE DI DESIGN` → `06 - SMS LANCIATI`)
- `skuBudget` belongs to the Group, `skuForecast` to the Row — don't swap them
- Photo upload: `buildCollectionRowPictureUploadUrl(rowId)` — never manual paths

## Storage Layer

`IStorageProvider` is an interface deliberately designed for future providers (local/samba/gdrive).

- Never handle files outside an `IStorageProvider` implementation
- Valid buckets: `APP_STORAGE_BUCKETS` in `packages/core/src/storage/types.ts` is
  the only list — `isValidBucket()` derives from it. Never spell the buckets out
  a second time anywhere
- Always use the builder functions — never construct `/upload/...` paths by hand
- `enableProxy`: don't hardcode — read from config

## NAV / packages/nav

NAV table details and sync decisions: `docs/nav-integration.md`

- Table names: always `[${sanitizeCompany(config.company)}$TableName]`
- `packages/nav` does NOT import from `apps/api` — config is injected via `GetConfigFn`
- New sync modules: `buildNavSyncFilter` + `buildWhereClause` + `processInBatches`
  from `sync/utils.ts`, batch 100, `request.timeout = 60_000`
- Wrap NAV replica + local upsert in `prisma.$transaction()`
- Never auto-reactivate soft-deleted entities during sync; sync only updates
  fields coming FROM NAV (typically `name`) — never `isActive` nor enriched fields
- New queries/types: `packages/nav/src/queries/` and `packages/nav/src/types/`
- `Brand.code` max 20 chars, `Season.code` max 10 chars (aligned with NAV nvarchar)
- DAB: only an LLM→NAV bridge, not for the sync layer

---

## Frontend — apps/web

### shadcn/ui strict

- Only shadcn/ui components — never import Radix directly, never MUI.
  New components via CLI: `pnpm dlx shadcn@latest add <component>`
- Tailwind utility classes only — no `style={{}}`, no CSS modules.
  Arbitrary values (`w-[327px]`) only with a justifying comment
- Colors via CSS variables (`--background`, `--primary`, ...) — never hardcoded hex/rgb
- className always via `cn()` from `lib/utils`; multiple variants → CVA

### Mandatory UI Patterns

**Permission-aware UI** (consistent across all pages):

- Creation buttons: `<CreateActionButton>` — always visible, disabled + tooltip
  if no permission
- Table actions: Edit/Delete always visible, disabled + tooltip if no permission,
  message "You don't have permission to [action] [resource]". Always
  `<PermissionButton>`, or `<PermissionTooltip>` when the control is not a
  `Button` (a native `<button>`, a `Checkbox`, a group) — never hand-roll the
  wrapper: a `<button disabled>` emits no pointer or focus event and `Tab` skips
  it, so the tooltip has to hang off a focusable `<span>` and the components are
  what put it there. Enforced by `@luke/no-unreachable-disabled-tooltip`
- One tooltip per control, not per group. Group only when the controls share the
  exact same message (a toolbar behind a single permission): a group tooltip can
  carry one message, and grouping also hands a user without the permission a
  different tab order from one who has it
- `TooltipProvider` is mounted once, in `components/Providers.tsx` — never add
  another: Radix groups the open delay per provider, so a local one silently
  makes every neighbouring tooltip re-wait the full delay
- Config pages (mail, storage, LDAP): save button gated on `can('config:update')`

**Delete confirmation**: ALWAYS `<ConfirmDialog>` from `components/ConfirmDialog.tsx` —
never `globalThis.confirm()`.

**Permission hooks** (`usePermission`):

- Boolean props: `canCreate`, `canUpdate`, `canDelete`, `canList` — NO parentheses
- Function methods: `canEdit()`, `isReadOnly()`, `isAdmin()`, `isAdminOrEditor()`,
  `can()`, `canAll()`, `canAny()` — YES parentheses

**Error handling**: `getTrpcErrorMessage(error, entityOverrides?)` from
`lib/trpcErrorMessages.ts`

**i18n (future)**: don't block current work on it, but avoid hardcoded strings
in deeply nested components without a way to extract them later (dates, numbers, UI strings).

### ESLint Import Order

Groups: (1) builtin + external merged, alphabetical, NO blank line between them;
(2) blank line; (3) internal (relative paths), alphabetical.

```tsx
import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageHeader } from '../../../../components/PageHeader';
import { cn } from '../../../../lib/utils';
```

---

## Env Policy — Firm Architectural Rule

`.env` allows ONLY infrastructural bootstrap. Everything else goes in AppConfig.

**Allowed in API `.env`**: `DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`,
`LUKE_CORS_ALLOWED_ORIGINS`, `LUKE_TRUSTED_PROXY_CIDR`, `OTEL_*`, `LOG_LEVEL`,
`APP_VERSION`

`LUKE_TRUSTED_PROXY_CIDR` is infrastructural for the same reason
`LUKE_CORS_ALLOWED_ORIGINS` is: it describes the network boundary, and
`trustProxy` is read once when the Fastify instance is constructed — before any
database connection exists, so AppConfig cannot supply it. The compose files
set it from the same interpolation that creates the `edge` network, so the
subnet Docker builds and the range apps/api trusts have one source. Missing or
invalid in production, apps/api refuses to start
(`apps/api/src/lib/trustProxy.ts`).
(build-time metadata injected as a Docker `ARG`/`ENV` from the git tag in CI —
not a secret, never read from AppConfig to avoid drift from the running image)

**Allowed in Web `.env`** (framework exceptions): `INTERNAL_API_URL`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FRONTEND_URL`, `NEXTAUTH_URL`,
`NEXTAUTH_SECRET`, `COOKIE_SECURE`, `NEXT_PUBLIC_APP_VERSION` (same build-time pattern)

**Forbidden in `.env`**: SMTP, LDAP, storage credentials, tokens, application passwords.

Enforcement: `assertEnvPolicy()` in `apps/api/src/server.ts` blocks boot in
production if it finds forbidden patterns (`SMTP_*`, `LDAP_*`, `JWT_*`, `*_SECRET`,
`*_PASSWORD`, `*_API_KEY`, `*_TOKEN`).

---

## Prisma Migration Workflow

Every physical datamodel change — a model, enum, field, relation, mapping,
default, index or constraint, in any `packages/db/prisma/*.prisma` file —
requires a versioned migration. A change confined to `generator`/`datasource`
config in `schema.prisma` does not, when an authoritative `prisma migrate diff`
proves no physical schema difference (e.g. the Cycle 11 generator switch).
Full workflow (temporary Postgres on port 5433 → `migrate dev` → `db push` on
5432 → commit the migration file): **`docs/prisma-migration-workflow.md`**

In production: `entrypoint.sh` runs `prisma migrate deploy`.
Never `prisma migrate reset` in production.

## Versioning & Release

**SemVer**: `patch` = fix/refactor/chore/migration without a feature;
`minor` = new visible functionality; `major` = breaking change to a supported
compatibility contract.

**`!` / `BREAKING CHANGE` is reserved for a contract Luke actually supports
across an upgrade**, which is one of:

- the external/public API surface — anything called from outside this repo;
- persisted data and migration compatibility;
- supported configuration — AppConfig keys and the values they accept, `.env`
  bootstrap;
- the deployment/upgrade contract — image tags, volumes, entrypoint behaviour.

A coordinated internal change is **not** breaking merely because a function
signature or a tRPC input shape changed. If every caller lives in this monorepo
and moves in the same commit, nothing an operator or a client can observe
broke, and the release is `feat` or `fix`. The test is whether somebody outside
this repository — an operator upgrading, a stored row, a client we support —
has to do something. `apps/web` is not that somebody; a standalone client on
the API would be.

The label is expensive in both directions: it spends a major version, and
mid-train it cannot even deliver one — see the frozen-target note below.

**Release workflow** (`pnpm release:prepare`, wraps `scripts/release-prepare.sh`):

1. `pnpm release:prepare <tag>` — the supported entry point, and the only one:
   `changelog:bump` writes notes with no version and no check. **You name the
   release.** The script refreshes the tags and `origin/main` itself and fails
   closed if it cannot, then `check-release-train.ts --validate` proves the name
   (below) before anything is written. It then updates `CHANGELOG.md` over the
   validated range (`--prepend`, never `--bump -o`: overwrites hand-curated
   sections like the `[2.0.0]` rollup), and proves the result with
   `check-release-tree.ts --worktree`. **`CHANGELOG.md` is the only file it
   writes**: the git tag is the release identity, and no manifest carries a
   version to keep in step with it
2. `git diff` — review the CHANGELOG section
3. `git commit -am "chore(release): notes for X.Y.Z"`
4. `git tag vX.Y.Z && git push origin vX.Y.Z` — one named tag, never
   `--tags`. `.husky/pre-push` runs the same tree checker on the object being
   pushed; it is **early feedback, not enforcement** (`--no-verify` skips it,
   another clone may not have it). `release.yml` is authoritative

**The version is named, and the commits set its floor.** The number is not
inferred: `tools/scripts/check-release-train.ts --validate <tag>` proves the one
you typed. The base is the highest stable tag **reachable from HEAD**, and the
notes cover `base..HEAD` — a set difference on the commit graph, never a walk in
date order. That distinction is the reason the checker exists:
`git-cliff --bumped-version` takes no range and closes a release wherever its
date-ordered walk meets a tagged commit, so once a stable hotfix is merged into
the train every train commit dated before it lands on the published side of that
line — breaking changes included — and the computed bump comes back too small.
A routine main-to-train synchronisation is enough to cause it, and one did.

The validator refuses a tag that exists anywhere, a base that is not reachable,
a stable tag on another line that outranks that base (merge the hotfix first), a
target that is not the open train's frozen one, an rc counter that skips, a
range with nothing releasable in it, and — the SemVer rule above made
mechanical — **any version below the minimum bump** git-cliff computes for the
commits since the base. Equal to the minimum or higher passes; there is no
override flag, because a gate that can be waived on the day it is inconvenient
is not a gate. Nothing is written until every one of those has passed.

**RC trains**: a release train produces several candidates for **one** stable
target — `vX.Y.Z-rc.1`, `rc.2`, … then `vX.Y.Z` — never a new stable version
per candidate. Name the candidate (`pnpm release:prepare v3.0.0-rc.2`) and the
validator checks it against the train it can see: the target must be the one
already cut, and the counter must advance by exactly one.

The target is **frozen when rc.1 is cut**: a `feat!` landing mid-train moves
`v2.2.0-rc.1` to `v2.2.0-rc.2`, not to `v3.0.0-rc.1`. That is the point — a
train has one target — and the frozen target is validated, not merely
documented: the candidate is accepted, and it is the *graduation* that then
refuses, because the minimum bump has become major and `v2.2.0` is below it. A
breaking change accepted after the first candidate is released by starting a new
train at the higher version, not by continuing the current one.

**Release flow**: push to `main` → CI only (lint + typecheck);
tag `vX.Y.Z` → provenance gate → Docker build → `ghcr.io` → Portainer pull &
redeploy. RC artifacts come from the active release train and publish
`rc-latest`; stable artifacts come from `main` and publish `latest` + `X.Y`.
A tag on the wrong line, or a tag name outside those two shapes, fails before
any image is built (`tools/scripts/check-release-provenance.ts`).
**NEVER delete the `luke_api_data` volume** — the master key lives there.

**The tagged tree must claim its own tag.** Immediately after the provenance
gate, the same job runs `tools/scripts/check-release-tree.ts` on the exact
commit the gate resolved (`steps.gate.outputs.sha`, passed through `env`), and
a failure skips `verify` and both image jobs. It proves, against **that tree**
and never the working tree, that `CHANGELOG.md` has exactly one
`## [<version>]` heading for `parseReleaseTag(tag).version` — optionally dated —
with at least one `- ` entry under it. A duplicate heading, an entry that
actually belongs to the next section or to the historical footer, and any
`## [Unreleased]` heading are all rejections. The same checker is what
`release:prepare` and `.husky/pre-push` run, so one contract has one
implementation — the hook predicts the workflow's verdict, it does not replace
it.

**Say plainly what this gate is and is not.** It used to also require every
governed `package.json` to declare the tag's version; no manifest carries a
version any more, so that half is gone rather than weakened — there is no second
identity left to compare, and none to drift. What remains is narrow on purpose:
a `## [X.Y.Z]` heading with one bullet is something a person could type, so the
tree gate does not prove a release was prepared, and it never did — the manifest
half was written by a script too. The **number** is proved by
`check-release-train.ts --validate` at prepare time, and the **line** by the
provenance gate. This checker proves the tagged tree ships notes for its tag.

**The `tools/*` prerequisite for porting this checker to `main` is gone.** It
used to be that no part of `check-release-tree.ts` could be ported until
`main`'s `pnpm-workspace.yaml` lost its inert `tools/*` glob: the checker read
that file to decide which manifests it governed, and the per-glob zero-discovery
guard refused every tree cut from a line declaring a glob with no manifest under
it — `v2.1.4` was rejected on exactly that ground. The checker no longer reads
`pnpm-workspace.yaml` at all, so the glob is once again nothing but dead
configuration, and the checker, its liveness test, the `.husky/pre-push` caller
and the `release.yml` caller can be ported whenever a hotfix wants them. The
port itself is still work nobody has done.

**Merge commits are excluded from generated release notes.** `.cliff.toml`
skips commit *subjects* beginning `Merge `, which is the shape git writes by
default (`Merge pull request …`, `Merge branch …`). It is deliberately a subject
rule and not "is this a merge commit": a conventional `feat(x): merge …` or
`chore: merge …` is an ordinary commit and stays, and `[1.9.0]`'s
`chore:`-typed `Merge develop-2.0 into main` is the precedent. The cost of that
choice is that a merge given a custom subject (`git merge -m "sync train"`) is
still rendered. Consequence to expect: a candidate whose only new commits are
default-message merges — syncing `main` into the train, say — is **refused at
prepare time**, by the validator: the range it would render carries no
releasable commit, so it stops before either writer runs and nothing is written.
That is correct, a candidate with no changes should not exist, but it is a
behaviour change. The empty-section rejection in `check-release-tree.ts` is not
what refuses it — it is the backstop for an empty section that reaches the
release tree by another route. Existing `CHANGELOG.md` sections are not
rewritten.

**A `develop-X.Y` branch dies on merge into `main`** — it is not reactivated,
never backport onto a branch that has already been merged: the next feature
cycle opens a new `develop-(X+1).0`/`develop-X.(Y+1)` cut from `main`.
`dependabot.yml` doesn't target any `develop-*` (no `target-branch`, defaults
to the default branch `main`) — no update needed when the branch changes.

**When switching develop branch** (e.g. `develop-2.1` → `develop-2.2`):
update the branch name in three places — the `branches` list in
`.github/workflows/ci.yml` (`push` and `pull_request`), and
`env.RELEASE_TRAIN_BRANCH` in both `.github/workflows/security.yml` and
`.github/workflows/release.yml`. Miss ci.yml and CI silently stops running on
PRs targeting the new branch; miss release.yml and every RC tag is rejected by
the provenance gate; miss security.yml and the weekly OSV job goes red on a
branch that no longer exists — which is the intended reminder, not a bug.
`pnpm check:workflows` (inside `pnpm check:drift`) fails on all three, so this
is a checklist the build enforces rather than one to remember.
security.yml's `push` filter is **not** on the list: it matches `develop-*` and
`release/*` by pattern precisely so it never needs the edit. Then delete the
previous branch (local + remote): it's stale as soon as it's merged, keeping
it around invites bad backports.

**Documentation-only pushes skip CI by design.** A push whose complete
changed-path set falls inside the documentation ownership allowlist
(`push.paths-ignore` in `ci.yml`) intentionally gets no full CI run;
`.github/workflows/docs.yml` observes that same push and runs
`pnpm check:drift` instead, while `security.yml` stays path-blind and still
runs on every covered branch push. Because the documentation-only commit
carries forward the same runtime tree as the code-bearing commit before it,
the applicable runtime-gate evidence for that tree is the last code-bearing
push's CI run — not a CI run for the documentation-only SHA, which never
exists and should never be sought. The allowlist is fail-closed and pinned by
`tools/scripts/check-workflow-paths.ts`: change the checker and the workflows
together, never one without the other, and never widen CI's `paths-ignore`
with a global pattern like `**.md`. `CHANGELOG.md`, workflow files, Markdown
inside a source tree and test inputs/fixtures are not documentation-owned —
they must keep triggering full CI, so a test fixture belongs under its own
test tree, never under `docs/`. Never add a path filter to CI's
`pull_request` trigger, and never make the path-filtered `Documentation
drift` job a required check on `main` — either would leave a required check
Pending on every documentation PR.

**The two aggregate gates `main` will require.** `ci.yml` and `security.yml`
each declare one job whose only work is to fail unless every scan or check it
`needs` succeeded: `CI gate` and `Security gate`. `Security gate` stands for
every **PR-relevant** scan job — currently semgrep, gitleaks and OSV, not every
scan job in the file — and reports on every trigger but the weekly `schedule`;
what is new is that this now includes pull requests targeting `main`, with no
path filter on any trigger for the same reason given just above. Its
`pull_request` targets `main` only, so it is not part of the cycle-switch
checklist; it is to be required **eventually, and only on `main`**, never by a
`develop-*` or `release/*` ruleset — that would leave a required context behind
on a branch that dies at the end of the cycle.

**Both** gated workflows pin the same `pull_request` activity set — `opened`,
`synchronize`, `reopened`, `edited`. GitHub's default omits `edited`, which is
what retargeting a pull request fires: without the pin, moving a PR onto a
protected target produces no new run and leaves the required checks Pending on
a head SHA nothing judged. The weekly OSV jobs and the
failure notifier are deliberately outside it — they answer a disclosure landing
on unchanged code, and a push/schedule failure, neither of which a pull request
can report.

Both gates are pinned by
`tools/scripts/check-workflow-paths.ts`, which derives each `needs` list from
the workflow's own jobs, so a scan job added later is a build failure rather
than a silently ungated one. It also refuses `continue-on-error:` anywhere in
either gated workflow: that key turns a failure into the literal `success`,
which is the one result an aggregate gate accepts, so a tolerated job would be
green through the gate.

The remote half is **not** done, and neither is `main`'s half. `main` carries
**neither aggregate-gate implementation** — both jobs exist only on
`develop-2.2` — and `main`'s ruleset still requires the individual job names.
The `develop-2.2` version of `CI gate` is configured to report on pull requests
targeting `main` or the train; `Security gate` on pull requests targeting
`main`. Because the workflows a pull request is judged by are the ones on the
branch, the first real hotfix has to port versions of both coherent with `main`
before the ruleset can require either context. Do not describe either context
as required today.

Note also what this design does not buy: it protects against accidental
regressions and ordinary vulnerable changes, but it is not tamper-resistant — a
pull request that edits the workflow, the checker and the gate in the same diff
is judged by the version it is itself proposing.

## Security Testing / Pentest

- **Always target a real deployed hostname** (`rc.luke.febos.local`, prod
  domain) — **never** `localhost`/`host.docker.internal` against a local
  `pnpm dev`. `next dev` exposes stack traces, absolute paths and
  `next-devtools` to unauthenticated users by design: that's expected
  behavior, not a vulnerability. A scanner (Strix or other) launched inside a
  Docker container on the same dev machine reaches the local `pnpm dev` via
  the `host.docker.internal` alias and produces a "development mode
  disclosure" false positive that wastes triage time. RC and prod always run
  `next build` + `next start` behind a reverse proxy (see
  Dockerfile/docker-compose.*.yml) — only those hosts are valid scope for an
  assessment.

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) — feed the
CHANGELOG via `git-cliff`, validated by `.husky/commit-msg` (commitlint).

- Format: `<type>(<scope>)?: <description>`
- Types: `feat` (minor) | `fix` (patch) | `docs` | `style` | `refactor` | `perf` |
  `test` | `chore` | `ci`
- Breaking: `!` after the type (`feat!:`) or footer `BREAKING CHANGE: ...` —
  only for a supported compatibility contract, see **Versioning & Release**
- Recommended scopes: `core`, `api`, `web`, `nav`, and functional domains
  (`merch`, `pricing`, `rbac`, `sourcing`, `auth`, `dashboard`, `calendar`, `company`)
- **Always and only in English** — subject, body and footer. Same rule as
  code comments (rule 14): no Italian, no exception for domain vocabulary.
  The CHANGELOG is generated by `git-cliff` from these messages (see above),
  so it automatically inherits the rule — no separate enforcement needed on
  the CHANGELOG.md file.

Examples: `feat(calendar): add MilestoneDependency model` ·
`fix(rbac): correct section access fallback for editor role` ·
`feat(api)!: rename collection.rows to collection.layoutRows`
