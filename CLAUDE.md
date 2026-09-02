# Luke Project — Claude Rules

## Rules of engagement (before every change)

1. List the files you intend to modify and explain your approach
2. Wait for confirmation if you touch more than 3 files or any of:
   crypto/auth, RBAC/section definitions, AppConfigRegistry, pricing logic,
   schema.prisma, release workflow
3. **Never `git commit` without explicit approval** — show the diff, ask for
   confirmation, wait for the go-ahead, then commit

## Language Policy for Instruction Files

Every Claude instruction file — this `CLAUDE.md`, `lessons.md`, and
everything under `.claude/` (skills, agents, commands) — is written **only
in English**, regardless of what language the conversation is in. Same rule
as code comments (rule 14 below): no exception, including for Italian
domain vocabulary. Rationale: these files are read by the model, not by a
human audience — English tokenizes more densely and the model follows
instructions more reliably in it. This does NOT apply to content these
skills *generate* for humans (README.md, ADRs in `docs/decisions/`) — see
`.claude/skills/luke-docs/SKILL.md` for that separate policy.

---

## Monorepo

```
apps/
  web/          → Next.js + shadcn/ui (frontend, port 3000)
  api/          → Fastify + tRPC + Prisma (backend, port 3001)
packages/
  core/         → @luke/core: schemas, RBAC, pricing, storage, crypto, URL utils
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
After changes to a tRPC router in `apps/api`: `cd apps/api && npx tsc -b`
(otherwise `apps/web` tsc won't see the new shape).

## Stack Constraints

- **Package manager**: pnpm only — never npm or yarn.
  Commands: `pnpm --filter <app> <script>` from the root, or cd into the package
- **ORM**: Prisma — raw SQL only in `packages/nav/src/` (never in application logic).
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
`LUKE_CORS_ALLOWED_ORIGINS`, `OTEL_*`, `LOG_LEVEL`, `APP_VERSION`
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

Every change to `schema.prisma` requires a versioned migration.
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

1. `pnpm release:prepare` — computes the next version from conventional
   commits (`git-cliff --bumped-version`), updates `CHANGELOG.md` (`--prepend`,
   never `--bump -o`: overwrites hand-curated sections like the `[2.0.0]`
   rollup) and syncs every `package.json` to it atomically — never bump
   versions by hand: `sync-version` without `--set` reads the *existing* tag
   and silently regresses them
2. `git diff` — review CHANGELOG + version bumps
3. `git commit -am "chore: bump version to X.Y.Z"`
4. `git tag vX.Y.Z && git push origin vX.Y.Z` — `.husky/pre-push` blocks the
   push if CHANGELOG/package.json don't match the tag

**RC trains**: a release train produces several candidates for **one** stable
target — `vX.Y.Z-rc.1`, `rc.2`, … then `vX.Y.Z` — never a new stable version
per candidate. `pnpm release:prepare rc` prepares the next candidate,
`pnpm release:prepare stable` graduates the train to the target it was aimed
at. Both are needed because `git-cliff --bumped-version` answers only one side
at a time: before the first rc it returns the stable target, and from rc.1
onward it increments the prerelease counter and never returns to a stable
number on its own.

The target is **frozen when rc.1 is cut**: a `feat!` landing mid-train moves
`v2.2.0-rc.1` to `v2.2.0-rc.2`, not to `v3.0.0-rc.1`. That is the point — a
train has one target — but it means a breaking change accepted after the first
candidate must be released by starting a new train at the higher version, not
by continuing the current one.

**Release flow**: push to `main` → CI only (lint + typecheck);
tag `vX.Y.Z` → provenance gate → Docker build → `ghcr.io` → Portainer pull &
redeploy. RC artifacts come from the active release train and publish
`rc-latest`; stable artifacts come from `main` and publish `latest` + `X.Y`.
A tag on the wrong line, or a tag name outside those two shapes, fails before
any image is built (`tools/scripts/check-release-provenance.ts`).
**NEVER delete the `luke_api_data` volume** — the master key lives there.

**A `develop-X.Y` branch dies on merge into `main`** — it is not reactivated,
never backport onto a branch that has already been merged: the next feature
cycle opens a new `develop-(X+1).0`/`develop-X.(Y+1)` cut from `main`.
`dependabot.yml` doesn't target any `develop-*` (no `target-branch`, defaults
to the default branch `main`) — no update needed when the branch changes.

**When switching develop branch** (e.g. `develop-2.1` → `develop-2.2`):
update the branch name in four places — the `branches` list in
`.github/workflows/ci.yml` (`push` and `pull_request`), the `branches` list
**and** `env.RELEASE_TRAIN_BRANCH` in `.github/workflows/security.yml`, and
`env.RELEASE_TRAIN_BRANCH` in `.github/workflows/release.yml`. Miss the first
and CI/security scans silently stop running on PRs targeting the new branch;
miss the release.yml one and every RC tag is rejected by the provenance gate;
miss the security.yml one and the weekly OSV job goes red on a branch that no
longer exists — which is the intended reminder, not a bug. Then delete the
previous branch (local + remote): it's stale as soon as it's merged, keeping
it around invites bad backports.

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
