# Luke Project — Claude Rules

## Rules of engagement (before every change)

1. List the files you intend to modify and explain your approach
2. Wait for confirmation if you touch more than 3 files or any of: RBAC/section definitions,
   AppConfigRegistry, pricing logic, the Prisma schema (`packages/db/prisma/*.prisma`), the release
   workflow, crypto or auth
3. **Never `git commit` without explicit approval** — show the diff, ask for confirmation, wait for
   the go-ahead, then commit

## Canonical Language and Documentation Impact

- Write all technical prose — documentation, repository instructions, source comments,
  developer-facing diagnostics and logs — in English, whatever the language of the conversation.
  Italian is allowed only in genuine product UI and end-user interaction, pending the i18n cycle:
  the audience decides, not the file the text sits in.
- Quote product UI text in documentation as a code span (`` `Salva` ``).
- Italian documentation is only ever derived from the English source; do not design a translation
  layout or pipeline before a derived translation is authorized.
- An Italian historical record is translated meaning-preservingly or retired, an owner decision per
  document; a retired record keeps an English entry in the index that listed it, with its last path
  and the commit that holds it.
- An Accepted ADR's Context, Decision and Consequences are never edited; its Status changes only for
  an authorized supersession or deprecation. A statement of fact about the repository it no longer
  matches gets a dated entry in its final `## Errata`; anything that changes what it decides, requires or rejects needs a
  new ADR.
- Before staging or requesting commit approval for a code change, report
  `Documentation impact: none` with evidence, or `Documentation impact: update required` with the
  affected material and why.
- For changes to architecture, public or API behavior, configuration, operations, release or
  deployment, developer workflows or repository structure, invoke `/luke-docs audit` automatically.
  The audit is read-only; documentation writes are reviewed separately.

Rationale:
`docs/decisions/030-documentation-architecture-canonical-language-and-historical-records.md`.
Operational learning: [current lessons](lessons.md), [lessons archive](lessons-archive.md).

## Monorepo

```
apps/
  web/          → Next.js + shadcn/ui (frontend, port 3000)
  api/          → Fastify + tRPC + Prisma (backend, port 3001)
packages/
  core/         → @luke/core: schemas, RBAC, pricing, storage, crypto, URL utils
  db/           → @luke/db: Prisma schema, migrations, generated client, createPrismaClient
  nav/          → @luke/nav: NAV sync layer
  calendar/     → @luke/calendar: calendar domain, Google sync, ICS generation
  eslint-plugin-luke/ → custom ESLint rules
```

- **No version numbers in this file**: read them from the workspace manifests
  (`apps/*/package.json`, `packages/*/package.json`, the root `package.json` for `engines` and
  `packageManager`) and their configs. `/luke-deps platform` keeps them coherent.
- `pnpm dev` starts everything via Turbo. If the API fails with "Cannot find module
  @luke/core/dist", stop `pnpm dev` and run `pnpm --filter @luke/core build`; a stale Turbo cache
  can also leave a `dist` missing.
- `apps/web` resolves `@luke/api` to its `dist` declarations: the API's `dev:types` watch refreshes
  them while dev runs; with dev stopped, `pnpm --filter @luke/api build` does.
- Never run emitting builds or tests (`pnpm build`, `pnpm test`, `pnpm typecheck`, the pre-push
  hook) in a worktree where `pnpm dev` runs: an interrupted build leaves a partial `dist`. Use a
  second worktree, or stop dev. `scripts/assert-no-dev.sh` refuses for the pre-push hook and the
  root rebuild scripts; before `pnpm --filter <pkg> build` or a bare `turbo run`, run it yourself.

## Stack Constraints

- **Package manager**: pnpm only — never npm or yarn. `pnpm --filter <app> <script>` from the root,
  or `pnpm -C <dir>`.
- **ORM**: Prisma, owned by `@luke/db` — the schema (`packages/db/prisma/*.prisma`: one file per
  domain plus a `schema.prisma` header), the migrations, `prisma.config.ts` and the generated client
  all live there. Import every Prisma type from `@luke/db`, never from `@prisma/client`
  (`@luke/no-restricted-module-references`); construct a client only through `createPrismaClient`
  (`.semgrep/rules/prisma-client-instantiation.yml`). Run `prisma` CLI commands from `packages/db/`.
  Domain seeds and the `db:*` operational scripts stay in `@luke/api`. `apps/api` keeps
  `@prisma/client` as a devDependency: its emitted declarations need it
  (`DECLARATION_GRAPH_DEPENDENCIES` in `tools/scripts/check-platform-integrity.ts`).
- **Raw SQL** only in `packages/nav/src/`, never in application logic. Exceptions, each with a
  justifying comment: the health-probe `SELECT 1` (`observability/readiness.ts`); a
  transaction-scoped advisory lock (`pg_advisory_xact_lock`, e.g. `acquireLastAdminLock`) inside an
  interactive `$transaction`; application-domain queries that need SQL the ORM cannot express (e.g.
  `DISTINCT ON` + `json_agg ... FILTER`) — always the `Prisma.sql` tagged template, never
  `$queryRawUnsafe`/`$executeRawUnsafe`.
- **API layer**: tRPC for all dashboard/UI routes; direct Prisma for AI agent queries.
- **Validation**: Zod schemas from `@luke/core` — never redefine inline. The catalog is
  `packages/core/src/schemas/`: check there before creating a new one.
- **TypeScript**: strict mode — no `any`, no type assertion without an explanatory comment.
- **URLs in frontend**: never hardcode `localhost:3001` in `apps/web/src` — use `buildApiUrl()`,
  `buildTrpcUrl()` from `@luke/core` (the package publishes only `.`, `./server` and
  `./utils/date`). Enforced by `.semgrep/rules/no-hardcoded-api-url.yml`.

## Development Patterns — Mandatory Rules

1. **`$transaction` for every multi-table write** — writes to 2+ related tables always go inside
   `prisma.$transaction(async tx => { ... })`
2. **Individual try/catch in sync batches** — in `syncAll()` and similar, every `await syncXxx()`
   has its own try/catch: one error must not block the others
3. **Check-then-act must hold** — "read → validate → write" needs something that keeps the checked
   condition true until the write commits: a database constraint, a conditional write
   (`updateMany`/`deleteMany` carrying the condition, then its count), or a lock
   (`pg_advisory_xact_lock`, as `acquireLastAdminLock`) inside a `$transaction`. A `$transaction`
   alone is not enough: under READ COMMITTED its read holds nothing. A foreign key counts only for
   the property it enforces, and its refusal gets the check's answer, not a 500
   (`isForeignKeyViolation` in `apps/api/src/lib/error.ts`)
4. **Audit logging on every mutation** — create/update/delete/restore/unlink → `withAuditLog`
   (`apps/api/src/lib/auditMiddleware.ts`) or `logAudit()` (`apps/api/src/lib/auditLog.ts`).
   Metadata keys are typed against `SAFE_KEY_LIST`: adding one is a decision that it is safe to
   persist. `metadata` is a spread-free object literal (`@luke/audit-metadata-object-literal`):
   write `x: cond ? v : undefined`, never `...(cond && { x: v })`. A key whose value is a map goes
   in `MAP_VALUED_KEYS`. Pre-session flows (login, email verification, password reset) write
   `actorId: null` and must still set `targetId` to the `User.id`
5. **`requirePermission()` on every protected endpoint** — READ → `entity:read`, CREATE →
   `entity:create`, etc.; never `update` for a read-only query. An endpoint that works only on the
   caller's own data uses `selfProcedure` (`apps/api/src/lib/trpc.ts`); one whose check
   `requirePermission` cannot express, or that is open to every signed-in user by design, carries a
   reasoned `// nosemgrep`. Enforced by `.semgrep/rules/procedure-requires-permission.yml`
6. **Explicit `onDelete` on every Prisma `@relation`** — default `onDelete: Restrict`; `Cascade`
   only if intentional and commented (P13 in `tools/scripts/check-platform-integrity.ts`)
7. **Never duplicate schema/types** — if it exists in `@luke/core`, import it from there
8. **Indexes on FKs and filtered columns** — every FK and every column used in a WHERE (`isActive`,
   `vendorId`, ...) → `@@index([field])`. P13 checks the FK half only
9. **One version per external dependency** across the workspace manifests (P1); after every upgrade,
   align them all
10. **Never `console.*`** — API: `logger.*` (Pino); Web: `debugLog`/`debugWarn`/`debugError` from
    `lib/debug.ts`
11. **Context-dependent queries: explicit params** — every tRPC procedure that depends on
    brand/season receives `brandId`/`seasonId` as explicit Zod inputs, never from `userPreference`
    server-side. The frontend passes them from `useAppContext()` with
    `enabled: !!brand?.id && !!season?.id`. Reference: `pricing.parameterSets.list`
12. **Auth-adjacent endpoint → double rate limit (IP + account)** — login and every endpoint that
    verifies credentials or tokens has a `keyBy: 'ip'` bucket and one keyed on the identity
    (username/account). Reference: `login` + `loginByUsername` in `apps/api/src/lib/ratelimit.ts`
13. **Server-to-server web→api calls forward the real client IP** — every fetch `apps/web` makes to
    `apps/api` on behalf of a user sends `X-Forwarded-For` through `forwardedFor()`
    (`lib/clientIp.ts`), inline in the call's headers
    (`.semgrep/rules/server-api-call-forwarded-for.yml`); without it every `keyBy: 'ip'` bucket
    collapses onto the web container. A new `keyBy: 'ip'` bucket on such a path comes with a test
    proving per-client behavior (see `blocks valid credentials too` in
    `apps/api/test/ratelimit.integration.spec.ts`). The proxy trust boundary is
    `apps/api/src/lib/trustProxy.ts`: never broaden it, or expose apps/api directly, without review
14. **Code comments always in English** — `//`, `/** */`, Prisma `///`, **including domain terms**
    (`stagione` → season, `campionario` → collection/catalog, `reso` → return). Merge logic on
    existing comments: `.claude/skills/luke-docs/references/inline-rules.md`
15. **An allowlist that gates persisted or displayed data is bound to a type** — every
    hand-maintained list of permitted keys/values (`SAFE_KEY_LIST`, `PRICING_CURRENCIES`, storage
    buckets, ...) gets `as const` plus a derived union used in its consumers' signatures, so a value
    outside it fails `tsc`. Such filters fail closed and silently. Never stack a second allowlist in
    front of the authoritative one

### Soft delete pattern

- `remove()`: `isActive=false` — never hard delete; `restore()`: `isActive=true`
- `list()`: filters `isActive=true` by default; `includeInactive=true` for admin
- Inactive row in a table: `className={!item.isActive ? 'opacity-50' : undefined}`

## AppConfig System

All runtime configuration lives in the `AppConfig` table (Postgres KV), and `AppConfigRegistry` in
`packages/core/src/schemas/config.ts` is the **single source of truth**. Rationale: ADR-018.

- **Never `process.env.*` in application code** — read AppConfig with `getConfig`, `getTypedConfig`
  or `getConfigOrDefault` (`apps/api/src/lib/configManager.ts`) or the tRPC config router. Env vars
  only for bootstrap
- **Every new config key goes in `AppConfigRegistry`** with its Zod schema, numeric bounds included
  — `saveConfig` validates against it before writing. Never widen a schema to accommodate a write:
  "not configured" is an absent key (a `null` entry in a `saveConfigs` batch, or `deleteConfig`),
  never `''`
- **A form that writes several keys calls `saveConfigs` once**, so a failure leaves the stored form
  as it was (`apps/api/test/configFormAtomicity.integration.spec.ts`)
- Stored values are strings: `z.coerce.*` for numbers, `booleanConfigSchema` for booleans,
  `jsonConfigSchema(Inner)` for JSON — never a bare `.transform(s => Inner.parse(JSON.parse(s)))`,
  which throws through `safeParse`
- **Defaults live once in `APP_CONFIG_DEFAULTS`**, in the stored string form; read such a key with
  `getConfigOrDefault`, never with a call-site fallback or coercion. Credentials have no default:
  their readers refuse to start (`loadS3Provider`, `getSmtpConfig`)
- `getConfig` decrypts encrypted rows by default; for numbers and booleans use the typed readers,
  never `parseInt`/`=== 'true'` on its result
- `CRITICAL_CONFIG_KEYS`: only `auth.strategy`. Add a key only if its absence must block boot

## Auth & Crypto — DO NOT TOUCH without an explicit request

- Master key: `~/.luke/secret.key` (32 bytes, mode 0600), auto-generated on first boot. Its scope,
  derived secrets and rotation limits: ADR-020
- Crypto utilities are **server-only** — import from `@luke/core/server`, never from `@luke/core`
  (throws in the browser)
- `packages/core/src/crypto/secrets.server.ts` — don't modify without a comment explaining the
  security intent

## RBAC & Section Access

Two distinct layers that must stay in sync.

**Layer 1 — Resource:Action** (`packages/core/src/auth/permissions.ts`): roles `admin` (`*:*`),
`editor`, `viewer`.

- Always `hasPermission(user, 'resource:action')` — never inline `user.role === 'admin'`
- Every protected tRPC endpoint: Development Patterns rule 5
- An admin-only operation on a resource `editor` holds through `resource:*` (e.g. a hard delete), or
  one that acts on authorization itself (section access management), requires `*:*` (ADR-029)

**Layer 2 — Section visibility** (dot-notation: `product.pricing`, `settings.ldap`, ...):

- `effectiveSectionAccess()` resolves a leaf section by kill switch → user override → role default →
  RBAC fallback; a parent is on iff at least one of its children is, takes no override, and a parent in the
  kill switch disables its group. The role default is `SECTION_ACCESS_DEFAULTS` with
  `rbac.sectionAccessDefaults` merged over it per section (ADR-027)
- **New section = update THREE places in sync**: `sectionEnum`, `SECTION_TO_PERMISSION`,
  `SECTION_ACCESS_DEFAULTS` (all three roles)
- `withSectionAccess` guards only a section without children (it throws when the procedure is
  built); `Resource:Action` stays the API boundary
- `saveConfig`, `saveConfigs` and `deleteConfig` invalidate the RBAC cache when they write an
  `rbac.*` key or `app.sections.disabled`; a write to those keys that bypasses them calls
  `invalidateRbacCache()` after it commits

## LDAP

- Four strategies via `auth.strategy`: `local-first` | `ldap-first` | `local-only` | `ldap-only` —
  never hardcode
- Circuit breaker active (`auth.ldap.resilience.*`) — don't bypass the resilience wrapper
- `auth.ldap.roleMapping`: JSON string mapping LDAP groups → Luke roles

## Pricing Engine

- Three modes in `PricingModeSchema`: `forward` | `inverse` | `margin`
- **Write reserved to admin** — `pricing:update` is not in the editor role. Never expose
  parameter-set mutations to the editor
- `PricingParameterSetInputSchema` defines all fields; calculations are always scoped to `brandId` +
  `seasonId`
- Currencies: only those in `PRICING_CURRENCIES` (`packages/core/src/schemas/pricing.ts`)

## Collection Layout

Two-level model: **Groups** contain **Rows**, independent ordering.

- At most `COLLECTION_COLUMNS_MAX_VISIBLE` toggleable columns visible at once, besides the
  always-visible `#`, `line`, `skuForecast`, `actions`; hidden by default:
  `COLLECTION_COLUMNS_DEFAULT_HIDDEN`
- Gender: `COLLECTION_GENDER`. Strategy, line status and the other dropdown values come from the
  `CollectionCatalogItem` catalog, progress from the phase catalog (`phaseId`) — never a hardcoded
  list; `COLLECTION_STRATEGY`/`COLLECTION_STATUS` are only the catalog's default values
- `skuBudget` belongs to the Group, `skuForecast` to the Row — don't swap them
- Photo upload: `buildCollectionRowPictureUploadUrl(rowId)` — never manual paths

## Storage Layer

- Never handle files outside an `IStorageProvider` implementation
- Valid buckets: `APP_STORAGE_BUCKETS` in `packages/core/src/storage/types.ts` is the only list —
  `isValidBucket()` derives from it
- Always use the URL builders in `@luke/core` — never construct `/upload/...` paths by hand
- `storage.local.enableProxy`: read from config, never hardcoded

## NAV / packages/nav

NAV table details and sync decisions: `docs/nav-integration.md`

- Table names: always `[${sanitizeCompany(config.company)}$TableName]`
- `packages/nav` does NOT import from `apps/api` — config is injected via `GetConfigFn`
- New sync modules: `buildNavSyncFilter` + `buildWhereClause` + `processInBatches` from
  `sync/utils.ts`, batches of 100, requests from `createSyncRequest`
- Wrap NAV replica + local upsert in `prisma.$transaction()` (Development Patterns rule 1)
- Never auto-reactivate soft-deleted entities during sync; sync only updates fields coming FROM NAV
  (typically `name`) — never `isActive` nor enriched fields
- New queries/types: `packages/nav/src/queries/` and `packages/nav/src/types/`
- `Brand.code` max 20 chars, `Season.code` max 10 chars (NAV nvarchar)
- DAB: only an LLM→NAV bridge, never the sync layer

## Frontend — apps/web

### shadcn/ui strict

- Only shadcn/ui components — never import Radix directly, never MUI. New components via CLI:
  `pnpm dlx shadcn@latest add <component>`
- Tailwind utility classes only — no `style={{}}`, no CSS modules. Arbitrary values (`w-[327px]`)
  only with a justifying comment
- Colors via CSS variables (`--background`, `--primary`, ...) — never hardcoded hex/rgb
- className always via `cn()` from `lib/utils`; multiple variants → CVA

### Mandatory UI Patterns

**Permission-aware UI** (consistent across all pages):

- Creation buttons: `<CreateActionButton>` — always visible, disabled + tooltip without the
  permission
- Table actions: Edit/Delete always visible, disabled + tooltip without the permission, message "You
  don't have permission to [action] [resource]". Always `<PermissionButton>`, or
  `<PermissionTooltip>` when the control is not a `Button` — never a hand-rolled wrapper
  (`@luke/no-unreachable-disabled-tooltip`)
- One tooltip per control; group only controls that share the exact same message
- `TooltipProvider` is mounted once, in `components/Providers.tsx` — never add another: a local one
  makes neighbouring tooltips re-wait the full delay
- Config pages (mail, storage, LDAP): save button gated on `can('config:update')`

**Delete confirmation**: always `<ConfirmDialog>` from `components/ConfirmDialog.tsx` — never
`globalThis.confirm()`.

**Permission hooks**: `usePermission`: `can()`, `isAuthenticated()` — YES parentheses. There is no
role helper on purpose: check a permission, never a role name.

**Error handling**: `getTrpcErrorMessage(error, entityOverrides?)` from `lib/trpcErrorMessages.ts`

**i18n (future)**: don't block current work on it, but keep dates, numbers and UI strings
extractable — no hardcoded strings deep in nested components.

**Import order**: groups builtin, external, internal (`@luke/**`, `@/**`), parent, sibling, index,
type — a blank line between groups, alphabetical within each. Enforced by `import-x/order` in
`eslint.config.mjs`; run `pnpm exec eslint --fix <files>`.

## Env Policy — Firm Architectural Rule

`.env` allows ONLY infrastructural bootstrap. Everything else goes in AppConfig.

**Allowed in API `.env`**: `DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`, `LUKE_CORS_ALLOWED_ORIGINS`,
`LUKE_TRUSTED_PROXY_CIDR`, `OTEL_*`, `LOG_LEVEL`, `APP_VERSION`. An invalid
`LUKE_TRUSTED_PROXY_CIDR` stops apps/api at boot, and so does a missing one in production
(`apps/api/src/lib/trustProxy.ts`).

**Allowed in Web `.env`** (framework exceptions): `INTERNAL_API_URL`, `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_FRONTEND_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `COOKIE_SECURE`,
`NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_LUKE_DEBUG_UI`.

`APP_VERSION` and `NEXT_PUBLIC_APP_VERSION` are build-time metadata injected as a Docker `ARG`/`ENV`
from the git tag in CI — never read from AppConfig.

**Forbidden in `.env`**: SMTP, LDAP, storage credentials, tokens, application passwords.
`assertEnvPolicy()` in `apps/api/src/server.ts` blocks apps/api's boot in production on `SMTP_*`,
`LDAP_*`, `JWT_*`, `NEXTAUTH_*`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`.

## Prisma Migration Workflow

Every physical datamodel change — a model, enum, field, relation, mapping, default, index or
constraint, in any `packages/db/prisma/*.prisma` file — requires a versioned migration. A change
confined to `generator`/`datasource` in `schema.prisma` does not, when `prisma migrate diff` proves
no physical difference. Workflow (temporary Postgres on port 5433 → `migrate dev` → `db push` on
5432 → commit the migration file): **`docs/prisma-migration-workflow.md`**

In production `entrypoint.sh` runs `prisma migrate deploy`. Never `prisma migrate reset` in
production.

## Versioning & Release

Rationale: `docs/decisions/033-release-identity-versioning-contract-and-release-trains.md`.

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
mid-train it kills the running train, so the major ships as a new one — see the
frozen-target note below.

**Release workflow** (`pnpm release:prepare`, wraps `scripts/release-prepare.sh`):

1. `pnpm release:prepare <tag>` — the supported entry point, and the only one.
   **You name the release.** The script refreshes the tags and `origin/main` itself and fails
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
   `--tags` (`.husky/pre-push` refuses more than one release tag per push).
   The hook runs the same tree checker on the object being
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

The validator refuses a tag that exists anywhere, notes for it already committed
at HEAD (a preparation committed and never tagged), a base that is not
reachable, a stable tag on another line that outranks that base (merge the
hotfix first), a target that is not the live train's frozen one, an rc counter
that skips, a range with nothing releasable in it, a graduation whose tree is
not its last candidate's (`CHANGELOG.md` aside), and — the SemVer rule above
made mechanical — **any version below the minimum bump** git-cliff computes for
the commits since the base, a running train's next candidate included. Equal to
the minimum or higher passes; there is no override flag, because a gate that can
be waived on the day it is inconvenient is not a gate. Nothing is written until
every one of those has passed.

**RC trains**: a release train produces several candidates for **one** stable
target — `vX.Y.Z-rc.1`, `rc.2`, … then `vX.Y.Z` — never a new stable version
per candidate. Name the candidate (`pnpm release:prepare v3.0.0-rc.2`) and the
validator checks it against the train it can see: the target must be the one
already cut, and the counter must advance by exactly one.

The target is **frozen when rc.1 is cut**: while the train is live, the
candidate after `v2.2.0-rc.1` is `v2.2.0-rc.2`, never `v3.0.0-rc.1` — a train
has one target. A train is **live** while its target is above the base and not
below the minimum bump. A `feat!` landing mid-train raises that minimum to
major, and the train **dies at once**: `v2.2.0` can never be published, so its
next candidate and its graduation are both refused. Its rc tags stay as
history — none needs deleting — and the breaking change is
released by starting a new train at the higher version: `v3.0.0-rc.1` is an
ordinary first candidate, its notes covering everything since the base.

**A graduation publishes its last candidate unchanged.** `vX.Y.Z` is prepared
only when HEAD's tree is the tree of the live train's latest candidate,
`CHANGELOG.md` aside: the stable images are rebuilt from the tag, so anything
else changed after that candidate would reach `latest` without ever having
shipped in one. It is proved at prepare time on HEAD, and again on the tagged
commit at push and in `release.yml` — the notes commit is the only difference
the stable tag may carry. One function, `checkGraduation` in
`check-release-tree.ts`, answers all three. After the last candidate the train
is frozen until it graduates; a later change to anything but `CHANGELOG.md` — a
documentation fix, a hotfix merged from `main` — ships by cutting the next
candidate first, and it has to reach the train in a releasable commit: a change
carried only by commits `.cliff.toml` skips (a conflict resolution inside a
`Merge …`, a `style:`, a `chore(release)`) cannot be cut as a candidate either.
Graduate right after merging the train into `main`, with a merge commit — a
squash merge leaves the candidates unreachable and is refused. Until the stable
tag exists the train is still live: a change that reached `main` in between goes
back through it — `git merge --no-ff main` into the train (a fast-forward would
put the train's tip on `main`, where no candidate can be cut), cut the next
candidate, merge again.

**Release flow**: push to `main` → CI only (lint + typecheck);
tag `vX.Y.Z` → provenance gate → Docker build → `ghcr.io` → Portainer pull &
redeploy. RC artifacts come from the active release train and publish
`rc-latest`; stable artifacts come from `main` and publish `latest` + `X.Y`.
A tag on the wrong line, or a tag name outside those two shapes, fails before
any image is built (`tools/scripts/check-release-provenance.ts`).
**NEVER delete the `luke_api_data` volume** — the master key lives there.

**A runtime image carries runtime dependencies only.** The API image takes its
`node_modules` from a `--prod` install of `@luke/api`'s closure (stage
`deps-prod`), the web image is Next's standalone output; neither copies the
builder's tree. `tools/scripts/check-image-runtime.ts` proves it from inside
each image — CI's `images` job on every push and pull request, and
`release.yml` on the exact image before it pushes. Rationale:
`docs/decisions/028-runtime-images-carry-runtime-dependencies-only.md`.

**The tagged tree must claim its own tag.** Immediately after the provenance
gate, the same job runs `tools/scripts/check-release-tree.ts` on the exact
commit the gate resolved (`steps.gate.outputs.sha`, passed through `env`), and
a failure skips `verify` and both image jobs. It proves, against **that tree**
and never the working tree, that `CHANGELOG.md` has exactly one
`## [<version>]` heading for `parseReleaseTag(tag).version` — optionally dated —
with at least one `- ` entry under it. A duplicate heading, an entry that
actually belongs to the next section or to the historical footer, and any
`## [Unreleased]` heading are all rejections. For a stable tag that graduates a
train it also proves the tree is the highest candidate of that version
unchanged, `CHANGELOG.md` aside; the job fetches the release tags explicitly so
a candidate the remote holds cannot read as "no graduation". The same checker is
what `release:prepare` and `.husky/pre-push` run, so one contract has one
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
provenance gate. This checker proves the tagged tree ships notes for its tag
and, for a graduation, that it is its last candidate unchanged.

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

**A `develop-X.Y` branch dies when its train graduates** — when the stable tag
is cut from its merge into `main`, not at the merge itself: until that tag
exists the graduation rule above may still send a change back through it. Once
graduated it is not reactivated, never backport onto it: the next feature
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
previous branch locally: it's stale as soon as it has graduated, and keeping
it around invites bad backports. The owner deletes it from the remote right
after its stable tag is cut — ruleset 22082018 forbids deleting `develop-*`
until the owner lifts that rule — so the provenance gate stops accepting
candidates from it.

**Documentation-only pushes skip CI by design — on `develop-2.2`.** A push
whose complete changed-path set falls inside the documentation ownership
allowlist (`push.paths-ignore` in that branch's `ci.yml`) intentionally gets no
full CI run; `.github/workflows/docs.yml` observes that same push and runs
`pnpm check:drift` instead, while `security.yml` stays path-blind and still
runs on every covered branch push. Because the documentation-only commit
carries forward the same runtime tree as the code-bearing commit before it,
the applicable runtime-gate evidence for that tree is the last code-bearing
push's CI run — not a CI run for the documentation-only SHA, which never
exists and should never be sought.

`main` has neither half of that mechanism: no `paths-ignore` on its `push`
trigger and no `docs.yml`. A documentation-only push to `main` therefore runs
**full CI**, and the drift check is not lost — `main`'s `checks` job carries
its own `Docs & skills drift` step running `pnpm check:drift`. So the
documentation routing is a `develop-2.2` property, not a repository-wide one,
and porting it to `main` is an open residual (Appendix X §X.10). The allowlist
is fail-closed and pinned by `tools/scripts/check-workflow-paths.ts`, which
likewise exists only on `develop-2.2`: change the checker and the workflows
together, never one without the other, and never widen CI's `paths-ignore`
with a global pattern like `**.md`. `CHANGELOG.md`, workflow files, Markdown
inside a source tree and test inputs/fixtures are not documentation-owned —
they must keep triggering full CI, so a test fixture belongs under its own
test tree, never under `docs/`. Never add a path filter to CI's
`pull_request` trigger, and never make the path-filtered `Documentation
drift` job a required check on `main` — either would leave a required check
Pending on every documentation PR.

**The two aggregate gates `main` requires.** `ci.yml` and `security.yml`
each declare one job whose only work is to fail unless every scan or check it
`needs` succeeded: `CI gate` and `Security gate`. `Security gate` stands for
every **PR-relevant** scan job — currently semgrep, gitleaks and OSV, not every
scan job in the file — and reports on every trigger but the weekly `schedule`;
what is new is that this now includes pull requests targeting `main`, with no
path filter on any trigger for the same reason given just above. Its
`pull_request` targets `main` only, so it is not part of the cycle-switch
checklist; it is required **only on `main`**, never by a `develop-*` or
`release/*` ruleset — that would leave a required context behind on a branch
that dies at the end of the cycle.

**Both** gated workflows pin the same `pull_request` activity set — `opened`,
`synchronize`, `reopened`, `edited`. GitHub's default omits `edited`, which is
what retargeting a pull request fires: without the pin, moving a PR onto a
protected target produces no new run and leaves the required checks Pending on
a head SHA nothing judged. The weekly OSV jobs and the
failure notifier are deliberately outside it — they answer a disclosure landing
on unchanged code, and a push/schedule failure, neither of which a pull request
can report.

Both gates **on `develop-2.2`** are pinned by
`tools/scripts/check-workflow-paths.ts`, which derives each `needs` list from
the workflow's own jobs, so a scan job added later is a build failure rather
than a silently ungated one. It also refuses `continue-on-error:` anywhere in
either gated workflow: that key turns a failure into the literal `success`,
which is the one result an aggregate gate accepts, so a tolerated job would be
green through the gate. That checker does not exist on `main`. The gates there
are enforced by the ruleset but their dependency lists are **not** mechanically
checked: a job added to `main`'s `ci.yml`, or a scan added to its
`security.yml`, without the matching `needs` entry would be silently ungated,
and the required context would report success over work it never waited for.
Porting the checker to `main` is an open residual, tracked separately from the
`check-release-tree.ts` port described in the release section above.

The main-side implementation and the required-context transition — the two
halves this section recorded as outstanding — are both done. `main` carries
both aggregate-gate implementations as of `388ff776`, and the `main review gate` ruleset requires exactly `CI gate`
and `Security gate` — strict, active, no bypass actors — in place of the
individual job names it used to list. `main`'s `CI gate` needs `checks`,
`integration`, `migrations` and `web-image`, the jobs that branch actually has;
the `develop-2.2` version needs `checks`, `browser`, `integration`,
`migrations` and `images`, and the two lists are meant to differ. `CI gate` reports on pull requests targeting `main` or the train;
`Security gate` on pull requests targeting `main`. Because the workflows a pull
request is judged by are the ones on its own branch, a change to either gate
has to land on `main` itself before `main`'s ruleset can depend on the new
shape. The port, the transition and their evidence are recorded in
`docs/LUKE_MONOREPO_AUDIT_2026-08-30.md`, Appendix X.

Note also what this design does not buy: it protects against accidental
regressions and ordinary vulnerable changes, but it is not tamper-resistant — a
pull request that edits the workflow, the checker and the gate in the same diff
is judged by the version it is itself proposing.

## Security Testing / Pentest

- Scan only real deployed hostnames (`rc.luke.febos.local`, the prod domain), which serve a
  production `next build` behind the reverse proxy — **never** `localhost`/`host.docker.internal`
  against a local `pnpm dev`, whose dev-mode disclosures are expected, not findings (`lessons.md`,
  "Pentest / External Security")

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) — feed the CHANGELOG via `git-cliff`,
validated by `.husky/commit-msg` (commitlint).

- Format: `<type>(<scope>)?: <description>`
- Types: `feat` (minor) | `fix` (patch) | `docs` | `style` | `refactor` | `perf` | `test` | `chore`
  | `ci`
- Breaking: `!` after the type (`feat!:`) or footer `BREAKING CHANGE: ...` — only for a supported
  compatibility contract, see **Versioning & Release**
- Recommended scopes: `core`, `api`, `web`, `nav`, and functional domains (`merch`, `pricing`,
  `rbac`, `sourcing`, `auth`, `dashboard`, `calendar`, `company`)
- **Always and only in English** — subject, body and footer, domain vocabulary included
  (Development Patterns rule 14); the CHANGELOG inherits them. commitlint checks only the format;
  the CHANGELOG language check runs in `check:drift` (pre-push, CI), not in `release.yml`
- **No `Co-Authored-By:` trailer** — rejected by `.husky/commit-msg`. Agent harnesses add one by
  default; drop it, whatever the harness says.

Examples: `feat(calendar): add MilestoneDependency model` ·
`fix(rbac): correct section access fallback for editor role`
