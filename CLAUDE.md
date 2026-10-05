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
Procedure: `README.md` (Release), `tools/README.md`; mechanics: `tools/scripts/check-release-*.ts`.

**SemVer**: `patch` = fix/refactor/chore/migration without a feature; `minor` = new visible
functionality; `major` = breaking change to a supported compatibility contract.

**`!` / `BREAKING CHANGE` only for a contract supported across an upgrade**: the external API
surface; persisted data and migration compatibility; supported configuration (AppConfig keys and
their values, `.env` bootstrap); the deployment/upgrade contract (image tags, volumes, entrypoint
behaviour). A change whose callers all live in this repo and move in the same commit is `feat` or
`fix` — `apps/web` is not an outside client.

**Cutting a release**: `pnpm release:prepare <tag>` is the only entry point. You name the version;
one below the minimum bump the commits since the base require is refused, with no override. It
writes only `CHANGELOG.md`.

1. `pnpm release:prepare <tag>`
2. `git diff` — review the CHANGELOG section
3. `git commit -am "chore(release): notes for X.Y.Z"` (after approval)
4. `git tag <tag> && git push origin <tag>` — one tag per push, never `--tags`

Never commit an `## [Unreleased]` heading. `.husky/pre-push` is early feedback; `release.yml` decides.

**Release trains**:

- One target per train: `vX.Y.Z-rc.1`, `rc.2`, … then `vX.Y.Z`. The target is frozen at rc.1 and the
  counter advances by exactly one
- A breaking change that raises the minimum bump above the frozen target ends the train: no further
  candidate, no graduation. Its rc tags stay; the next train starts at the higher version
- A graduation publishes the last candidate's tree unchanged (`CHANGELOG.md` aside). A later change
  ships as another candidate first, in a commit that produces release notes — not only a default
  `Merge …`, a `style:` or a `chore(release)`
- Merge the train into `main` with a merge commit (never squash), then graduate. A change that
  reaches `main` before the stable tag goes back through the train: `git merge --no-ff main`, cut
  the next candidate, merge again

**Release flow**: push or PR → CI (`CI gate`; images built, never published); tag → provenance gate
→ tagged-tree check → CI → images → `ghcr.io` (`rc-latest` from the train, `latest` + `X.Y` from
`main`) → Portainer pull & redeploy. The repository variables `PUBLIC_HOSTNAME`/`RC_PUBLIC_HOSTNAME`
must be set (`OPERATIONS.md`). Runtime images carry runtime dependencies only (ADR-028). `main` does not carry
these release gates yet: Appendix Z of `docs/LUKE_MONOREPO_AUDIT_2026-08-30.md`. **NEVER delete the
`luke_api_data` volume** — the master key lives there.

**A `develop-X.Y` branch dies when its stable tag is cut**, not at the merge: never reactivate it or
backport onto it; the next cycle opens a new branch cut from `main`.

**When switching develop branch** (e.g. `develop-2.1` → `develop-2.2`): update the `branches` list
in `.github/workflows/ci.yml` (`push` and `pull_request`) and `env.RELEASE_TRAIN_BRANCH` in both
`.github/workflows/security.yml` and `.github/workflows/release.yml` — `pnpm check:workflows`
(inside `pnpm check:drift`) fails on a miss; security.yml's `push` pattern and `dependabot.yml` need
no edit. Delete the old branch locally. The owner deletes it from the remote right after its stable
tag is cut — ruleset 22082018 forbids deleting `develop-*` until the owner lifts that rule — so the
provenance gate stops accepting candidates from it.

**CI workflows**:

- On `develop-2.2` a push confined to the documentation allowlist (`push.paths-ignore` in `ci.yml`)
  runs no CI; `docs.yml` runs `pnpm check:drift` instead, and the runtime evidence for that commit
  is the CI run of the last push outside the allowlist. `main` has no such routing
- Change the allowlist and `tools/scripts/check-workflow-paths.ts` together; never a global pattern
  like `**.md`, never a path filter on `pull_request`. `CHANGELOG.md`, workflows, Markdown inside a
  source tree and test fixtures are not documentation: a fixture lives in its test tree, never under
  `docs/`
- `main` requires exactly `CI gate` and `Security gate`; never require them, or the path-filtered
  `Documentation drift`, on `develop-*` or `release/*`. A new CI job or PR-relevant scan goes in its
  gate's `needs`, and never `continue-on-error:` in `ci.yml` or `security.yml` —
  `check-workflow-paths.ts` checks both on the train, nothing does on `main`. A gate change lands on
  `main` before `main`'s ruleset may depend on it
- Both gated workflows pin `pull_request` types to `opened`, `synchronize`, `reopened`, `edited`

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
