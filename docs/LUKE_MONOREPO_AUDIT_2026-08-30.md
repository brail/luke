# LUKE Monorepo — Architecture, Tooling & Agentic-Code Audit

**Audit date:** 2026-08-29  
**Revision:** 2026-08-30 — TypeScript 7 strategy updated for planned 7.1 migration gate  
**Project version observed:** `2.1.3`  
**Audit type:** static configuration / architecture review  
**Primary audience:** LUKE maintainers and coding agents (Claude Code / GPT-class agents)

---

## 0. Executive verdict

LUKE is not a legacy codebase that needs a fashionable framework rewrite. From the files reviewed, it is already a **modern, disciplined TypeScript monorepo with several enterprise-grade engineering practices**.

### Overall assessment

**Architecture / tooling maturity: ~8.5 / 10**

The strongest signal is not the framework list itself; it is that the repository is already encoding architectural decisions into automated controls:

- Turborepo orchestration;
- pnpm workspace boundaries;
- package-level build/typecheck/test scripts;
- custom ESLint rules for LUKE-specific architecture constraints;
- Semgrep, Gitleaks and OSV scanning;
- security overrides documented with GHSA rationale;
- explicit package build allow-list;
- domain-oriented packages such as `@luke/core`, `@luke/nav`, `@luke/calendar`;
- a substantial Prisma domain model with identity, RBAC, audit, configuration, NAV sync, merchandising, calendar, locking, backup and notification concerns represented explicitly.

### Main conclusion

**Do not migrate Next.js → TanStack Start, Fastify → Hono, Prisma → Drizzle, or Node → Bun merely for fashion.**

The next improvements should target:

1. correctness of the security/lint pipeline;
2. package and runtime boundaries;
3. Prisma schema maintainability;
4. TypeScript configuration separation;
5. dependency governance;
6. codebase ergonomics for AI coding agents.

### Highest-value findings

| Priority | Finding | Confidence | Expected value |
|---|---|---:|---:|
| **P0** | `security:sast` can ignore failure of the first Semgrep command because of `;` | Confirmed | High |
| **P0** | Next.js/React/React-Hooks lint rules appear installed but not activated | Confirmed from supplied config | High |
| **P0/P1** | `minimumReleaseAgeExclude` exists without `minimumReleaseAge`; package quarantine is effectively not enabled | Confirmed | High if supply-chain quarantine is intended |
| **P1** | Prisma still uses deprecated `prisma-client-js` generator on Prisma 7 | Confirmed | High |
| **P1** | Prisma schema is 2,418 lines / 79 models / 17 enums and should be split by domain | Confirmed | High, especially for agents |
| **P1** | Root `tsconfig.json` is Next/browser-oriented rather than runtime-neutral | Confirmed | High |
| **P1** | Password-hash documentation says bcrypt while LUKE declares Argon2 in the current stack | Confirmed documentation drift | Medium-high |
| **P2** | Repeated dependency versions are good candidates for pnpm Catalogs | Confirmed | Medium |
| **P2** | Turbo `lint -> ^build` likely adds unnecessary latency; one build output glob is redundant | Confirmed config, impact to verify | Medium |
| **P2 / RELEASE GATE** | Defer TypeScript 7 adoption until TypeScript 7.1 stable and ecosystem compatibility are verified; avoid a temporary TS6/TS7 bridge unless a measured bottleneck justifies it | Confirmed dependency constraint + release-planning decision | Potentially high |

---

# 1. Audit scope

## Files reviewed

The following supplied files were used as the primary evidence base:

- root `package.json`;
- `pnpm-workspace.yaml`;
- `turbo.json`;
- root `tsconfig.json`;
- `eslint.config.mjs`;
- `schema.prisma`;
- `@luke/calendar/package.json`;
- `@luke/core/package.json`;
- `eslint-plugin-luke/package.json`;
- `@luke/nav/package.json`;
- two package-level Node/TypeScript `tsconfig.json` files.

## Important scope limitations

The following were **not supplied in this audit bundle**:

- `apps/web/package.json`;
- `apps/api/package.json`;
- `apps/web/tsconfig.json`;
- `apps/api/tsconfig.json`;
- `next.config.*`;
- `prisma.config.ts`;
- application source code;
- custom ESLint plugin source (`eslint-plugin-luke/index.js` and rule implementations);
- Semgrep rule bodies;
- CI workflow files;
- lockfile;
- generated package output (`dist/`);
- package import graph extracted from source.

Therefore this report **must not be interpreted as proof** that tRPC, Fastify, NextAuth, React Query, Prisma or client/server dependencies are placed correctly inside `apps/api` and `apps/web`.

Where source inspection is required, findings are explicitly marked **VERIFY BEFORE CHANGE**.

---

# 2. Observed architecture

From the workspace and package manifests, the repository has the following broad shape:

```text
LUKE monorepo
│
├─ apps/
│  ├─ web/                  # inferred from lint paths; manifest not supplied
│  └─ api/                  # inferred from scripts/lint paths; manifest not supplied
│
├─ packages/
│  ├─ core/
│  │  └─ Zod + shared domain/application contracts
│  │
│  ├─ nav/
│  │  ├─ @luke/core
│  │  ├─ Prisma client
│  │  ├─ MSSQL
│  │  └─ Pino
│  │
│  ├─ calendar/
│  │  ├─ @luke/core
│  │  ├─ Google APIs
│  │  └─ iCalendar generation
│  │
│  └─ eslint-plugin-luke/
│     └─ repository-specific architecture constraints
│
└─ tools/
   └─ scripts / codemods / integrity checks
```

### Package dependency direction visible in supplied manifests

```text
@luke/calendar ─────► @luke/core

@luke/nav ──────────► @luke/core
     │
     ├──────────────► @prisma/client
     ├──────────────► mssql
     └──────────────► pino

@luke/core ─────────► zod
```

This is a **healthy direction**: the generic core package is not visibly dependent on NAV or calendar integration packages.

One caveat: `@luke/core` has `@prisma/client` as a `devDependency`. Whether this is correct depends on whether emitted public declarations reference Prisma types. That requires source or `dist/*.d.ts` inspection.

---

# 3. What is already strong

## 3.1 The repository encodes architecture as executable policy

This is one of the best aspects of the current setup.

The custom ESLint configuration activates LUKE-specific rules including:

```text
@luke/no-bare-zod-partial
@luke/no-uncommented-any
@luke/no-uncommented-tailwind-arbitrary
@luke/no-dialog-input-outside-form
@luke/no-bare-client-random-uuid
```

This is substantially better than relying only on prose in `CLAUDE.md`, `lessons.md`, ADRs or developer memory.

### Why this matters for agentic coding

AI agents are much more reliable when architecture is enforced as:

```text
instruction
    +
static rule
    +
test
    +
CI gate
```

rather than only:

```text
instruction in a markdown file
```

The custom lint package should therefore be treated as **strategic infrastructure**, not incidental tooling.

**Recommendation:** expand this pattern carefully when repeated agent mistakes are observed. Do not convert every style preference into a custom rule; reserve it for architecture, security, data correctness and recurring high-cost regressions.

---

## 3.2 Supply-chain/security posture is above average

The root workspace contains several good controls:

- pnpm version pinned including integrity hash;
- `allowBuilds` permit-list for packages requiring install/build scripts;
- documented transitive vulnerability overrides;
- Semgrep SAST;
- Gitleaks secret scanning;
- OSV dependency scanning;
- Husky;
- explicit GHSA comments explaining why overrides exist and why upper bounds are used.

The comments around `nanoid`, `brace-expansion`, `deepmerge-ts`, `fast-uri`, `js-yaml`, etc. show that dependency overrides are being handled deliberately instead of as unexplained version pins.

This is good engineering practice.

---

## 3.3 Domain model maturity

The supplied Prisma schema contains:

- **2,418 lines**;
- **79 models**;
- **17 enums**.

The schema is not merely CRUD scaffolding. It models multiple concerns explicitly, including:

- user / identity / local credential separation;
- RBAC;
- audit logs;
- application configuration;
- user tokens;
- file objects;
- brand and season context;
- dashboards;
- pricing parameter sets;
- collection layouts, rows, quotations and revisions;
- merchandising plans, rows, specsheets, components and images;
- NAV synchronization and NAV-domain projections;
- company structure and teams;
- calendar planning and event visibility;
- Google Calendar mappings;
- notifications and deduplication;
- feedback;
- edit/scheduler locks;
- holidays and vendor closure periods;
- backup records.

That breadth is a sign LUKE has evolved from an application prototype into a real internal platform.

---

# 4. Findings and recommended actions

---

## P0-01 — Security SAST command-chain bug

### Status

**CONFIRMED**

### Evidence

Root `package.json` currently contains:

```json
"security:sast": "semgrep scan --config .semgrep/rules/mutation-requires-permission.yml; semgrep scan --config p/typescript --config p/nextjs --config p/nodejs --config p/react --config p/sql-injection --error && semgrep scan --config .semgrep/rules/ --severity ERROR --error"
```

The first command is separated with `;` rather than `&&`.

### Why this matters

In a shell command chain:

```bash
command_a; command_b && command_c
```

a non-zero exit from `command_a` does not prevent `command_b` from executing. The final script can still succeed if later commands succeed.

This means the custom `mutation-requires-permission.yml` gate may not be fail-closed.

### Recommended change

Prefer one fail-closed chain:

```bash
semgrep scan --config .semgrep/rules/mutation-requires-permission.yml --error && \
semgrep scan --config p/typescript --config p/nextjs --config p/nodejs --config p/react --config p/sql-injection --error && \
semgrep scan --config .semgrep/rules/ --severity ERROR --error
```

Alternatively consolidate compatible configs into one invocation if output and severity semantics remain equivalent.

### Acceptance criteria

- intentionally trigger `mutation-requires-permission` in a test branch;
- `pnpm security:sast` exits non-zero;
- `pnpm security` exits non-zero;
- remove/revert the intentional violation;
- full security task passes.

### Agent instruction

**This should be fixed before any large refactor. Keep it as a small isolated commit.**

---

## P0-02 — Next.js / React / React-Hooks lint rules appear installed but inactive

### Status

**CONFIRMED FROM SUPPLIED CONFIG**

### Evidence

Root dependencies include:

```json
"eslint-config-next": "^16.3.3"
```

But `eslint.config.mjs` imports only:

```js
@eslint/js
@typescript-eslint/eslint-plugin
@typescript-eslint/parser
eslint-plugin-import-x
eslint-plugin-luke
globals
```

There is no imported Next.js config/plugin in the supplied config.

The config also does not visibly activate the standard React Hooks rule set.

### Impact

LUKE's custom lint rules are strong, but the web app may miss framework-specific checks for:

- Next.js misuse;
- React rules;
- React Hooks correctness;
- Core Web Vitals-related Next rules.

This is particularly important with React 19 / Next 16 and extensive agent-generated UI code.

### Recommended approach

Do **not** blindly replace the custom ESLint config.

Because the repo already has a complex, scoped Flat Config, integrate the official Next rules only for `apps/web`.

Two viable patterns:

1. integrate `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` carefully with file scoping and overrides;
2. use the Next plugin directly for granular monorepo control, and separately ensure React Hooks rules are active.

For this repo, option 2 may be easier to reason about because custom plugin/parser behavior already exists.

### Additional correction: globals

Currently the common TypeScript config declares both:

```js
...globals.browser,
...globals.node,
```

for API, web and shared packages.

That weakens runtime boundary checking.

Target state:

```text
apps/web           -> browser globals (+ only server-specific scopes where intentional)
apps/api           -> node globals
packages/nav       -> node globals
packages/calendar  -> node globals
packages/core      -> preferably runtime-neutral; add globals only when required
```

### Acceptance criteria

- Next framework rules are demonstrably active on `apps/web`;
- React Hooks rules are demonstrably active on React code;
- API code does not inherit browser globals;
- web/client code does not accidentally receive unrestricted Node globals;
- all LUKE custom rules remain active;
- `pnpm lint` passes after known issues are triaged intentionally.

### Important

Do not enable a large new lint ruleset and auto-fix hundreds of unrelated files in the same commit. Integrate, measure, triage, then remediate in bounded batches.

---

## P0/P1-03 — `minimumReleaseAgeExclude` is configured without `minimumReleaseAge`

### Status

**CONFIRMED**

### Evidence

`pnpm-workspace.yaml` contains:

```yaml
minimumReleaseAgeExclude:
  - prettier@3.8.5
  - electron-to-chromium
```

but does not contain a `minimumReleaseAge` value.

pnpm's default `minimumReleaseAge` is `0`, i.e. no delay/quarantine.

### Interpretation

There are two possibilities:

#### A. Quarantine is intended

Then the current config creates a false sense of protection and should be completed, for example:

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeExclude:
  - prettier@3.8.5
  - electron-to-chromium
```

`1440` means one day.

The exact policy should be chosen deliberately; 24 hours is an example, not a universal requirement.

#### B. Quarantine is not intended

Then remove `minimumReleaseAgeExclude` so the file does not imply that a release-age policy is active.

### Optional hardening

The current pnpm line also supports trust-policy controls. Consider them only after testing compatibility with the actual dependency tree; do not combine this change with unrelated dependency upgrades.

### Acceptance criteria

- the team explicitly chooses “quarantine enabled” or “quarantine disabled”;
- config reflects that choice unambiguously;
- clean install succeeds;
- CI frozen-lockfile install succeeds;
- documented exceptions are still necessary.

---

## P1-04 — Prisma 7 still uses `prisma-client-js`

### Status

**CONFIRMED**

### Evidence

The schema begins with:

```prisma
generator client {
  provider = "prisma-client-js"
}
```

The supplied manifests show Prisma Client `7.10.0` in relevant workspace dependencies.

### Why modernize

On Prisma 7, the modern/default generator is `prisma-client`; `prisma-client-js` is deprecated.

The newer generator:

- generates explicit TypeScript source into a chosen output directory;
- removes hidden generation into `node_modules`;
- makes server/browser import intent more explicit;
- improves visibility of the generated-code boundary.

Those characteristics fit LUKE's “architecture must be visible to coding agents” philosophy well.

### Recommended sequence

Do not mix this with a Prisma major-version upgrade.

Recommended path:

```text
Prisma 7.10 + current generator
        │
        ├─ establish current test baseline
        │
        ▼
Prisma 7.10 + prisma-client generator
        │
        ├─ update imports
        ├─ verify adapter/config requirements
        ├─ run migrations/generate/tests
        │
        ▼
stabilize
        │
        ▼
consider a separate Prisma-major spike later
```

### Example target shape

Exact output path must be chosen after seeing `apps/api` and `prisma.config.ts`, but conceptually:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
```

### VERIFY BEFORE CHANGE

Before migration inspect:

- `prisma.config.ts`;
- every import from `@prisma/client`;
- whether Prisma types cross into `@luke/core` public declarations;
- generated-code ignore rules;
- test setup;
- deployment bundling;
- Prisma adapters / engine configuration.

### Acceptance criteria

- no DB schema migration is produced solely because of generator migration;
- `prisma generate` succeeds from a clean checkout;
- API build succeeds;
- integration tests pass;
- generated code is not imported into browser bundles incorrectly;
- no public package declaration points at an unavailable generated path.

---

## P1-05 — Split the 2,418-line Prisma schema by domain

### Status

**CONFIRMED / STRONGLY RECOMMENDED**

### Evidence

Current schema size:

```text
2,418 lines
79 models
17 enums
```

### Why this is now architectural, not cosmetic

A single file this large increases:

- agent context cost;
- accidental cross-domain edits;
- merge conflict surface;
- navigation cost;
- difficulty assigning bounded refactor tasks;
- temptation for an agent to reason globally when a change is local.

Prisma supports multi-file schemas, so this can be done without changing the physical DB model.

### Proposed domain split

This is a starting point, not a rigid prescription:

```text
prisma/
├─ schema.prisma                 # datasource + generator + truly global enums if desired
│
├─ identity.prisma
│  ├─ User
│  ├─ Identity
│  ├─ LocalCredential
│  ├─ UserToken
│  ├─ UserSectionAccess
│  └─ UserPreference
│
├─ platform.prisma
│  ├─ AppConfig
│  ├─ AuditLog
│  └─ FileObject
│
├─ brand-season.prisma
│  ├─ Brand
│  └─ Season
│
├─ dashboard.prisma
│  ├─ DashboardConfig
│  └─ DashboardTask
│
├─ pricing.prisma
│  └─ PricingParameterSet
│
├─ collection.prisma
│  ├─ CollectionLayout
│  ├─ CollectionGroup
│  ├─ CollectionLayoutRow
│  ├─ CollectionRowQuotation
│  ├─ CollectionRowPhaseHistory
│  ├─ CollectionCatalogItem
│  └─ revision models
│
├─ merchandising.prisma
│  ├─ MerchandisingPlan
│  ├─ MerchandisingPlanRow
│  ├─ MerchandisingSpecsheet
│  ├─ MerchandisingComponent
│  └─ MerchandisingImage
│
├─ nav-master.prisma
│  ├─ NavSyncFilter
│  ├─ NavVendor
│  ├─ NavBrand
│  ├─ NavSeason
│  └─ Vendor
│
├─ nav-pf.prisma
│  └─ NavPf* models
│
├─ nav-kimo.prisma
│  └─ NavKimo* models
│
├─ company.prisma
│  ├─ CompanyProfile
│  ├─ CompanyFunction
│  ├─ CompanyTeam
│  └─ team membership/scope models
│
├─ calendar.prisma
│  ├─ SeasonCalendar
│  ├─ PlanningGroup
│  ├─ CalendarEvent*
│  ├─ MilestoneTemplate*
│  ├─ GoogleCalendarBinding
│  ├─ GoogleEventMapping
│  └─ Phase
│
├─ notifications.prisma
│  ├─ Notification
│  ├─ NotificationPreference
│  ├─ NotificationDedupKey
│  └─ FeedbackSubmission
│
├─ locks.prisma
│  ├─ EditLock
│  └─ SchedulerLock
│
├─ holidays.prisma
│  ├─ HolidayCountry
│  ├─ Holiday
│  └─ VendorClosurePeriod
│
└─ backup.prisma
   └─ BackupRecord
```

### Implementation rule

**This refactor must be schema-location-only.**

No renaming, relation redesign, index redesign or business-model cleanup should be mixed into the split.

### Acceptance criteria

- Prisma reports exactly the same logical model;
- migration diff is empty;
- generated client API is unchanged except for generator changes if performed separately;
- all tests pass;
- a coding agent can inspect a domain without loading the entire schema.

### Preferred sequencing

Do this **before** deeper domain-model refactors and preferably as a separate commit from the client-generator migration.

---

## P1-06 — Root TypeScript config is a web/Next config, not a neutral monorepo base

### Status

**CONFIRMED**

### Evidence

Root `tsconfig.json` contains:

```json
"lib": ["dom", "dom.iterable", "es6", "es2022.error"],
"module": "esnext",
"moduleResolution": "bundler",
"jsx": "preserve",
"plugins": [{ "name": "next" }],
"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]
```

This is effectively a Next/browser-flavored project configuration at repository root.

By contrast, supplied package configs correctly use Node-oriented settings such as:

```json
"module": "NodeNext",
"moduleResolution": "NodeNext",
"types": ["node"]
```

### Risk

A root config that implicitly knows about DOM, JSX and Next can blur the distinction between:

- browser code;
- Next server code;
- Fastify/Node code;
- runtime-neutral shared code;
- integration packages.

In an agent-heavy repo, unclear configuration boundaries increase the chance of accidental imports across runtime layers.

### Recommended target

```text
tsconfig.base.json               # runtime-neutral shared strictness
│
├─ apps/web/tsconfig.json        # Next + DOM + bundler + JSX
├─ apps/api/tsconfig.json        # Node server
├─ packages/core/tsconfig.json   # neutral or minimal Node only if truly required
├─ packages/nav/tsconfig.json    # NodeNext
└─ packages/calendar/tsconfig.json # NodeNext
```

### Suggested neutral base responsibilities

Keep in base only settings that are genuinely shared, for example:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

Do not copy this literally without checking current app configs.

### Special review: `paths` bypassing package output

Root config currently contains:

```json
"paths": {
  "@luke/core": ["./packages/core/src"],
  "@luke/core/*": ["./packages/core/src/*"]
}
```

But `@luke/core` is also a real package with explicit `exports` pointing at `dist`.

This may intentionally improve local DX, but it also means some consumers can type-check against source while production/package semantics use exported build output.

**VERIFY BEFORE CHANGE:** determine who relies on these path aliases and whether removing them exposes packaging issues.

A strong end-state is that source imports and package exports behave consistently.

### Acceptance criteria

- web, API and shared packages type-check using runtime-appropriate libs/globals;
- no web-only global is available in pure API code by accident;
- no Node-only API leaks into browser code by accident;
- package imports resolve consistently in dev, typecheck, test and build;
- no “works only because root tsconfig sees everything” behavior remains.

---

## P1-07 — Password-hash documentation drift: bcrypt vs Argon2

### Status

**CONFIRMED DOCUMENTATION MISMATCH**

### Evidence

Current project stack declares Argon2 `0.45.1`, and `pnpm-workspace.yaml` explicitly allows `argon2` build scripts.

However Prisma comments say:

```prisma
/// Bcrypt password credential for a LOCAL identity. One-to-one with Identity.
model LocalCredential {
  ...
  /// Bcrypt hash of the user's password. Never stored in plain text.
  passwordHash String
}
```

### Why this matters

A stale comment is particularly dangerous in an AI-maintained codebase because agents use comments as architectural evidence.

A future agent could reasonably infer that bcrypt is the required algorithm and write inconsistent authentication code.

### Recommended change

If runtime code is indeed Argon2, make comments algorithm-correct or algorithm-neutral, for example:

```prisma
/// Password credential for a LOCAL identity. One-to-one with Identity.
...
/// Password hash produced by the application's approved password-hashing policy. Never stored in plain text.
```

Algorithm-neutral wording is preferable if the algorithm is an application policy rather than a data-model constraint.

### VERIFY BEFORE CHANGE

Confirm the actual hashing implementation in auth source first. `allowBuilds: argon2` alone is not proof that LocalCredential currently uses it.

### Acceptance criteria

- schema comments match authentication implementation;
- auth tests confirm password verify/hash behavior;
- no source/docs still state bcrypt if the runtime policy is Argon2.

---

## P1/P2-08 — Dependency versions should move toward pnpm Catalogs

### Status

**RECOMMENDED**

### Evidence

The same versions are repeated across workspace manifests, including examples such as:

```text
typescript ^6.0.3
@types/node ^24.7.2
vite ^8.2.2
vitest ^4.1.11
@prisma/client ^7.10.0
```

### Why catalogs fit LUKE

pnpm Catalogs allow dependency versions to be declared centrally in `pnpm-workspace.yaml` and referenced through `catalog:`.

Benefits for LUKE:

- one source of truth for important versions;
- lower version skew between packages;
- cleaner agent changes;
- easier review of dependency upgrades;
- fewer manifest merge conflicts.

### Example

```yaml
catalog:
  typescript: ^6.0.3
  '@types/node': ^24.7.2
  '@prisma/client': ^7.10.0
  vite: ^8.2.2
  vitest: ^4.1.11
  zod: ^4.4.3
```

Then package manifests can use:

```json
"typescript": "catalog:",
"vitest": "catalog:"
```

### Recommended rollout

Start only with high-frequency shared dependencies. Do not immediately catalog every package.

Potential later policy:

```yaml
catalogMode: strict
```

but only after the workspace has been migrated and CI behavior is understood.

### Acceptance criteria

- same resolved versions before/after migration unless explicitly intended;
- no package-specific version requirement is accidentally flattened;
- frozen-lockfile CI remains green.

---

## P2-09 — Turbo task graph can probably be simplified

### Status

**CONFIRMED CONFIG / PERFORMANCE IMPACT TO VERIFY**

### Evidence

Current config:

```json
"lint": {
  "dependsOn": ["^build"]
}
```

and build outputs include:

```json
"outputs": [
  ".next/**",
  "!.next/cache/**",
  "dist/**",
  "packages/core/dist/**"
]
```

### Analysis

#### `lint -> ^build`

The supplied ESLint configuration is not type-aware in a way that obviously requires built dependency declarations. Therefore forcing dependency builds before lint likely adds latency.

However, verify actual resolver/plugin behavior before removing it.

#### `packages/core/dist/**`

Turbo task output globs are package-relative. `dist/**` already captures package `dist` output. `packages/core/dist/**` is likely redundant or ineffective in member packages.

### Recommended target

Potentially:

```json
"lint": {
  "cache": true
}
```

while retaining upstream build dependencies where they are genuinely required by typecheck/test because package `exports` point to built declarations.

### Acceptance criteria

Benchmark before and after:

```text
cold lint
warm lint
cold typecheck
warm typecheck
```

No change should be accepted solely because the graph looks cleaner.

---

## P2-10 — TypeScript 7.1 migration gate

### Status

**DEFER TS7 ADOPTION; PLAN A CLEAN MIGRATION TO TYPESCRIPT 7.1 STABLE**

LUKE is currently being developed on a branch intended to lead to a major release. In that context, introducing a temporary TypeScript 7.0 / TypeScript 6 compatibility bridge would add transitional complexity to a branch that is already carrying structural change.

The preferred strategy is therefore to **remain on TypeScript 6.x during the current refactors and prepare a dedicated TypeScript 7.1 migration gate once 7.1 is stable and the relevant ecosystem is demonstrably compatible**.

### Evidence

Current repo uses:

```text
TypeScript 6.0.3
typescript-eslint 8.68.0
ts-morph 28.0.0
```

TypeScript 7.0 offers major compiler-performance improvements, but its programmatic API transition creates additional compatibility considerations for tooling such as `typescript-eslint` and `ts-morph`. LUKE also has package declaration builds, Next.js tooling, Prisma-generated types, Vite/Vitest and custom scripts/codemods that need to behave consistently across the migration.

### Decision

Do **not** introduce the TS6/TS7 side-by-side bridge as a routine modernization step.

Use this sequence instead:

```text
current major-development branch
        │
        ├── remain on TypeScript 6.x
        ├── clean up tsconfig boundaries
        ├── stabilize package boundaries
        ├── complete lint / Turbo / Prisma structural work
        │
        ▼
TypeScript 7.1 stable available
        │
        ▼
compatibility gate
        │
        ├── typescript-eslint
        ├── ts-morph / codemods
        ├── Next.js
        ├── Prisma generated client/types
        ├── Vite / Vitest
        ├── package declaration builds
        └── editor + CI diagnostics
        │
        ▼
clean TS6 -> TS7.1 migration
```

### Compatibility gate

Before changing the repository-wide TypeScript version, verify all of the following:

- `typescript-eslint` officially supports the selected TypeScript 7.1 release;
- `ts-morph` and LUKE's `ts-morph`-based tooling/codemods work without compatibility shims;
- Next.js 16 tooling and editor integration are stable;
- Prisma generation and inferred types are unchanged or intentionally changed;
- Vite/Vitest test tooling works normally;
- all workspace declaration builds complete successfully;
- `turbo run typecheck`, lint, build and tests produce expected diagnostics;
- IDE diagnostics are materially consistent with CI diagnostics.

### Acceptance criteria

Adopt TypeScript 7.1 only when:

- the ecosystem compatibility gate above passes;
- no long-lived TS6 compatibility layer is needed;
- generated declarations and application behavior remain correct;
- the full Turbo build/typecheck/test pipeline passes;
- any diagnostic differences have been reviewed rather than silently suppressed.

Performance improvement should be measured after the migration, but **performance alone is not a reason to introduce an interim dual-version architecture**.

### Early-adoption exception

Reconsider TypeScript 7.0 before 7.1 only if LUKE develops a **measured and material typecheck/build bottleneck** that is expensive enough to justify the extra compatibility machinery. In the absence of such evidence, wait for the cleaner 7.1 migration path.

---

# 5. Additional observations requiring repository-level verification

These should **not** be automatically changed from this report alone.

## 5.1 `@prisma/client` as devDependency of `@luke/core`

`@luke/core` declares:

```json
"devDependencies": {
  "@prisma/client": "^7.10.0"
}
```

If core source merely uses Prisma types internally during compilation and exported declarations do not reference them, this may be fine.

If `dist/*.d.ts` exposes Prisma types, then consumers may require Prisma as a real dependency or peer dependency.

### Agent task

Inspect:

```text
packages/core/src/**
packages/core/dist/**/*.d.ts
```

and search for `Prisma`, `@prisma/client`, generated model types.

Do not move the dependency based on manifest aesthetics alone.

---

## 5.2 Module-format ambiguity in internal packages

`@luke/core`, `@luke/nav` and `@luke/calendar` use:

```json
"main": "./dist/index.js",
"exports": {
  ".": {
    "import": "./dist/index.js",
    "require": "./dist/index.js"
  }
}
```

and their TypeScript configs use `NodeNext`, but their package manifests do not show an explicit:

```json
"type": "module"
```

This may be intentional CommonJS output, and Node can often import CommonJS from ESM. It is not automatically wrong.

However, the package format should ideally be **explicit rather than emergent**.

### Agent task

Inspect built `dist/index.js` and actual importers. Decide whether the package contract is:

- CommonJS;
- ESM;
- truly dual package.

Do not add `"type": "module"` blindly; with `NodeNext`, that can require import-extension changes and can create runtime failures.

---

## 5.3 Root dependencies on `@luke/api` and `@trpc/client`

Root `devDependencies` include:

```text
@luke/api workspace:*
@trpc/client ^11.18.0
```

This may be entirely valid because root scripts such as release/clone/tools could invoke API types or tRPC.

### Agent task

Search root-level scripts/tools for imports before deciding these are misplaced.

---

## 5.4 `allowJs: true`

Root and supplied package TypeScript configs allow JavaScript.

If intentional JS files remain, keep it.

If all maintained source is TypeScript, disabling `allowJs` can tighten the compilation surface, but this is low priority.

---

# 6. Agentic-development specific recommendations

LUKE is already moving in the correct direction for AI-assisted engineering. The next objective should be to make the repository **self-policing**.

## 6.1 Convert recurring lessons into executable gates

Use this progression:

```text
agent makes recurring mistake
        ↓
document lesson
        ↓
if structurally detectable -> lint/Semgrep rule
        ↓
if behavioral -> regression test
        ↓
if dependency boundary -> package/export rule or static dependency test
```

This is better than endlessly enlarging `CLAUDE.md`.

## 6.2 Make dependency direction machine-checkable

The package graph already looks sensible. Consider eventually enforcing rules such as:

```text
core MUST NOT import nav
core MUST NOT import calendar
web client MUST NOT import server-only modules
integration packages MUST NOT leak implementation-specific types into core
```

This could be implemented through:

- custom ESLint import restrictions;
- dependency-cruiser-like graph checks;
- package export boundaries;
- repository-specific Semgrep/static rules.

Do not add another tool unless existing ESLint/import-x capabilities cannot express the rule reliably.

## 6.3 Rename dangerous “easy for an agent to invoke” scripts

Root currently has:

```json
"deps:latest": "pnpm update --latest"
```

This is operationally convenient but agent-hostile: `--latest` can intentionally cross major versions.

Consider a more explicit name such as:

```text
deps:upgrade-all-majors
```

and keep routine dependency updates separate.

The goal is not to prohibit the command; it is to make its blast radius obvious in natural-language planning.

## 6.4 Keep refactors single-purpose

For this repo, agents should not combine:

- Prisma multi-file split + model redesign;
- generator migration + Prisma major bump;
- ESLint integration + mass auto-fix + UI refactor;
- tsconfig boundary changes + package format migration;
- dependency catalog migration + package upgrades.

A strong LUKE commit should make one architectural statement at a time.

---

# 7. Recommended implementation roadmap

## Phase A — Correctness and false-safety removal

### A1. Fix Semgrep command chaining

**Priority:** P0  
**Risk:** very low  
**Commit:** isolated

### A2. Decide release-age quarantine policy

**Priority:** P0/P1  
**Risk:** low, but can affect install behavior  
**Commit:** isolated

### A3. Activate Next/React/React-Hooks linting correctly

**Priority:** P0  
**Risk:** low-to-medium due to pre-existing lint debt  
**Commit strategy:** config first, remediation in bounded follow-ups if necessary

### A4. Resolve bcrypt/Argon2 documentation drift

**Priority:** P1  
**Risk:** very low after source verification

---

## Phase B — Schema maintainability

### B1. Split Prisma schema into domain files

**Priority:** P1  
**Risk:** low if migration diff is required to remain empty

### B2. Migrate Prisma generator on the current Prisma major

**Priority:** P1  
**Risk:** medium due to import/build changes

Keep B1 and B2 separate.

---

## Phase C — Monorepo boundaries

### C1. Introduce neutral `tsconfig.base.json`

**Priority:** P1

### C2. Separate web/API/package runtime configs

**Priority:** P1

### C3. Audit `@luke/core` source alias vs package exports

**Priority:** P1

### C4. Audit public declaration dependency exposure

**Priority:** P1/P2

---

## Phase D — Dependency ergonomics and build speed

### D1. Introduce pnpm Catalogs for shared foundational dependencies

**Priority:** P2

### D2. Benchmark/simplify Turbo lint/build dependencies

**Priority:** P2

### D3. Make package module formats explicit

**Priority:** P2; only if current ambiguity causes cost

---

## Phase E — Planned modernization gates

### E1. TypeScript 7.1 migration gate

**Priority:** P2 / release gate  
**Timing:** after TypeScript 7.1 stable and ecosystem compatibility verification; do not introduce a TS6/TS7 bridge by default.

### E2. Prisma future-major spike

Only after the Prisma 7 generator path is clean and production-stable.

---

# 8. What should NOT be refactored merely for fashion

Based on the current architecture, there is no evidence in the supplied files that LUKE should perform any of these migrations:

```text
Next.js       -> TanStack Start
Fastify       -> Hono
Prisma        -> Drizzle
Node          -> Bun
Zod           -> another validator
React Query   -> ad-hoc fetch/server-state layer
tRPC          -> REST purely for internal web/API calls
Tailwind      -> another styling system
Radix         -> another primitive library
Pino          -> another logger
```

Such migrations should require a **specific measurable problem**, such as:

- deployment/runtime requirement;
- severe performance bottleneck;
- missing capability;
- unacceptable maintenance cost;
- organizational constraint;
- security requirement.

“More fashionable in 2026” is not sufficient justification.

---

# 9. Suggested acceptance gates for every architecture PR

Before merging any item from this audit, run the applicable subset of:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:test
pnpm test
pnpm test:integration
pnpm build
pnpm security:sast
pnpm security:secrets
pnpm security:deps
pnpm sync-version:check
pnpm check:drift
```

For Prisma-only structural changes additionally require:

```text
prisma generate succeeds
schema validation succeeds
migration diff is empty when no data-model change is intended
integration DB tests pass
```

For package-boundary changes additionally verify from a **clean checkout / clean dist state**, so stale generated declarations do not hide problems.

---

# 10. Proposed instructions for Claude Code

The following text can be used directly as task framing for an agent working from this report:

> Treat this audit as a prioritized review, not as authorization for a broad refactor.  
> Before changing a finding marked VERIFY BEFORE CHANGE, inspect the actual source/import graph and prove the condition exists.  
> Preserve the current core stack and package direction unless a concrete defect requires otherwise.  
> Implement P0 findings first and in isolated commits.  
> Never combine Prisma schema splitting with model redesign or a major Prisma upgrade.  
> Never replace custom LUKE lint rules while integrating framework linting.  
> For tsconfig/package-boundary changes, validate clean builds with no stale `dist` output.  
> For every change, state: evidence, exact files changed, architectural invariant preserved, tests/gates run, and any unresolved risk.  
> Prefer executable enforcement (lint/test/static rule) over new prose-only conventions when the rule is mechanically detectable.

---

# 11. Next audit pass requested

To complete the architecture audit, inspect these next:

```text
apps/web/package.json
apps/api/package.json
apps/web/tsconfig.json
apps/api/tsconfig.json
next.config.*
prisma.config.ts
packages/core/src/**
packages/nav/src/**
packages/calendar/src/**
apps/api/src/**   (at least bootstrap, tRPC context/router, auth, Prisma entrypoint)
apps/web/src/**   (tRPC client/provider, auth provider, server/client boundary)
eslint-plugin-luke/index.js + rules/**
.semgrep/rules/**
CI workflows
```

The second pass should specifically answer:

1. Are browser/server boundaries actually enforced in imports?
2. Is tRPC contract ownership correctly located?
3. Is Zod schema ownership centralized without creating a god-package?
4. Does `@luke/core` expose Prisma implementation details?
5. Is Prisma instantiated exactly where intended and safely shared?
6. Are NAV/MSSQL concerns isolated from generic domain code?
7. Is NextAuth/Auth logic duplicated between Next and Fastify layers?
8. Does React Query duplicate server-state patterns already handled by tRPC?
9. Are package exports respected, or do source aliases bypass them widely?
10. Do custom ESLint/Semgrep rules enforce the architecture described in documentation?
11. Are tests distributed at the correct layer (unit / integration / contract / UI)?
12. Is the repository optimized for bounded-context agent work?

---

# 12. Final assessment

LUKE's current technical direction is strong.

The codebase appears to have crossed an important maturity threshold: the primary engineering risk is no longer “wrong framework choice”; it is **complexity governance**.

The correct strategy is therefore:

```text
KEEP the core stack
        +
TIGHTEN boundaries
        +
MAKE policy executable
        +
REDUCE agent context surface
        +
MODERNIZE incrementally where tooling has a clear payoff
```

The highest-value near-term work is not a fashionable rewrite. It is making the architecture already present in LUKE more explicit, more enforceable, and easier for both humans and coding agents to reason about safely.

---

# Appendix A — Source evidence map

## Root `package.json`

Observed items:

- pnpm pinned at `11.24.0` with integrity hash;
- Node engine `>=24.0.0`;
- Turbo task façade;
- test DB Docker workflow;
- release/version integrity scripts;
- Semgrep / Gitleaks / OSV security scripts;
- `eslint-config-next 16.3.3` installed;
- `ts-morph 28.0.0` installed;
- TypeScript `6.0.3` installed.

Critical evidence:

```text
security:sast uses `;` after mutation-requires-permission Semgrep scan
```

## `pnpm-workspace.yaml`

Observed items:

- workspace globs for apps/packages/tools;
- explicit build-script allow list;
- release-age exclusions without base minimum release age;
- heavily documented vulnerability overrides.

## `turbo.json`

Observed items:

- build dependency graph through `^build`;
- persistent uncached dev task;
- lint/typecheck/test waiting on upstream build;
- integration tests uncached with DB environment inputs;
- global local-env dependency;
- generic `dist/**` plus explicit `packages/core/dist/**` output.

## Root `tsconfig.json`

Observed items:

- DOM libs;
- JSX preservation;
- Next plugin;
- Bundler module resolution;
- Next-generated type includes;
- direct path alias to `packages/core/src`.

## Package TypeScript configs

Observed items:

- NodeNext module semantics;
- declaration + declaration map + source map emission;
- explicit `dist` output;
- strict mode;
- Node types.

## `eslint.config.mjs`

Observed items:

- Flat Config;
- JS recommended;
- manual TypeScript parser/plugin;
- import ordering rules;
- LUKE custom architecture rules;
- both browser and Node globals applied broadly;
- Next config package not visibly integrated.

## `schema.prisma`

Observed items:

- PostgreSQL datasource;
- `prisma-client-js` generator;
- 2,418 lines;
- 79 models;
- 17 enums;
- bcrypt wording in `LocalCredential` comments.

---

# Appendix B — External technical validation used for recommendations

The configuration-derived findings above were cross-checked against current official documentation available on 2026-08-29, specifically:

- Next.js 16 ESLint / Flat Config documentation;
- Prisma generator documentation for `prisma-client` vs deprecated `prisma-client-js`;
- Prisma multi-file schema documentation;
- pnpm settings documentation for `minimumReleaseAge`, `minimumReleaseAgeExclude` and trust policy;
- pnpm Catalogs documentation;
- Microsoft TypeScript 7.0 transition guidance, used to justify deferring a compatibility-bridge architecture; migration is now explicitly gated on TypeScript 7.1 stable plus ecosystem compatibility.

The repository files remain the primary source of truth for what LUKE currently does; external documentation is used only to validate modernization recommendations.


---

# Appendix A — Current disposition and execution baseline (2026-08-31)

**This is not a closure appendix. The Monorepo Audit remains OPEN.**

Reconciliation baseline: `develop-2.2` at `63dce1b`. The audit body above is preserved as written and is deliberately not edited retroactively; this appendix records what became of each item and what the current execution order is.

## A.0 Stability rule for this adjudication

**A later reconciliation must not replace an adjudicated disposition merely because a semantic rerun reaches a different conclusion. Reopen an item only on explicit new repository evidence or a human decision.**

This rule exists because of a measured property of the review system: two identical full audit runs, on the same tree, minutes apart, produced materially different CRITICAL, P1 and QA-gap counts. Absence of a finding in a later run is therefore not evidence that a confirmed finding has been resolved, and a differing re-derivation is not new evidence.

## A.1 Item-by-item disposition

### §4 — Numbered findings

| Item | Original concern | Disposition | Current evidence | Action still required |
|---|---|---|---|---|
| P0-01 | `security:sast` chained with `;` — fail-open | DONE | `package.json:41` uses `&&`. Strengthened beyond the recommendation: `checkSecurityRunnerCanonicalForm` (`tools/scripts/check-platform-integrity.ts:566`) makes reintroduction a red gate (`dbe02ef`, `cb14810`) | None |
| P0-02a | Next/React/React-Hooks rules installed but inactive | CONFIRMED OPEN | `eslint-config-next@^16.3.3` in root and `apps/web`; `eslint.config.mjs` references `next` only in ignore globs (`:202`, `:210`). `eslint-plugin-react-hooks` is not installed anywhere | Full item |
| P0-02b | `globals.browser` + `globals.node` merged for every workspace | CONFIRMED OPEN (partially addressed) | `eslint.config.mjs:86-87` still merges both. The `tools/**` block (`:113-122`) is Node-only and its comment names this finding and defers it (`58a1629`) | Per-runtime globals for web/api/packages |
| P0/P1-03 | `minimumReleaseAgeExclude` without `minimumReleaseAge` | DONE | `pnpm-workspace.yaml:22-25` — quarantine at 4320 min, `minimumReleaseAgeStrict: true`, excludes narrowed to `electron-to-chromium`. Interpretation A chosen deliberately; gated by `checkReleaseAgePolicy:424` | None |
| P1-04 | Prisma 7 still on `prisma-client-js` | CONFIRMED OPEN | `apps/api/prisma/schema.prisma:4-6` unchanged | Full item |
| P1-05 | 2,418-line schema should split by domain | CONFIRMED OPEN | Still exactly 2,418 lines | Full item |
| P1-06 | Root tsconfig is a web/Next config, not a neutral base | CONFIRMED OPEN (partially mitigated) | Root still carries `lib:[dom,…]`, `jsx: preserve`, `moduleResolution: bundler`, `allowJs`, and `paths` into `packages/core/src`. `tools/tsconfig.json` was added as a deliberate standalone so as not to pre-empt this refactor | Neutral `tsconfig.base.json` + per-runtime configs |
| P1-07 | bcrypt vs Argon2 documentation drift | CONFIRMED OPEN | `schema.prisma:134` and `:139` still say "Bcrypt"; runtime is argon2 | Full item (two comment lines) |
| P1/P2-08 | Move shared versions to pnpm Catalogs | CONFIRMED OPEN | Zero `catalog` occurrences in `pnpm-workspace.yaml` | Full item |
| P2-09 | Turbo `lint -> ^build` and redundant `packages/core/dist/**` output | CONFIRMED OPEN | Both persist in `turbo.json` | Full item |
| P2-10 | TypeScript 7.1 migration gate | DONE | HOLD recorded with explicit unblock condition — `.claude/skills/luke-deps/references/platform-policy.md:96`. The audit asked for a controlled decision, not adoption | None (revisit on 7.1 stable) |

### §5 — Observations requiring verification

| Item | Original concern | Disposition | Current evidence | Action still required |
|---|---|---|---|---|
| 5.1 | `@prisma/client` devDep of `@luke/core` may leak Prisma types into public `.d.ts` | NOT REPRODUCIBLE | The audit's own criterion fails: `packages/core/src` contains no `@prisma/client` import. `runtime/env.ts:27-37` deliberately declares a structural `IPrismaConfigClient` to avoid it. No declaration leakage exists | None for the stated concern. Separate minor fact: the devDependency appears unused in the package |
| 5.2 | Internal packages' module format is emergent, not explicit | CONFIRMED OPEN — elevated | `core`, `nav` and `calendar` have no `type` field while `exports.import` and `exports.require` both point at `./dist/index.js`. No longer theoretical: `apps/web/vitest.browser.config.mts` documents that a browser ESM context cannot take named imports from `@luke/core`, worked around by `optimizeDeps.include` | Decide the real contract (CJS / ESM / dual) and make it explicit |
| 5.3 | Root devDeps on `@luke/api` and `@trpc/client` may be misplaced | CONFIRMED OPEN (minor) | Both present. No root tooling imports either — `@trpc/client` hits under `tools/` are the platform checker's own family constants and fixtures; `@luke/api` appears only in generated report text | Verify they are not load-bearing for resolution, then remove |
| 5.4 | `allowJs: true` — tighten if all source is TS | CONFIRMED OPEN (minor) | `allowJs` in root + `core` + `nav` + `calendar`. The only JS source in the repo is `packages/eslint-plugin-luke/**`, a package none of those four configs covers | Low-priority cleanup |

### §6 — Agentic-development recommendations

| Item | Original concern | Disposition | Current evidence | Action still required |
|---|---|---|---|---|
| 6.1 | Convert recurring lessons into executable gates | ALREADY RESOLVED | Now the repository's standing discipline: `audit-protocol.md` §3 escalation, 8 `eslint-plugin-luke` rules, `.semgrep/rules/`, three checkers all carrying fixture suites (`12cb8e0`) | None — it is the operating model |
| 6.2 | Make dependency direction machine-checkable | CONFIRMED OPEN | No `no-restricted-imports`, boundary or graph rule in `eslint.config.mjs` | Full item |
| 6.3 | Rename `deps:latest` to expose blast radius | CONFIRMED OPEN | Still `"deps:latest": "pnpm update --latest"` | Trivial rename |
| 6.4 | Keep refactors single-purpose | ALREADY RESOLVED | Practised throughout the governance program — one architectural statement per commit, majors never bundled | None — preserve as policy |

### Supplemental item (not from the original audit)

| Item | Concern | Disposition | Evidence |
|---|---|---|---|
| S-01 | GitHub branch/ruleset enforcement | NEEDS DECISION | `develop-2.2` and `main` are unprotected with no required status checks. CI and security workflows run on push, so they report rather than gate. Enforcement today rests on `.husky/pre-push`, which is bypassable with `--no-verify` and absent for a push from another clone |

## A.2 Totals

| Disposition | Count |
|---|---|
| DONE | 3 |
| ALREADY RESOLVED | 2 |
| NOT REPRODUCIBLE | 1 |
| SUPERSEDED | 0 |
| CONFIRMED OPEN | 12 |
| NEEDS DECISION (supplemental) | 1 |

18 original items reconciled. Nothing was superseded: the governance program closed three findings outright and touched two others without invalidating either recommendation.

## A.3 Backlog

### Must do

- **SEC-A** — editor to LOCAL-admin account takeover. CONFIRMED CRITICAL, release-blocking. See A.5.
- **P1-07** — bcrypt/Argon2 documentation drift. A schema comment that misdescribes the credential algorithm is an agent-facing operational input, not decoration.
- **P0-02a** — Next/React/Hooks rules inactive. Highest-leverage item in the backlog: `react-hooks/exhaustive-deps` mechanically catches the defect class confirmed as BUG-B, and `apps/web` is extensively agent-generated. Requires installing `eslint-plugin-react-hooks`, which is absent.
- **5.2** — module-format ambiguity. Promoted from the audit's "verify" status because it has produced a real workaround in the browser test configuration.

### Should do

P0-02b (per-runtime globals) · BUG-B (wizard lock) · P1-04 (Prisma generator) · P1-06 (neutral tsconfig base) · 6.2 (dependency-direction enforcement) · P2-09 (Turbo graph) · S-01 (branch protection decision).

### Optional / defer

- **P1-05** — Prisma schema domain split. Valuable at 2,418 lines, but a large mechanical diff with no behavioral acceptance test beyond "still generates".
- **P1/P2-08** — pnpm catalogs. Version alignment is already deterministically gated by `checkVersionAlignment`, which covers the risk catalogs would partly mitigate. An ergonomics improvement, not a defect fix.
- **5.3**, **5.4**, **6.3**, inert `tools/*` workspace glob — minor hygiene, to be batched.
- **5.1** — unused devDependency, cosmetic.

P1-05 and P1/P2-08 are deliberately not classified as mandatory technical debt: both are sound ideas whose payoff is smaller than when the audit was written, because deterministic gates added since cover part of the risk they were proposed to reduce.

## A.4 Execution sequence

| Cycle | Goal | Closes | Model | Key evidence |
|---|---|---|---|---|
| 1 | SEC-A remediation | SEC-A | Opus | Integration tier; assert the persisted row is unchanged on rejection, not merely that an error was returned |
| 2 | Documentation-drift batch | P1-07 + governance prose drift | Sonnet | `check:drift` green; verify argon2 before rewording |
| 3 | ESLint framework activation | P0-02a | Opus (config) → Sonnet (triage) | A deliberately invalid bait file proving the rules fire. Integrate and measure only — no mass auto-fix |
| 4 | BUG-B wizard lock | BUG-B | Sonnet | Browser tier: mount with the layout query unresolved, assert both entity types acquired; warm-cache case stays green |
| 5 | Per-runtime globals | P0-02b | Sonnet | Bait file per runtime |
| 6 | `@luke/core` module format | 5.2 | Opus | Browser tier green with the `optimizeDeps` workaround removed |
| 7 | Turbo graph | P2-09 | Sonnet | Cold-cache lint green with the edge removed; timing before/after |
| 8 | Hygiene batch | 5.1, 5.3, 5.4, 6.3, `tools/*` glob | Sonnet | Clean install, `check:drift`, typecheck |

Later, unscheduled: P1-06 (with `tools/tsconfig.json` rebased onto it), 6.2, P1-04 then P1-05, P1/P2-08.

Ordering dependencies: cycle 3 before cycle 4 (the rule should demonstrate the bug class); cycle 3 before 6.2; cycle 6 before further ESM consumer work; P1-04 before any Prisma major; P1-06 before rebasing `tools/tsconfig.json`. Per §6.4 nothing above is bundled.

## A.5 Application findings preserved separately

Discovered after this audit was written. They are not evidence that the audit was wrong, and they are tracked here only so the execution order is complete.

- **SEC-A — CONFIRMED CRITICAL, release-blocking.** An `editor` holds `users:update`, which permits changing another LOCAL user's email with no `*:*` guard of the kind applied to password and role. The change neither clears verification state nor invalidates sessions by itself; the public password-reset flow can then target the reassigned address, and reset confirmation applies no role or origin check. Reset completion does increment `tokenVersion` and invalidate the victim's sessions — that affects detectability, not exploitability, since the password has already been changed. Requires the target to hold a LOCAL identity, which is a supported configuration and is what bootstrap creates.
- **BUG-B — CONFIRMED MEDIUM**, data-integrity/concurrency. On a cold React Query cache the planning wizard acquires only the `SEASON_CALENDAR` lock and never `COLLECTION_LAYOUT`, leaving nine `assertUnlocked` sites unprotected for concurrent editors, and later force-closes the wizard when the heartbeat renews a lock it never took. Not an authorization boundary: no privilege is gained and concurrent editors still need their own permissions.

## A.6 Not Monorepo Audit findings

The following are governance control-plane items from the separately closed Agent Platform Governance Audit v3. They are recorded here only to prevent them being absorbed into this audit's backlog by a later reconciliation:

Explore/fan-out checker fail-open · skill size budget decision · ADR 006–009 status disposition · CLAUDE.md rule 8 breadth · the future finding/adjudication ledger.

These are not Monorepo Audit findings and must not be merged into its execution program.

---

# Appendix B — Progress update (2026-08-31): SEC-A remediated

Appends to Appendix A; neither the historical body nor the baseline appendix is rewritten. Verified against `develop-2.2` at `d792b2f`, with CI and security green on that commit (Lint/TypeCheck/Unit, Browser Component Tests, Integration Tests, Migrations; gitleaks, semgrep, osv-push).

## B.1 SEC-A → DONE

Recorded in Appendix A §A.5 as CONFIRMED CRITICAL, release-blocking. Now closed on two counts, in two separate commits.

**`0fcacde` — `fix(auth): protect privileged user identity changes`.** The concrete chain is broken. `users.update` now requires `*:*` to change another account's authentication identity, an identity change clears `emailVerifiedAt` (the three self-service paths already did; this was the one cross-user path that did not) and revokes sessions through the existing `tokenVersion` mechanism, and the account holder is notified through the existing `createNotification` used for role, activation and password changes — no new subsystem.

**`d792b2f` — `refactor(auth): make cross-user updates default-deny`.** The first commit closed the takeover but kept the defect class: naming the sensitive fields is still a deny-list, so a field added to `UpdateUserInputSchema` later would have defaulted to editor-writable until somebody remembered to classify it. Inverted. `USER_EDITOR_UPDATABLE_FIELDS` is now the allow-list and the only list; the privileged set is derived as its complement from the schema shape at runtime.

## B.2 Evidence

**Red before green.** The regression suite was written first and run against the unfixed router, which failed with `Expected operation to be unauthorized, but it succeeded` on the editor cases and `expected 2026-08-31T15:51:28.508Z to be null` on the verification state. 4 failures pre-fix, 13/13 after `0fcacde`, 17/17 after `d792b2f` as the matrices grew.

**Full integration.** 42 files, 525 passed, green locally and in CI against its own Postgres. `procedure-coverage` required decrementing the `auth` namespace's declared-uncovered count, since the chain test now invokes `requestPasswordReset` — the gate caught that itself.

**Default-deny proven, not asserted.** Adding an unclassified `phone` field to `UpdateUserInputSchema` places it in the privileged complement automatically, with no edit to the classification, and fails the build until it is covered:

```
test/users.integration.spec.ts: error TS2741: Property 'phone' is missing in type
  '{ email: string; username: string; role: string; }'
  but required in type 'Record<PrivilegedUserUpdateField, unknown>'
src/routers/users.core.router.ts: error TS7053: expression of type
  'PrivilegedUserUpdateField' can't be used to index type '...User...'
```

The second fires on `@luke/api:build`, so an unclassified field breaks the production typecheck and not only the tests. The schema was restored byte-identical after the probe. Note the layering: the deny itself is automatic and does not depend on anyone noticing a compile error; the compile error exists to force test coverage for the new field.

Both regression matrices iterate the same two declarations the router consumes, plus a runtime assertion that the two sets partition the schema exactly, so the authorization surface cannot be tested against a stale copy of itself.

## B.3 Recorded separately

**LOW / NEEDS DECISION — editor may deactivate another user; this is now an explicit entry in `USER_EDITOR_UPDATABLE_FIELDS` rather than a permission inherited by omission.**

Not classified as a security defect here. Whether an editor should retain this capability depends on the intended product role model, which this audit has no basis to decide. It is already bounded by the self-deactivation guard and `assertNotLastAdminWithSettingsAccess`, and it is account state rather than authentication identity. What changed is visibility: it is a deliberate classification a reader can find and question, instead of a default nobody wrote down.

## B.4 Execution status

**The repository has no known release-blocking CRITICAL.**

`BUG-B` remains CONFIRMED MEDIUM — incomplete wizard lock on a cold React Query cache; data-integrity/concurrency, not an authorization boundary. It is scheduled at cycle 4 of the Appendix A sequence, after ESLint framework activation, so the `react-hooks/exhaustive-deps` rule demonstrates the defect class rather than the fix hiding the rule's value.

The next scheduled work is unchanged: cycle 2, the documentation-drift batch.

---

# Appendix C — Cycle 2 documentation-drift remediation (2026-08-31)

Appends to Appendix A and Appendix B; neither the historical body nor either earlier appendix is rewritten. Commit `8b63b83` on `develop-2.2`, pushed after local verification and the full `.husky/pre-push` gate ran green at push time.

## C.1 Cycle 2 → DONE

Per A.4, closes `P1-07` and the three governance-prose-drift items scheduled alongside it. Commit `8b63b83` — `docs(platform): remove stale operational assertions`.

## C.2 Corrections

**`P1-07` — bcrypt/Argon2 documentation drift.** `apps/api/prisma/schema.prisma` described `LocalCredential` and its `passwordHash` field as Bcrypt. Verified against the actual implementation before rewording: `apps/api/src/lib/password.ts` hashes and verifies with `argon2.hash`/`argon2.verify` under `argon2id`, `apps/api/package.json` declares `argon2 ^0.45.1`, and `apps/api/src` has zero remaining `bcrypt` references. Both comments now read Argon2id, with a pointer to `lib/password.ts`.

**`security.yml` stale default-branch/schedule prose.** The `osv-push`/`osv-weekly` comments asserted, as a point-in-time fact, that the workflow file was absent on `main`. Rewritten as the durable invariant instead: GitHub evaluates `schedule` triggers from the workflow file committed on the default branch, so this file must stay there for `osv-weekly` to keep firing. The 2026 incident — the file's prior absence on `main` left `osv-weekly` never running, so 24 known vulnerabilities went unnoticed, 3 of them critical on the authentication layer — is kept as grounding for why `osv-push` is blocking, explicitly framed as history rather than current state, so the comment does not itself drift back into a dated assertion.

**`git-reminders.sh` gate-enumeration drift.** The pre-commit reminder claimed a `typecheck + lint + test` check that `.husky/pre-commit` does not run — that combination runs at `.husky/pre-push`. The reminder now names the two canonical hook files directly instead of carrying its own copy of their contents.

**`luke-deps` stale "no automated gate" assertion.** `SKILL.md` §6 stated CLAUDE.md rule 9 (workspace version alignment) had no automated gate. `checkVersionAlignment` (`tools/scripts/check-platform-integrity.ts:300`, invoked at `:610`) is now part of the deterministic platform-integrity checker wired into `pnpm check:drift`. The manual `jq`/`awk` command is kept as a convenience for an interactive dependency pass, no longer described as the interim control.

## C.3 Scope confirmation

Diff reviewed line by line: every changed line is a Prisma `///` comment, a YAML `#` comment, an echoed reminder string, or Markdown prose. No model field, workflow trigger/job/permission/action, hook case logic, or skill command changed — Cycle 2 introduced no runtime or workflow behavior change. `pnpm check:drift` green before and after each edit; `prisma validate` green; `pnpm test:tools` 46/46. At push time the full `.husky/pre-push` gate ran green: typecheck across 6 packages (13/13 tasks), `tools/` lint + typecheck + test, 861 unit tests across `@luke/core`, `@luke/web`, `@luke/calendar`, `@luke/api` and `eslint-plugin-luke`, then `check:drift` again.

## C.4 Execution status

Cycle 2 is DONE. Per A.4, cycle 3 — ESLint framework activation, closing `P0-02a` (Opus for configuration, Sonnet for triage) — is next.

---

# Appendix D — Cycle 3A ESLint framework activation (2026-08-31)

Appends to Appendices A–C; neither the historical body nor any earlier appendix is rewritten. Commit `c931df1` on `develop-2.2`, CI and security green on that SHA (Lint/TypeCheck/Unit, Browser Component Tests, Integration Tests, Migrations; gitleaks, semgrep, osv-push).

## D.1 P0-02a → DONE

`eslint-config-next` was already a declared devDependency at both root and `apps/web` — installed, never referenced by the flat config. The React, React Hooks, jsx-a11y and `@next/next` rules had never executed. `eslint-config-next/core-web-vitals` is now actually consumed for `apps/web`.

**Entries consumed**, selected by name and re-scoped to the web surface: `next` (React, React Hooks, jsx-a11y, `@next/next` recommended) and `next/core-web-vitals`, which promotes `no-html-link-for-pages` and `no-sync-scripts` from warn to error and ships with no `files` glob of its own — unscoped it would have applied to the whole monorepo. Consuming the preset rather than naming plugins keeps `eslint-plugin-react-hooks` out of the manifests, so the version that lints is the one Next pinned.

**`next/typescript` deliberately excluded.** It registers a second `@typescript-eslint` plugin instance at 8.62.0 against the 8.68.0 this repo pins. Two objects under one plugin key is a hard ESLint error, and the older copy would have decided TS rule behaviour for `apps/web` alone.

**React version resolved, not hard-coded.** `settings.react.version` must be set at all because `eslint-plugin-react` still calls `context.getFilename()` on its `detect` path, removed in ESLint 10, and throws before any rule runs. The value is read through Node module resolution rooted at `apps/web` rather than written into the config, so React's version stays single-sourced in the manifest. `--print-config` confirms `19.2.8`, the version `apps/web` actually resolves.

## D.2 Non-vacuity

The same bait file produces **zero** framework findings under the pre-activation config and React Hooks, Next and jsx-a11y findings under the new one — `rules-of-hooks` (error), `exhaustive-deps`, `no-img-element`, `alt-text`, and `no-sync-scripts` at the error severity the core-web-vitals layer gives it. That separates "the preset is active and the repo is clean" from "the preset never loaded" by construction. The same 312 files that linted clean before now report 123 findings.

## D.3 Measured debt

**72 errors and 51 warnings across 62 of 312 web files.** Largest contributors: `react-hooks/set-state-in-effect` (34E/26 files), `react-hooks/exhaustive-deps` (28W/21), `react/no-unescaped-entities` (23E/12), `react-hooks/incompatible-library` (16W/16). Most of the error volume is React Compiler tier — `eslint-plugin-react-hooks` v7 ships 16 rules, not the classic two. The core-web-vitals layer added enforcement without adding debt: both rules it promotes have no violations here.

## D.4 Transition mechanism

No rule severity was weakened. Both halves of the debt are pinned at today's count and can only be paid down:

- the 72 errors are held in `apps/web/eslint-suppressions.json`, ESLint's own bulk suppression file, as an exact count per file per rule across 41 files;
- the 51 warnings stay visible on every run, capped by `--max-warnings 51` in `apps/web`'s lint script.

Every rule keeps the severity the preset ships, so any rule with no debt today — `rules-of-hooks` and the erroring `@next/next` rules among them — blocks on its first violation. The path to full enforcement is `--prune-suppressions` and a smaller number, not a config edit.

**Ratchet proven by probe, not assumed.** Four baits each fail the run: an extra violation of an already-suppressed rule in an already-suppressed file, a 52nd warning, a new `rules-of-hooks` error, and a new `no-sync-scripts` error. The clean tree returns to exit 0 after each.

## D.5 BUG-B is now mechanically surfaced

`react-hooks/exhaustive-deps` flags `useWizardLock.ts:65` and `:99`, naming the missing `targets` dependency that is the defect's mechanism: `PlanningWizard.tsx:74` pushes `COLLECTION_LAYOUT` into `lockTargets` only once `layout?.id` resolves, so on a cold cache the acquire effect runs with `[enabled]` deps and never re-runs. The rule reports a missing dependency, not a lock-protocol defect — it does not know what `targets` means — but the dependency it names is the one whose omission causes BUG-B. The Appendix A ordering rationale for cycle 3 before cycle 4 holds.

## D.6 No remediation

No surfaced application violation was fixed in Cycle 3A. Scope was activation and measurement only; `P0-02b` and BUG-B were not touched, and no dependency was added, removed or upgraded.

## D.7 Recorded without changing priority

- **P2-09 evidence strengthened.** `turbo.json`'s `lint` task declares no `inputs`, and `globalDependencies` covers only `**/.env.*local`, so a change to the root `eslint.config.mjs` does not invalidate the lint cache — a config change can appear green locally without rerunning. CI is unaffected (cold cache, remote caching disabled). Kept for its scheduled Turbo-graph cycle.
- **Transitive `typescript-eslint` split is informational only.** `eslint-config-next` resolves 8.62.0 while the repo pins 8.68.0. It has no effect because the Next entry that would register it is not consumed, and `checkVersionAlignment` compares declared manifest dependencies rather than transitive ones.

## D.8 Execution status

Cycle 3A is complete. Per A.4, cycle 4 — BUG-B, the wizard lock, on the browser tier — is next.

---

# Appendix E — Cycle 4 BUG-B remediation (2026-08-31)

Appends to Appendices A–D; neither the historical body nor any earlier appendix is rewritten. Implementation commit `10aca07` on `develop-2.2`; a second commit, `1f84a4b`, was required to get CI green — see E.6. CI and security fully green on `1f84a4b` (Lint/TypeCheck/Unit, Browser Component Tests, Integration Tests, Migrations; gitleaks, semgrep, osv-push).

## E.1 BUG-B → DONE

Recorded in Appendix A §A.5 as CONFIRMED MEDIUM, data-integrity/concurrency, not an authorization boundary.

## E.2 Root cause

`useWizardLock`'s acquire effect depended only on `[enabled]`. A cold React Query cache produced an incomplete initial target set (`SEASON_CALENDAR` only — `COLLECTION_LAYOUT`'s id not yet resolved), and the effect acquired it. A boolean latch (`acquiredRef`) recorded only that acquisition had happened, not which targets were granted, so it never re-fired once the complete set became available. The renew effect closed over `targets` by reference rather than by dependency, so it could later renew a target set different from — and not a subset of — what was actually acquired, attempting to renew `COLLECTION_LAYOUT` when no such lock existed.

## E.3 Final invariant

Unresolved dependency discovery → wizard unusable, no acquisition attempted. Successful target discovery → the complete target set, computed once. Successful acquisition → wizard usable. Acquire, renew and release all operate on the exact set frozen at acquisition (`acquiredTargetsRef`), never on whatever the live `targets` value happens to be when renew/release run.

## E.4 Query-state distinction

`computeLockTargets` reads the layout query's own `status` (`'pending' | 'error' | 'success'`) rather than a bare pending flag:

- `pending` → no acquisition (targets `null`).
- `error` → no acquisition (targets `null`) and the existing error UX — a failed `collectionLayout.get` leaves the complete dependency set genuinely unknown, so it is never treated as "no layout."
- `success` with a layout → `SEASON_CALENDAR` + `COLLECTION_LAYOUT`.
- `success` with `null` → `SEASON_CALENDAR` only. `collectionLayout.get`'s `null` is Prisma's ordinary "no row" result (a bare `findUnique`), not an error path — confirmed from `apps/api/src/services/collectionLayout.service.ts`, not assumed.

## E.5 Deferred acquire/unmount race

Proven in both orderings, not just asserted: acquisition resolving before cleanup runs (cleanup releases the frozen `acquiredTargetsRef` set) and cleanup running first, before the ref is ever populated (the async continuation's own `cancelled` check releases the just-granted set once it lands late). Both orderings assert `release` called exactly once — neither a leaked lock nor a double release.

## E.6 Browser coverage

26 tests across two files, both required to get CI green:

- `wizardLock.browser.test.tsx` (13 tests) — `computeLockTargets`'s pending/success/error/no-layout target computation directly, and `useWizardLock`'s lifecycle via `vitest-browser-react`'s `renderHook` against a mocked tRPC client: cold cache, warm cache, legitimate no-layout, renew/release pinned to the acquired set, no reacquisition on an unrelated rerender, both race orderings from E.5, and error surfacing on a rejected acquire.
- `planningWizardReadiness.browser.test.tsx` (5 tests) — the same invariant at the real `PlanningWizard` boundary via a full render, not only `renderHook`: cold layout pending leaves Next/Indietro disabled and no event content rendered; layout resolved but `acquireMany` still pending stays unusable; a successful grant makes it usable; a legitimate `null` layout still becomes usable (calendar-only); a layout query error acquires nothing and stays unusable with the error surfaced.

**CI caught what a local run did not.** The first push (`10aca07`) failed CI's Browser Component Tests job: mounting the real `PlanningWizard` reaches `@radix-ui/react-dialog`, `@radix-ui/react-scroll-area` (via `FreezePlanningGroupWizard`'s `ScrollArea`, statically imported though never rendered), `@tanstack/react-query`, `@trpc/client`, `@trpc/react-query`, `next-auth/react` and `sonner` — none pre-bundled in `vitest.browser.config.mts`'s `optimizeDeps.include`. Vite discovered them mid-run instead of before it, reloaded its dependency graph mid-test, and every component that had already mounted a hook threw `Invalid hook call` against the discarded React instance — all 5 `planningWizardReadiness` tests failed with `Cannot read properties of null (reading 'useRef')`. Silent locally because this session's `.vite` cache was already warm; reproduced deterministically with `rm -rf node_modules/.vite` (matching what a cold CI checkout always has), fixed by adding the seven deps to `optimizeDeps.include`, and reverified cold three times — isolated file and full suite, zero reload warnings, 26/26 each time — before pushing `1f84a4b`. No application code changed in that commit.

## E.7 ESLint evidence

Both `react-hooks/exhaustive-deps` warnings BUG-B's target files carried (`useWizardLock.ts:65` and `:99`, named in Cycle 3A's Appendix D measurement) disappeared by construction — the effect's dependency array is now complete, no suppression added. A suppressed `react-hooks/preserve-manual-memoization` finding on the same `lockTargets` `useMemo` disappeared too, as a byproduct of the same fix rather than a separate target. Warning ratchet reduced `--max-warnings` 51 → 49, matching the genuine warning count decrease. Bulk suppression debt reduced 72 → 71 entries (41 → 40 files) — verified by re-running `--prune-suppressions` and diffing the suppression file: exactly the one now-stale entry removed, nothing else touched. No unrelated framework finding was fixed or suppressed.

## E.8 No backend change

`apps/api`'s `editLock` router and service (`acquireLocks`/`renewLocks`/`releaseLocks`) are untouched. The fix is entirely in `apps/web`'s lock-acquisition timing and target-discovery logic.

## E.9 Test/gate evidence

`pnpm --filter @luke/web test:browser`: 26/26, reproducibly cold. `pnpm --filter @luke/web test`: 80/80. `pnpm typecheck` / `pnpm typecheck:test` (full repo): green. `pnpm lint --force`: 0 errors, 49 warnings, exit 0. `pnpm check:drift`: green. CI on `1f84a4b`: Lint/TypeCheck/Unit, Browser Component Tests, Integration Tests, Migrations all `success`; security: gitleaks, semgrep, osv-push `success`.

## E.10 Execution status

Cycle 4 is complete. Per A.4, cycle 5 — per-runtime globals, closing `P0-02b` (Sonnet, evidence: a bait file per runtime) — is next.

---

# Appendix F — Cycle 5 per-runtime ESLint globals (2026-09-01)

Appends to Appendices A–E; neither the historical body nor any earlier appendix is rewritten. Implementation commit `ba88602` on `develop-2.2`.

## F.1 Disposition

**`P0-02b` → CONFIRMED OPEN, PARTIALLY ADDRESSED.** Six of seven identified runtime surfaces are now deterministically constrained; the general `apps/web` surface is not, and cannot be by a config change alone — see F.10.

## F.2 Why the original configuration was over-permissive

The common TypeScript block merged `globals.browser` and `globals.node` across every workspace it covered — `apps/api`, `apps/web`, and `packages/core`/`nav`/`calendar` alike — so a genuine wrong-runtime reference (`window.` in a Fastify handler, `Buffer` in a React component) typechecked and linted clean. Cycle 3A's Next framework blocks (`webFrameworkBlocks`) independently contributed both sets a second time, on the same files. `languageOptions.globals` merges cumulatively across every flat-config block that matches a file — confirmed empirically, not assumed — so narrowing only a later block would not have removed either earlier grant; both had to be found and stripped.

## F.3 Resulting architecture

Shared parser/plugins/rules stay runtime-neutral (no `languageOptions.globals` on the common block). Runtime globals are supplied exclusively by narrower blocks, each paired with `ignores` so a file's globals come from exactly one place. `webFrameworkBlocks` no longer sets `languageOptions.globals` at all; it relies on the same isomorphic web block everything else in `apps/web` does.

## F.4 Surfaces now deterministically constrained

| Surface | Globals |
|---|---|
| `apps/api` | Node-only |
| `packages/nav` | Node-only |
| `packages/calendar` | Node-only |
| `packages/core/src/server/**`, `crypto/**` | Node-only |
| general `packages/core` | no ambient runtime grant |
| `packages/core/src/runtime/env.ts` | only `window`, `process`, `URL` |
| `packages/core/src/net/url.ts` | only `URL`, `URLSearchParams` |
| `packages/core/src/storage/types.ts` | only `NodeJS` |
| web route handlers, `auth.ts`, `auth.shared.ts`, `lib/authz/**` | Node-only |
| `apps/web/src/lib/**/*.test.ts` (Node Vitest tier) | Node-only |
| `apps/web/src/**/*.browser.test.tsx` (browser Vitest tier) | browser-only |
| `apps/web/src/proxy.ts` (Next Edge middleware) | `globals.worker` + `process` |
| `tools/**` | Node-only, unchanged |

`packages/core`'s narrowing was evidence-driven, not assumed: a grep sweep for `window`/`document`/`process`/`Buffer`/`require`/`NodeJS` found exactly two real bridge files (a few more were prose false positives — "time window", "approval window"); actually running the resulting neutral-by-default config (`pnpm --filter @luke/core lint`) then surfaced `URL`/`URLSearchParams` in `net/url.ts` and one further `URL` use in `runtime/env.ts` — a gap the grep sweep had no way to find, since it wasn't searched for. Both constructors are genuinely universal (present identically in `globals.node` and `globals.browser`, confirmed against the `globals` package directly), so they were granted only to the two files that use them rather than broadening the package again.

`proxy.ts`'s grant is evidenced from Next's own source, not guessed: `next/dist/server/web/globals.js`'s `enhanceGlobals()` installs a `process` object specifically for `NEXT_RUNTIME === 'edge'`; `next/dist/server/web/adapter.js`, the real Edge sandbox, references `URL`/`Headers`/`fetch`, all present in the `globals` package's own `worker` preset (already a dependency) alongside the DOM/Node exclusions Edge actually has.

## F.5 Bait proof (real lint runs, not `--print-config` alone)

| Block | Accepted | Rejected (`no-undef`) |
|---|---|---|
| Node (api/nav/calendar/core-server/core-crypto/web-authz/web-route/web-node-test/tools) | `Buffer` | `window` |
| Browser (vitest-browser tier) | `window` | `Buffer` |
| Core-neutral (ordinary file) | — | `URL`, `window`, `Buffer`, `process` |
| `runtime/env.ts` | `window`, `process`, `URL` | `Buffer`, `require` |
| `storage/types.ts` | `NodeJS` (type position) | `Buffer`, `window` |
| `proxy.ts` (Edge) | `fetch`, `Request`, `self`, `process` | `window`, `Buffer`, `require`, `module` |
| Isomorphic (core-universal, web-general) | both | — |

Exact-path-matched files (`proxy.ts`, `runtime/env.ts`, `storage/types.ts`, `net/url.ts`) were backed up, overwritten with bait, tested, and restored — verified byte-identical (`diff` clean, matching sha256) after every pass. One methodology correction made mid-cycle: an early `key in globals` presence check misread the `globals` package's convention (it uses the boolean `false` for *readonly*, not *absent*), giving a false read on `proxy.ts`; all reported results above are from actual `npx eslint` runs against real files, not that heuristic.

## F.6 `--print-config` evidence

Ten-plus representative files checked for `window`/`document`/`Buffer`/`process`/`require`/`URL`/`NodeJS` presence, each matching its intended block exactly: Node-only files show `window=false`; browser-tier shows `Buffer=false`; `proxy.ts` shows zero DOM/Node keys but `fetch`/`Request`/`self`/`process` present; the two isomorphic blocks show the full set. Parser stayed `typescript-eslint` on every file — flat config merges `languageOptions` per sub-key, confirmed, so omitting `parser` from a narrower globals-only block does not reset it.

## F.7 P0-02a still active

Re-verified live with a real bait, twice (once per commit in this cycle's iteration): `react-hooks/rules-of-hooks` and `@next/next/no-sync-scripts` (the Cycle 3A CWV-promoted rule) both still fire exactly as before. Cycle 5 did not touch, weaken, or accidentally disable any Cycle 3A rule.

## F.8 Lint debt

Unchanged: **71 suppressed errors / 49 warnings**, identical to the Cycles 3A/4 baseline, reconfirmed after every amendment in this cycle. Cycle 5 changed zero counted lint findings — only where globals come from.

## F.9 No application change

No application source or runtime behavior changed. The only file touched by the Cycle 5 implementation commit is `eslint.config.mjs`.

## F.10 Remaining `P0-02b` gap

The general Next App Router web surface (`apps/web/src/**`, `apps/web/tests/**`, minus the carve-outs in F.4) cannot be represented honestly as one runtime per file using flat-config path globs, and is not treated as resolved:

- Server Components and Client Components are co-located — `page.tsx`/`layout.tsx` pairs sit on both sides of the `'use client'` line throughout `app/`, with no directory boundary between them, confirmed directly against this repo's own file tree.
- `'use client'` does not classify every transitive client module — a no-directive leaf component (e.g. a shared `components/ui/*` primitive) is bundled wherever its importer places it.
- An undirected shared module can therefore legitimately enter either the server or the client module graph depending on which component imports it — the same source file, not an under-annotated one.
- Assigning either browser-only or Node-only globals to this surface per file would create a false runtime model, not a more precise one.

Investigated and rejected as fixes within this cycle: no official Next/`eslint-config-next` boundary rule exists (checked; Next's own GitHub discussion #80741 requesting one is still open); three community `'use client'` plugins exist but solve a different problem (directive necessity, not global scoping) and are unofficial/experimental; a custom rule assigning one runtime per file from directive presence would be structurally wrong for exactly the shared/leaf components above, which legitimately need both.

Finishing this part requires a different enforcement layer — most plausibly import/dependency-boundary-aware tooling, or adopting Next's own `server-only`/`client-only` build-time marker packages (not currently used in this repo) — and should be reconsidered together with the later `6.2` dependency-direction/boundary work, not by broadening this cycle's config further.

## F.11 Unrelated security-gate interruption

Between this cycle's implementation push and its audit recording, `osv-push` failed on `ba88602` (security run 33494115928) on a newly-disclosed advisory, `GHSA-rgwj-5xj2-c3m3` in `mysql2@3.15.3` (a transitive dependency of the `prisma` CLI package, never reachable from any LUKE runtime — this workspace's only `schema.prisma` is Postgres-only). Confirmed unrelated to this cycle: `pnpm-lock.yaml` had not changed since before this session's work, and the immediately preceding push (`1f84a4b`, Cycle 4) had a clean `security` run on the identical lockfile — the advisory was disclosed to OSV between the two pushes, not introduced by anything here. Remediated separately in `65f005cc289885399b734970af3caebb6ac262fb` (`pnpm-workspace.yaml` override, `mysql2` → `3.24.2`), verified green on that commit, and the auto-filed tracking issue (#27) closed. Recorded here only as the reason Cycle 5's own audit entry was written a step later than its implementation commit — not as `P0-02b` scope, and not touching `eslint.config.mjs` or the `ba88602` diff.

## F.12 Execution status

Cycle 5 is complete as a bounded hardening cycle. `P0-02b` remains partially open per F.1/F.10 — its closure is deferred to the boundary-aware enforcement work noted above, not scheduled as its own numbered cycle here. Per A.4, cycle 6 — `@luke/core` module format, closing `5.2` (Opus) — is next; it has no dependency on the remaining `P0-02b` portion.

---

# Appendix G — BUG-B retrospective reopening and final remediation (2026-09-01)

Appends to Appendices A–F; neither the historical body nor any earlier appendix is rewritten. Implementation commit `b859ed8` on `develop-2.2`. CI and security fully green on that exact SHA (run 33519979546: Lint/TypeCheck/Unit, Migrations, Integration Tests, Browser Component Tests; run 33519979425: gitleaks, semgrep, osv-push).

## G.1 Disposition

**`BUG-B` → DONE.**

Appendix E remains historically correct: it records the state of knowledge at that checkpoint, and every claim it makes about the Cycle 4 diff was true of that diff as reviewed and as verified by CI at the time. Appendix G does not correct it. It records later evidence, the reopening that evidence justified, and the final remediation — the audit history is appended to, never rewritten.

## G.2 Why the reopening is legitimate

`BUG-B` was marked DONE in Appendix E §E.1 after Cycle 4. A later **read-only `/code-review high` of the historical Cycle 4 commit range** (`9abae0b..1f84a4b`) found a real correctness regression introduced by that remediation. Three independent finder passes reached the same root cause, each tracing it through the installed `@tanstack/query-core` source rather than from the diff alone.

That is new repository evidence about code that is still running, not a re-reading of the audit record. The reopening therefore rests on the defect, not on any revision of what Appendix E concluded — which is exactly the distinction §A.0's stability rule exists to protect.

## G.3 The reopened defect

Cycle 4 bound the whole lock lifecycle to the discovery query's *live* output. `targets` sat in the acquire effect's dependency array, so any later identity change ran that effect's cleanup — which released the granted set.

`computeLockTargets` returns `null` for every non-`'success'` layout query status, and `@tanstack/query-core`'s reducer sets `status: 'error'` **unconditionally** on a failed fetch, prior success or not (verified in `node_modules`, not assumed: the `'error'` case does not consult whether data already exists). A single background refetch failure of `collectionLayout.get` after a successful acquisition was therefore enough to:

1. flip `lockTargets` to `null`,
2. run the acquire effect's cleanup, releasing the live `SEASON_CALENDAR`/`COLLECTION_LAYOUT` lock,
3. re-run the effect, which saw `targets === null` and acquired nothing.

`state.expiresAt` was never cleared by that path, so `isReady` stayed true: the wizard kept reporting a usable session while holding no lock at all, and a concurrent editor could take the same entities.

## G.4 Secondary effects of the same defect

- **Stale heartbeat closure.** The renew/backstop effect captured `acquiredTargetsRef.current` once per run and depended only on `[state.expiresAt, state.error, renew]` — nothing that reacted to the cleanup nulling that ref. Its already-scheduled timers could therefore `renew` a target set that had just been released, or force-expire the session against a deadline that no longer corresponded to anything held.
- **Close-confirmation bypass.** `requestClose` skipped `ConfirmDialog` for any `displayError`, on the premise that an error meant the session was never usable. `layoutQuery.isError` breaks that premise after readiness: a transient refetch failure could discard unsaved draft dates on a click the user read as a plain dismissal.

## G.5 First remediation — explicit session semantics

Discovery and an active lock session became two phases of one state machine, `WizardLockSession`: `idle | acquiring | held | lost`, with `held` carrying the two independent degradations `renewError` and `scopeChanged` (one writer each — the heartbeat and the discovery reducer — so neither clobbers the other's signal).

The granted set is frozen at grant time in `grantedRef` and is what renew and release always operate on. The discovery→session boundary is a pure exported function, `reduceDiscovery`, so it reads and tests as a table rather than being inferred from dependency arrays. Release moved to an effect scoped to the whole `enabled` window, outliving the acquire effect and every degradation transition.

## G.6 Second finding — same-user overlapping acquisition

A pre-push `/code-review high` of that first remediation found a further defect in the same class. `releaseLocks` (`apps/api/src/services/editLock.service.ts`) deletes by `(lockedByUserId, entityType, entityId)`; the `EditLock` row carries **no acquisition or session token**. The server therefore cannot distinguish one attempt's release from another attempt's grant *by the same user on the same entity*.

Two overlapping `acquireMany` calls from one wizard are consequently inseparable at the boundary: attempt A becomes obsolete, successor B starts, B is granted server-side, and A's late cancellation release then deletes the row B depends on — while the UI still reports a healthy lock and the next heartbeat fails `CONFLICT`.

Subtracting the already-granted set from an abandoned release was rejected as the fix: it closes only the orderings in which a grant already exists, not two acquisitions racing before either has landed.

## G.7 Final design — per-instance RPC serialization

Every lock RPC the hook issues is serialized through one promise queue per hook instance:

> at most one `acquireMany` is outstanding, and a successor is not sent until its predecessor has settled and — if it was granted — been released.

- An acquisition is *enqueued*, not started; it checks its obsolescence flag at the top of its turn, so an attempt superseded while queued never reaches the network (latest-wins across any number of discovery changes).
- An attempt that was granted after becoming obsolete **awaits** its release before returning. `release` is consumed as `mutateAsync` precisely so this is possible: awaiting is what makes the release *ordered* before the successor's acquire, rather than merely issued first.
- The session-scoped release is enqueued on the same queue, so a wizard closed and immediately reopened cannot have the old release racing the new acquisition.

Proof: the acquire RPC is issued inside a queue step, the step does not return until that RPC (and any obsolete-grant release) has settled, and steps run strictly sequentially. Structurally, once a session reaches `held` no further acquisition is ever enqueued for its lifetime, so the reported ordering is unreachable twice over. **No backend change and no session token were required** — the frontend simply never puts the server in a position where it would have to tell the two apart.

## G.8 Phase authority, settled

- **Before a grant:** discovery is authoritative. `pending`/`error` mean the dependency set is unknown, so nothing is acquired — never a partial set. An obsolete in-flight attempt may be stood down or switched, and its late grant is released exactly once.
- **After a grant:** discovery decides nothing. It cannot tear down, replace or extend the held set.
- **Post-acquisition query error:** the held session is left intact — no release, no reacquisition, and the heartbeat keeps renewing exactly the granted set.
- **Post-acquisition target divergence:** the granted set is preserved and the divergence is reported as `scopeChanged`, which blocks mutation. Releasing to reacquire would open the concurrency gap this hook exists to close; extending in place is `BUG-B`'s original defect class. Neither is an option, so the session keeps precisely what it was granted and says so.

## G.9 `PlanningWizard` semantics

- **Close confirmation** now distinguishes a discovery failure *before* the session was ever usable from a background failure *after* it was, and from an actual lock loss. Only the first is a proof that no draft edit can exist — `EventStep` renders only under a held session — and it is now the only one that skips the confirmation. A degraded-but-previously-usable session still confirms.
- **Expiry side effects moved out of render.** `toast.error` plus `onClose` in the render body called the parent's setState during this component's render and fired once per render attempt; they now run in an effect behind a latch, which is what makes them exactly-once given that `onClose` is an inline arrow with a fresh identity every parent render.
- **`handleNext` and `handleBack` enforce mutation readiness themselves** rather than trusting the buttons' `disabled`. `Indietro` in particular was gated only on `isReady`, so on a degraded session it stayed enabled behind the error banner and could move `stepIndex` under content the user could not see.
- **`reduceDiscovery` tests `targets === null` explicitly** instead of the key's truthiness: `lockTargetsKey([])` is `''`, so a falsiness check would have read a concrete empty set as "discovery unsettled" and let a `held` session report itself healthy against a set it demonstrably does not hold.

## G.10 Queue rejection recovery

The queue's non-rejection is structural, not a bet that every step is internally exhaustive. A throw escaping a step from somewhere it does not guard — the acquire step formats its error inside its own `catch`, for one — would otherwise leave the chain rejected permanently, skipping every later step. The step that costs something there is the release on unmount: a poisoned queue does not merely stop acquiring, it leaks the held lock until its server-side TTL. Recovery cannot let a successor overtake a predecessor, since a rejection is a settled state: the recovering `catch` still runs strictly after the step it recovers, and the next step chains after it.

## G.11 Test progression

Regression coverage was written **red before green** in both rounds, and the invariant tests are demonstrated non-vacuous by mutation rather than asserted to be meaningful:

- Round one: 26 failing tests before the state-machine remediation, including the defect itself — a discovery change during an in-flight acquisition producing `expected 1 times, but got 2 times` on `acquireMany`.
- Round two: the poisoned-queue test failed with the chain rejected (`expected 2 times, but got 1 times`, plus an unhandled rejection) before the recovery was added.
- **Completion, not invocation.** Both serialization orderings — obsolete-grant release and close→reopen — are proven with a *deferred* release double, so they assert that the predecessor's release has **completed** before the successor acquisition starts. Call-order assertions alone would pass against a fire-and-forget release, which is the defect. Verified by mutating the source twice: dropping the `await` on the obsolete release fails the first test alone, and making the session-scoped release fire-and-forget fails the second alone. The source was restored and re-verified green after each.

## G.12 Final evidence

Browser suite cold (`rm -rf node_modules/.vite`, matching a cold CI checkout): **59/59**, no dependency-reload warnings, no unhandled rejections. Web unit: **80/80**. `pnpm typecheck` and `pnpm typecheck:test` (full repo): green. `pnpm lint --force`: **0 errors, 49 warnings** — the Cycles 3A/4/5 baseline, unchanged. Suppression debt: **71 suppressed errors across 40 files**, unchanged; neither touched file carries an entry, so pruning cannot move it. `pnpm check:drift`: green.

Implementation commit `b859ed8`, four files, all under `apps/web/src/app/(app)/calendar/_components/PlanningWizard/`. CI run **33519979546** — Lint/TypeCheck/Unit, Migrations, Integration Tests, Browser Component Tests all `success`. Security run **33519979425** — gitleaks, semgrep, osv-push all `success`. Both on `b859ed8` exactly.

## G.13 Scope confirmation

`apps/api`'s `editLock` router and service are untouched, as in Cycle 4: the final design deliberately avoids a lock-protocol change. No Cycle 5 file was touched and **`P0-02b` is unchanged — it remains CONFIRMED OPEN, PARTIALLY ADDRESSED** per §F.1/§F.10. Cycle 6 was not started.

## G.14 Execution status

`BUG-B` is closed. Per A.4, cycle 6 — `@luke/core` module format, closing `5.2` — remains next and is not started here.

---

# Appendix H — Cycle 6 explicit internal package module contracts (2026-09-01)

Appends to Appendices A–G; neither the historical body nor any earlier appendix is rewritten. Implementation commit `58df5498e7a8cbe821908a8044fe2ad69b72c003` on `develop-2.2`.

## H.1 Disposition

**`5.2` → DONE.** The three internal packages now declare module contracts that match the artifacts they publish. `@luke/core` is ESM, `@luke/nav` and `@luke/calendar` are CommonJS, and each says so explicitly rather than leaving the format emergent.

## H.2 The original failure mode

`@luke/core` compiled to **54 of 54 CommonJS files** — zero ESM syntax in `dist` — while `exports.import` and `exports.require` both pointed at that same CommonJS artifact. The `import` condition was therefore false: it named a format the file did not have.

Not theoretical. Removing `@luke/core` from `optimizeDeps.include` in `apps/web/vitest.browser.config.mts` and running the browser tier on a cold cache reproduced the real defect:

```
SyntaxError: The requested module '/@fs/.../packages/core/dist/index.js'
does not provide an export named 'typedConfirmation'
```

Two suites failed to import; 16 of 59 tests never ran. A browser ESM context cannot take named imports from a CommonJS file, and the pre-bundling workaround was what had been converting it.

## H.3 Why the mismatch stayed hidden

Every Node consumer worked, so nothing surfaced it. `require('@luke/core')` worked because the artifact genuinely was CommonJS; **static named ESM imports also worked**, because Node's `cjs-module-lexer` walks the `__exportStar` chain that `tsc` emits and synthesises the named bindings. Both halves of the false `exports` map therefore appeared functional on Node, and only the browser — which has no CommonJS interop at all — could tell the difference. That is why the mismatch was first observed in a test config rather than in the package.

## H.4 The contract chosen

`@luke/core` is **ESM-only: one artifact, `"type": "module"`**. Under `module: NodeNext` that requires every relative specifier in `src/` to carry an explicit `.js` extension, as native Node ESM does no extension guessing — 87 specifiers across 25 files. The three published runtime subpaths are:

| Subpath | Target |
|---|---|
| `.` | `dist/index.js` |
| `./server` | `dist/server/index.js` |
| `./utils/date` | `dist/utils/date.js` |

Each collapses to a single `default` condition beside `types`, so no condition names a format the artifact lacks.

ESM-only rather than dual because the browser is a first-class consumer — `apps/web` ships core to the client and the Vitest browser tier loads `dist` directly — and a single artifact avoids the dual-package hazard of two module identities in one process. Dual output was evaluated and rejected on that basis, not on effort.

## H.5 `nav` and `calendar` were not converted

Both carried the identical false `import`/`require` condition pair over genuinely CommonJS output. Both now declare `"type": "commonjs"` with a single `default` condition. **Their module format did not change** — the correction is that the manifest stops advertising a format the artifact never had. `packages/nav` additionally consumes no `@luke/core` symbol at all; that unused dependency is left for the hygiene batch.

## H.6 Alias removal, and what remains

The root `tsconfig.json` and `apps/web/tsconfig.json` aliased `@luke/core` onto `packages/core/src`. Turbopack honours such an alias, so `next build` compiled the package's TypeScript sources directly and could not resolve their `.js` specifiers — 248 errors. Removing either alone still failed; both had to go.

The deeper reason is not the build error. While those aliases were in place, `apps/web` never exercised the package contract at all: it compiled source and the `exports` map was inert for the largest consumer. A contract that no consumer resolves cannot be proven true. Both were removed, and the wildcard `@luke/core/*` form went with them — it had allowed deep imports past the three published subpaths.

**`apps/api` deliberately keeps its source alias.** This does not hold `5.2` open: the finding is about the packages' published module contracts, and those are now correct and exercised. Making the source-vs-dist *type surface* uniform across consumers is the separate tsconfig/boundary work, and the root config's comment says so rather than claiming a repository-wide boundary.

## H.7 Browser workaround removed

The `@luke/core` entry is gone from `optimizeDeps.include`. The entries added in Cycle 4 for BUG-B cold-cache stability are unrelated and remain untouched. The cold browser suite passes without the workaround — the package is now consumed as native ESM by the browser rather than converted on the way in.

## H.8 The `require(esm)` dependency and its gate

`apps/api` and `packages/calendar` both emit CommonJS and `require("@luke/core")`. They reach an ESM package through Node's `require(esm)`, unflagged on the Node 24 this repository pins in `engines`, `.nvmrc`, the CI setup action and both Dockerfiles. Verified against the real emitted consumers, not only in the abstract: `apps/api/dist/lib/password.js` and `apps/api/dist/utils/downloadToken.js` load the published ESM at runtime, as does `packages/calendar/dist/index.js`.

That compatibility holds **only while core's ESM graph stays synchronous**. A single top-level `await` anywhere in it makes every CommonJS consumer fail at load with `ERR_REQUIRE_ASYNC_MODULE`. The invariant was executable nowhere: vitest, Vite and Next all load core through an ESM loader, so a violation would have been green on every tier and first observed as an API container that will not boot.

Cycle 6 therefore added `packages/core/test/module-contract.cjs` and the `test:module-contract` script, wired into the CI `checks` job. It is CommonJS (`.cjs` inside an ESM package), run by plain `node` — no tsconfig is read, so no `paths` alias can redirect it — and it addresses the package **by name**, which resolves through the `exports` map to `dist`. It builds core itself rather than inheriting a dist from an earlier Turbo task, and asserts for each of the three subpaths that the resolved file lies under `dist`, that the namespace is a real ES module, and that a known named export survives.

Demonstrated non-vacuous by mutation, not asserted to be meaningful:

| Mutation | Result |
|---|---|
| top-level `await` in `src/utils/date.ts` | fails, `ERR_REQUIRE_ASYNC_MODULE` |
| package reverted to `"type": "commonjs"` | fails the ES-module-namespace assertion |

Source restored byte-identical after each, verified by sha256.

## H.9 Review history

An **xhigh** review of the implementation independently re-verified the artifact and the module contract and **found no contradiction in the selected ESM-only design**. It confirmed the emitted format, the subpath resolution, the absence of import cycles and of top-level await, that `apps/web` genuinely typechecks against `dist` declarations, that Vite never pre-bundles the package, and that no server-only core code reaches a client chunk.

Its actionable findings were about enforcement and drift rather than design, and produced the corrective work recorded above: the executable `require(esm)` gate, a corrected root-config comment that no longer claims the alias boundary is repository-wide, a corrected `apps/web` comment that had misdescribed `apps/api` as publishing no build, and documentation fixes where `CLAUDE.md`, `README.md` and `docs/TASK_url_check_enforcement.md` named `@luke/core/net/url` and `@luke/core/schemas` — specifiers the `exports` map does not publish. All three now point at the barrel; no subpath was added to preserve stale wording, and the task document keeps its historical framing while marking the old specifier as no longer importable.

A subsequent **medium** review of that corrective delta found **no material finding**.

## H.10 Evidence from the green implementation SHA

| Surface | Result |
|---|---|
| `packages/core/dist` | **54/54 ESM**, zero CommonJS markers |
| static/native ESM import | green for `.`, `./server`, `./utils/date` |
| CommonJS `require(esm)` | green for all three subpaths |
| declaration resolution | resolves for both CommonJS and ESM `NodeNext` consumers |
| web production build | green (Turbopack, 42 static pages) |
| browser suite, cold `.vite` | **59/59** without the workaround |
| unit suites | **837** — core 258, calendar 63, api 436, web 80 |
| API integration | **525 passed + 1 expected fail**, 42 files |
| `typecheck` / `typecheck:test` / `typecheck:tools` | green |
| `pnpm lint --force` | **0 errors, 49 warnings** — Cycles 3A/4/5/G baseline, unchanged |
| suppression ratchet | **71 suppressed across 40 files**, unchanged |
| `pnpm check:drift` | green |

Implementation commit `58df5498e7a8cbe821908a8044fe2ad69b72c003`.

Both workflows green on that exact SHA:

| Workflow | Run | Result |
|---|---|---|
| CI | **33539768965** | `success` — Lint/TypeCheck & Unit Tests, Browser Component Tests, Integration Tests, Migrations all `success`. The `checks` job's step 11, **`Module contract (require(esm))`**, `success` |
| security | **33539769096** | `success` — gitleaks, semgrep, osv-push all `success` (`osv-weekly` and `notify-on-failure` skipped by design) |

## H.11 Statuses explicitly preserved

- **`P0-02b` remains CONFIRMED OPEN, PARTIALLY ADDRESSED**, exactly as recorded in §F.1/§F.10. Cycle 6 did not touch `eslint.config.mjs` and changed nothing about per-runtime globals.
- **The remaining `apps/api` source alias and the source-vs-dist type-surface question belong to the separate tsconfig/boundary work**, together with `P1-06`. They are not part of `5.2` and their being open does not reopen it.
- The xhigh review's other observations — `sideEffects: false` and barrel tree-shaking, `next build` missing from CI coverage, dist-staleness ergonomics, the dead `webpack:` block in `next.config.js`, and the `zod` pre-bundle coupling in the browser test config — **were not Cycle 6 regressions and were deliberately not addressed here**. The reviewer confirmed the tree-shaking one pre-dated the change. They are recorded as backlog, not as debt this cycle created.

## H.12 Not swept

Several `packages/core/src/**` file-header comments still name module identities that are not published subpaths (`@luke/core/net`, `@luke/core/storage`, `@luke/core/crypto`, `@luke/core/runtime`), as does one comment in `apps/api/src/routers/collectionLayout.ts`. These are module-identity headers rather than import instructions, unlike the three documentation lines that were corrected because they told a reader what to write. **They were deliberately not swept in this cycle** — doing so would have widened a bounded closure into a comment-wide edit.

## H.13 Execution status

`5.2` is closed. Per A.4, cycle 7 — Turbo graph, closing `P2-09` (Sonnet) — is next and is not started here.

---

# Appendix I — Cycle 7: Turbo task graph simplification (2026-09-01)

Appends to Appendices A–H; neither the historical body nor any earlier appendix is rewritten. Implementation commit `a0d703e9b470d7456f61155fc2b07dca7d2b8231` on `develop-2.2`. Cycle 7 changed **only `turbo.json`** — no other file was touched.

## I.1 Disposition

**`P2-09` → DONE.** Both hypotheses recorded in the original audit (§P2-09) were verified true and fixed.

## I.2 Hypothesis 1 — `lint.dependsOn: ["^build"]` was unnecessary

**Structural evidence, from the repository as it stands, not inference:**

- `eslint.config.mjs` sets no `parserOptions.project` anywhere — lint is not type-aware.
- No `import-x` resolver setting is configured anywhere in the file.
- `import-x/no-unresolved` is not among the enabled rules — only `import-x/order`, `import-x/no-duplicates`, `import-x/first`, `import-x/newline-after-import`, all of which operate on syntax, not resolved module targets.
- Every workspace's `lint` script is a plain `eslint src/` (`apps/web`, `apps/api`, `packages/core`, `packages/nav`, `packages/calendar`) — no custom tooling that reads a dependency's `dist`.

Conclusion: ESLint, as configured in this repository, has no path by which it consumes an upstream package's built artifacts. The `^build` edge on `lint` bought nothing and only serialized lint behind four unrelated `tsc` invocations.

**Empirical proof**, measured with `turbo run lint --force` (cache bypassed) before and after removing the edge:

| | Tasks executed | Wall time |
|---|---|---|
| Before | 9 (`@luke/api#build`, `@luke/calendar#build`, `@luke/core#build`, `@luke/nav#build` + 5 lint tasks) | ≈24.3s |
| After | 5 (lint tasks only) | ≈10.6s |

≈56% reduction on a fully cold lint run. Warm behavior is unaffected either way: both before and after, `turbo run lint` on a populated cache reports `FULL TURBO` in well under a second — Turbo's own caching already made the warm path a non-issue, so the edge's entire cost was paid on cold runs only.

**`typecheck.dependsOn: ["^build"]` was deliberately left untouched.** Unlike lint, `tsc --noEmit` genuinely needs built declarations from at least some upstream packages under the current `tsconfig.json` setup:

- `apps/web/tsconfig.json` has no `paths` entry for `@luke/core` or `@luke/calendar` — both resolve through their package `exports` map to `dist/**/*.d.ts` (a deliberate choice, documented in that file's own comment, so the browser-consumed contract is actually exercised — see Appendix H).
- `apps/api/tsconfig.json` maps only `@luke/core` to source (`../../packages/core/src`); `@luke/nav` and `@luke/calendar` are not source-mapped and so resolve through their own `dist` declarations the same way.

Removing `^build` from `typecheck` would reintroduce the documented "stale `dist`" failure mode this repository already works around elsewhere (`apps/api dist staleness`, memory `project_api_dist_staleness.md`). Out of scope for this cycle and not touched.

## I.3 Hypothesis 2 — `packages/core/dist/**` in `build.outputs` was dead

Turbo resolves a task's `outputs` globs relative to the **owning package's own directory**, not the repo root. For the `@luke/core#build` task that owning directory is `packages/core/`, so the glob `packages/core/dist/**` was actually being evaluated as `packages/core/packages/core/dist/**` — a path that has never existed in this repository (verified: `ls packages/core/packages/core/dist` → `No such file or directory`). `dist/**`, the sibling entry in the same list, already resolves to `packages/core/dist/**` correctly and is what every cache hit was actually keyed on.

**Proof that removing the dead glob does not impair cache restoration:** all four package `dist` directories (`packages/core`, `packages/nav`, `packages/calendar`, `apps/api`) were deleted, then `turbo run build` was re-run against the (now-corrected) config with only `dist/**` in `outputs`. All four were restored byte-for-byte from the local cache (4 of 5 build tasks cache-hit; `@luke/web`'s Next build is not cacheable the same way and rebuilt, which is pre-existing behavior unrelated to this change).

## I.4 Review history

A read-only **medium** `/code-review` pass validated both substantive changes above as safe, and additionally found one non-runtime issue: the first draft of the fix had added an explicit `"cache": true` to the `lint` task. That flag is redundant — Turbo already defaults task-level caching to `true` when the key is omitted, confirmed via `turbo run build --dry-run=json`, where the `build` task (which carries no explicit `cache` key at all) resolves to `cache: true` and caches correctly. The finding was accepted and fixed before push: the redundant key was dropped, leaving

```json
"lint": {}
```

`turbo run lint --dry-run=json` was re-run after the fix and confirmed every lint task (`@luke/api#lint`, `@luke/calendar#lint`, `@luke/core#lint`, `@luke/nav#lint`, `@luke/web#lint`, `eslint-plugin-luke#lint`) resolves with `cache: true` and `dependsOn: []`. No further material findings remained.

## I.5 Final configuration

```json
"build": {
  "dependsOn": ["^build"],
  "outputs": [
    ".next/**",
    "!.next/cache/**",
    "dist/**"
  ]
},
"lint": {},
```

`typecheck` and every other task in `turbo.json` are unchanged from the pre-Cycle-7 state.

## I.6 Regression gates, all green on the implementation SHA

Local, before push (also re-run by `.husky/pre-push` on the push itself):

| Gate | Result |
|---|---|
| `pnpm lint --force` | **0 errors, 49 warnings** — same baseline as Appendix H's `I.169` row, unchanged |
| `pnpm typecheck` | green, 9/9 tasks |
| `pnpm check:drift` | green (skill-integrity, docs-integrity, platform-integrity all `ok`) |
| `turbo run lint --dry-run=json` | all lint tasks resolve `cache: true`, `dependsOn: []`, no upstream build task in the graph |
| cold-cache `dist` restoration | `@luke/core`/`nav`/`calendar`/`api` all restore correctly after deleting `dist` and re-running `turbo run build` |

Implementation commit `a0d703e9b470d7456f61155fc2b07dca7d2b8231`.

Both workflows green on that exact SHA:

| Workflow | Run | Result |
|---|---|---|
| CI | **33553820934** | `success` — Lint (incl. TypeCheck, TypeCheck (test), Lint & TypeCheck (tools), Control-plane tests, Docs & skills drift, Unit tests, Module contract (require(esm))), Browser Component Tests, Integration Tests, Migrations all `success` |
| security | **33553820894** | `success` — gitleaks, semgrep, osv-push all `success` (`osv-weekly` and `notify-on-failure` skipped by design) |

## I.7 Execution status

`P2-09` is closed. Per A.4, cycle 7 was the last item in the originally scheduled execution sequence; remaining backlog (`P1-06`, `6.2`, `P1-04`/`P1-05`, `P1/P2-08`, the §A.3 hygiene batch, `S-01`) stays open and unscheduled, exactly as recorded in §A.3/§A.4.

---

# Appendix J — Cycle 8 neutral TypeScript configuration architecture (2026-09-02)

Appends to Appendices A–I; neither the historical body nor any earlier appendix is rewritten. Implementation commit `5a1987eeb2359835c47239ba21f41d0c345b01c1` on `develop-2.2`, parent `e13d03278ce23a9b135b5cd1ace19d97a6cac520`.

## J.1 Disposition

**Cycle 8 implementation: COMPLETE.**

**`P1-06` → CONFIRMED OPEN, PARTIALLY ADDRESSED.** The structural TypeScript configuration remediation the finding asked for is done and machine-checked. Some of the original acceptance criteria are not satisfiable by a tsconfig at all — they are owned by package contracts and by the runtime-boundary family — and those are recorded as residuals in §J.7 rather than folded into a closure.

**`5.4` (`allowJs: true`) → DONE.** The four dead declarations (root, `packages/core`, `packages/nav`, `packages/calendar`) were removed after measuring that **zero `.js` files entered any affected program** — verified on all twelve pre-existing configs, not sampled. Closed as a co-closure of this cycle rather than as its own scheduled item.

Cycle 8 did **not** solve the `@luke/api` package contract, and nothing in the implementation or in the new gate claims it did.

## J.2 What changed

- **New `tsconfig.base.json`**, carrying only repository-wide invariants: `target`, `lib`, `strict`, `noUnusedLocals`, `noUnusedParameters`, `skipLibCheck`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, `isolatedModules`.
- **`lib: ["ES2022"]` is stated, not omitted.** Leaving `lib` unset is not neutrality: TypeScript then loads `lib.<target>.full.d.ts`, which for ES2022 includes DOM, DOM.Iterable, DOM.AsyncIterable, ScriptHost and WebWorker.ImportScripts. That default is why `packages/nav` and `packages/calendar` — Node-only libraries that never named a `lib` — carried the whole browser surface.
- **`module`/`moduleResolution` remain runtime-owned by the leaves.** There is no repository-wide value, and their unset default (`ES2015` + `classic`) is wrong for every surface here, so each leaf states its own pair.
- **Root `tsconfig.json`** changed from a Next/browser configuration with a `**/*.ts` include that no runner ever compiled, into a real Node project owning `scripts/**/*.ts`.
- **`apps/web`** now owns Next/Bundler/DOM/JSX semantics explicitly, instead of inheriting them from the root. Its `extends` key is load-bearing beyond inheritance: Next's `writeConfigurationDefaults` returns early when a user config has `extends` or `references`, and without one it would rewrite the file on every `next build`.
- **`apps/api`** owns NodeNext/Node semantics explicitly. It had been inheriting `dom`, `dom.iterable`, `jsx: preserve` and the Next TypeScript plugin; removing all four left its program unchanged.
- **`packages/core`** is the explicit isomorphic exception, `lib: ["ES2022", "DOM"]`. Measured, not assumed: without DOM its three real `typeof window` guards fail (`crypto/secrets.server.ts:21`, `runtime/env.ts:53`, `runtime/env.ts:108`). The rest of the `lib.es2022.full` bundle is gone.
- **`packages/nav`, `packages/calendar`, `tools`** inherit the neutral base with Node-oriented semantics.
- **Test configs** inherit through the project they test rather than naming the base directly; transitive inheritance is the invariant. `apps/api/tsconfig.test.json` deliberately keeps ESNext/Bundler, because Vitest — not Node's module loader — is what runs that corpus.

## J.3 `@luke/core` package-boundary normalization

The investigation corrected a premise the earlier record carried. The `apps/api` → `packages/core/src` `paths` alias **was not actually making the production API typecheck against source**: a `references` entry to a composite project outranks `paths`, so TypeScript redirected the resolution onto `packages/core/dist` declarations. The alias's real effect was narrower and worse — it answered `@luke/core/<anything>`, including subpaths the `exports` map does not publish. Those type-resolved green against `dist` and fail at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`, confirmed directly under both `import()` and `require()`.

The two mechanisms therefore had to be removed together. Removing `references` alone would have handed the alias its original meaning back and moved the program onto core's sources; removing the alias alone would have left a second resolution mechanism doing what package `exports` already does.

Cycle 8 removed the `@luke/core` alias, the `@luke/core/*` wildcard, and the cross-package project reference (from `apps/api/tsconfig.json`, `apps/api/tsconfig.scripts.json`, `apps/api/tsconfig.test.json`, and the inert pair in `apps/web/tsconfig.json`).

Final measured state — `tsc --listFiles`, per program:

| Consumer | `packages/core/dist` | `packages/core/src` |
|---|---|---|
| `tsconfig.json` (root scripts) | 52 | **0** |
| `apps/api/tsconfig.json` | 52 | **0** |
| `apps/api/tsconfig.scripts.json` | 52 | **0** |
| `apps/api/tsconfig.test.json` | 52 | **0** (was 52 src) |
| `apps/web/tsconfig.json` | 52 | **0** |
| `apps/web/tsconfig.test.json` | 52 | **0** |
| `packages/calendar/tsconfig.json` | 49 | **0** |
| `packages/calendar/tsconfig.test.json` | 49 | **0** |

This normalizes one package contract. It does not generalize: `@luke/api` remains a separate residual (§J.7).

## J.4 Root scripts coverage

The old root `tsconfig.json` declared `include: ["**/*.ts", ...]` but was compiled by nothing — `pnpm typecheck` is `turbo run typecheck`, turbo runs per-workspace scripts, and no root task is declared. `scripts/rc-prod-clone.ts`, which drives a production backup/restore, sat inside that phantom program and was checked by no gate.

Root `tsconfig.json` now owns `scripts/**/*.ts`, with a `typecheck:root` script whose contract is self-sufficient:

```
turbo run build --filter=@luke/core --filter=@luke/nav --filter=@luke/calendar && tsc -p tsconfig.json
```

The three artifacts were **measured, not guessed**: with every `dist` deleted, the root program fails with `Cannot find module` for `@luke/core` (86), `@luke/core/server` (8), `@luke/nav` (7) and `@luke/calendar` (2), and nothing else. `apps/api` is not among them because the current `@luke/api` manifest still exposes source, so its own build is not required.

- CI carries a distinct **TypeCheck (root scripts)** step, deliberately not folded into the tools step.
- `.husky/pre-push` invokes the same gate, so the hook and the pipeline agree (`lessons.md` Postscript 2: a gate that runs only in CI is a green hook over a red pipeline).
- Clean-artifact mutation: from zero `dist` trees, `pnpm typecheck:root` exits 0 and rebuilds exactly 3/3. Control from the same state: bare `tsc -p tsconfig.json` exits 2 with 145 errors, so the dependency is real and now explicit.

**Root `scripts/**` still has no ESLint coverage.** `eslint scripts/rc-prod-clone.ts` reports *"File ignored because no matching configuration was supplied"*, and `pnpm lint` is `turbo run lint`, which never reaches it. That half was deferred deliberately — it would touch `eslint.config.mjs`, which belongs to the `P0-02b` family — and the new checker's own documentation states the gap rather than implying a backstop.

## J.5 Executable tsconfig integrity gate

New: `tools/scripts/check-tsconfig-integrity.ts`, with fixtures under `tools/scripts/__fixtures__/tsconfig/` and behavioral tests in `tools/scripts/check-tsconfig-integrity.test.ts`. Integrated as `check:tsconfig`, chained into `check:drift`, and covered by `test:tools` — so it runs in CI's *Docs & skills drift* and *Control-plane tests* steps and in `.husky/pre-push`, with no new job.

It follows the existing control-plane conventions: a pure function over a repository root, `git ls-files` discovery, `Problem[]` output through `lib/report`, and fixtures declared as data so the checker never reads them when it runs against Luke itself.

Invariants enforced:

- every canonical tracked `tsconfig*.json` is classified against an explicit table, **fail-closed in both directions** — an unclassified config fails, and a stale table entry fails;
- a non-canonical TypeScript project config name is rejected wherever the repository reaches for it: a `tsc -p`/`--project` in a tracked `package.json` script, or an `extends` edge;
- every governed config reaches `tsconfig.base.json` **transitively**;
- runtime configuration is checked against the surface each config is classified under (Node / Node-loaded-by-bundler / isomorphic / web / the neutral base itself);
- cross-workspace source aliases are rejected **structurally, by where the target lands**, not by alias name — a renamed key buys no amnesty;
- an alias through a pnpm workspace symlink under `node_modules` is resolved via `realpath` and cannot bypass the boundary;
- a genuine external `node_modules` dependency alias remains allowed; an alias into `node_modules` that resolves to nothing is reported as unverifiable rather than assumed external;
- cross-package project references are forbidden as **repository architecture policy** — nothing here runs `tsc -b`, so such a reference costs the package contract and buys nothing;
- a config may not directly own another workspace's **root** files through `files`/`include`; the rule reads root files, so imported/transitive files are untouched by it;
- `extends` arrays, extensionless paths, directory form, diamonds, true cycles, missing parents and malformed parents all have explicit, tested behavior, with diagnostics attributed to the config that declares the bad edge.

The checks read the **resolved** configuration via TypeScript's own parser, not raw JSON. A raw-JSON rule would have called every pre-Cycle-8 config compliant, because none of them mentioned DOM: they inherited it.

Test evidence:

| Measure | Result |
|---|---|
| tsconfig-integrity tests | **51** |
| `pnpm test:tools` | **97/97** |
| branch-removal proofs | every newly added checker branch has at least one claiming test that goes red when the branch is disabled; checker restored byte-identical (sha verified) after each |
| live mutation classes | **15**, each exercised against the real tree and restored, working tree verified free of unstaged and untracked residue |

## J.6 Third-party DOM type injection — newly observed residual

Configuring `lib: ["ES2022"]` on a Node-oriented surface does not guarantee the resulting **program** is free of DOM types. A dependency's own triple-slash directive injects them regardless, and no tsconfig option can refuse it.

`@types/pdfmake/interfaces.d.ts` opens with:

```
/// <reference lib="dom" />
```

so `lib.dom.d.ts` enters:

- `apps/api/tsconfig.json` and `apps/api/tsconfig.test.json`, which reach those types through the PDF export path;
- the root scripts program, via the current `@luke/api` source traversal.

Measured consequence: `const el: HTMLElement = ...` compiles in an ordinary Fastify source file today.

The distinction Cycle 8 records, and does not blur:

- **configuration-level** browser libraries were removed or narrowed everywhere — `packages/nav`, `packages/calendar`, `tools` and `apps/api/tsconfig.scripts.json` are now fully free of `lib.dom`, and DOM.Iterable, DOM.AsyncIterable, ScriptHost and WebWorker.ImportScripts are gone from every surface;
- **`apps/api`** has a compensating control at a different layer: the per-runtime ESLint globals from Cycle 5 mean `no-undef` rejects `window`, `document` and `HTMLElement` there. Verified live on a bait file. Type exposure remains; *use* is blocked;
- **root `scripts/**`** has neither — no tsc rejection and no lint config;
- this is a **third-party type-surface residual newly observed by this cycle, not a Cycle 8 regression**. The injection predates the change.

The integrity gate is explicit that it governs the libraries a configuration *asks for*, not the transitive closure of third-party declaration files, and its success output names this exception so a green run cannot be mistaken for stronger isolation. No remediation is proposed here.

## J.7 `P1-06` acceptance criteria and residual ownership

**Satisfied / materially closed by Cycle 8:**

- a genuinely neutral shared TypeScript base exists, with the DOM-by-default trap closed explicitly rather than by omission;
- runtime-specific leaf configurations exist and own their own `module`/`moduleResolution`/`lib`/`jsx`/`types`;
- the root phantom-config behavior is gone;
- root scripts are actually typechecked, by a gate in CI and in pre-push;
- `@luke/core` resolution is consistent across production, test and build consumers;
- the source alias and wildcard `exports` bypasses for `@luke/core` are machine-checked, not merely removed;
- `allowJs` cleanup (§5.4) is done.

**Residuals, with owners:**

1. **`@luke/api` package contract.** `apps/api/package.json` still declares `main`/`types` → `./src/index.ts` with no `exports` boundary and no published build. Consequently `apps/web` (129 files) and the root scripts program still traverse API source. This is a package-contract problem, not a tsconfig one — removing the `apps/web` alias was proven behaviour-neutral precisely because the manifest, not the alias, causes the traversal. Owned by the dedicated next architectural cycle, not by `P1-06` implementation scope.
2. **`P0-02b` / `6.2` runtime-boundary family.** `packages/core` ships to the browser while declaring `types: ["node"]`; TypeScript's `types` has no per-file granularity, so the per-file runtime split is enforced by the ESLint globals of Cycle 5, not by tsc. The remaining Next server/client boundary problem recorded in §F.10 is unchanged.
3. **`@types/pdfmake` reference-lib injection.** Newly recorded, as described in §J.6.
4. **Root scripts ESLint coverage.** Deliberately deferred: typecheck is now present, lint coverage is not.

Appendices F, H and I are unchanged by this cycle, and none of their statuses is reopened.

## J.8 Verification evidence

Local, before push (also re-run by `.husky/pre-push` on the push itself):

| Gate | Result |
|---|---|
| `pnpm typecheck` | **9/9** |
| `pnpm typecheck:test` | **8/8** |
| `pnpm typecheck:tools` | pass |
| `pnpm typecheck:root` | pass, including the zero-`dist` clean-artifact proof |
| `pnpm lint` | `--force`: **0 errors, 49 warnings** — Cycles 3A/4/5/G/H/I baseline, unchanged |
| `pnpm lint:tools` | pass |
| `pnpm test:tools` | **97/97** |
| `pnpm check:drift` | green — skill 17, docs 62, platform 7, tsconfig 13 |
| `pnpm test:module-contract` | green — 3 subpaths `require()`d from `dist` as ESM |
| `pnpm test` | **837** — core 258, web 80, calendar 63, api 436 |
| `pnpm test:browser`, cold `.vite` | **59/59** |
| `pnpm --filter @luke/web build` | green, **42/42** static pages; `apps/web/tsconfig.json` sha256 identical before and after, confirming Next did not rewrite it |

Both workflows green on the exact implementation SHA `5a1987eeb2359835c47239ba21f41d0c345b01c1`:

| Workflow | Run | Result |
|---|---|---|
| CI | **33569375219** | `success` — Lint/TypeCheck & Unit Tests, Browser Component Tests, Integration Tests, Migrations all `success` |
| security | **33569375229** | `success` — gitleaks, semgrep, osv-push all `success`; `osv-weekly` and `notify-on-failure` skipped by design |

Within the CI `checks` job, recorded explicitly:

| Step | Result |
|---|---|
| **TypeCheck (root scripts)** | `success` — first real CI execution of the new gate |
| **Control-plane tests** | `success` |
| **Docs & skills drift** | `success` — now includes `check:tsconfig` |
| **Module contract (require(esm))** | `success` |

## J.9 Review history

A read-only **xhigh** review of the implementation found the TypeScript architecture sound and returned bounded corrections, all in gate coverage and assurance wording rather than config semantics: an undeclared build dependency on `typecheck:root`, its absence from pre-push, an integrity gate that guarded `paths` but not `references`, docstring and output strings implying stronger DOM isolation than the gate verifies, an `extends` walker rejecting legal TypeScript forms, a discarded parse diagnostic, and two vacuous tests.

A subsequent corrective **high** review found further defects in the checker added by that first correction: a pnpm workspace symlink under `node_modules` defeating the boundary rule, a discovery contract narrower than its own claim, `files`/`include` uncovered, a valid `extends` diamond misreported as a cycle, a false positive on external `node_modules` aliases, misattributed chain diagnostics, and one untested branch.

Every finding from both reviews was remediated locally. The cycle remained **one conceptual commit**, amended rather than stacked, and was pushed only once both review rounds were closed and all gates were green. **No application runtime source was modified** — the diff is confined to tsconfig files, `package.json` scripts, CI, the pre-push hook, and the new control-plane files.

## J.10 Execution status and next work

Cycle 8 is closed as an implementation cycle. `P1-06` remains **PARTIALLY ADDRESSED** per §J.1 and §J.7: its remaining acceptance criteria belong to separate architectural boundaries and are not reachable from a tsconfig.

The immediate next planned cycle is the **`@luke/api` package-contract boundary**, described here at objective level only and deliberately not started:

- stop `apps/web` and the root scripts program from consuming `apps/api/src`;
- establish an explicit built type contract for the tRPC `AppRouter` surface;
- make that contract package- and `exports`-based, as `@luke/core`, `@luke/nav` and `@luke/calendar` already are;
- remove source bleed and any obsolete build/deployment accommodations only after proof, not by symmetry.

`6.2` dependency-boundary enforcement follows after the real package contracts exist; enforcing direction over a package that publishes its own sources would encode the wrong graph.

# Appendix K — Cycle 9 prologue: release-control closure and stable-line security remediation (2026-09-02)

Appends to Appendices A–J; neither the historical body nor any earlier appendix is rewritten. Work spans two branches: `develop-2.2` (`ec91893` → `2485ae4`) and the stable line via PR #28 (`ee706c5` → `e119473`, merged as `d912acd`), reunited by the synchronization merge recorded in §K.10.

## K.1 Disposition

**Release-control plane: CLOSED.** Tag provenance, RC-train versioning, stable graduation and branch-pattern drift are each enforced by an executable gate with both-direction regression tests, not by convention.

**Stable-line dependency remediation: CLOSED.** Five packages across two branches; `osv-scanner` reports no issues on both trees and Dependabot has no open alerts.

**Trusted-proxy defect: CLOSED.** `GHSA-3m5p-2c4r-xxw2` was not remediable by a version bump on either branch; §K.7 records why.

Cycle 9 — the `@luke/api` package contract — is **not started**. No release has been prepared and no `v3.*` tag exists.

## K.2 Release provenance

`release.yml` decided both the release channel and the registry tags from `contains(github.ref_name, '-rc')`. That expression answers neither question: it is a substring test on a name the tagger chooses, so it cannot tell where the tagged commit lives, and it is not a SemVer check — `v2.2` passes the `v*` trigger, produces no `type=semver` tag at all, and pushes an unversioned image with every step green.

Replaced by `tools/scripts/check-release-provenance.ts`, a job all build/push jobs depend on:

| shape | required origin | publishes |
| --- | --- | --- |
| `vX.Y.Z` | reachable from `main` | version + `X.Y` + `latest`, never `rc-latest` |
| `vX.Y.Z-rc.N` | reachable from the release train **and not yet from `main`** | version + `rc-latest`, never `latest`, never `X.Y` |

The rc rule needs both halves: `main` is an ancestor of the train, so one-sided reachability would admit an rc tag placed on a `main`-only commit. The negative half also retires the rc channel by itself once the train is merged.

Every registry tag now comes from the gate's outputs, including the version — `docker/metadata-action`'s own `type=semver` parser could otherwise disagree silently.

**Proved against real repository SHAs** (train `88e5b7a`, `main` `0005616`, where `main` *is* an ancestor of the train): rc on the train tip accepted; rc on `main`'s tip rejected; stable on `main` accepted; stable on the train tip rejected; ten malformed shapes rejected (`v3.0`, `v3.0.0.1`, `v3.0.0-rc1`, `v3.0.0-rc.0`, `v3.0.0-rc.01`, `v03.0.0`, `v3.0.0-beta.1`, `v3.0.0-rc.1.2`, `v3.0.0+build.5`, `vnext`); rendered ghcr tag lists checked for both channels.

## K.3 Stable graduation selection

`release-prepare stable` found its train with `git describe --tags --abbrev=0`, which answers proximity, not recency. Reproduced: with `v2.1.3`, a `v2.1.4` hotfix on `main` and `v3.0.0-rc.1` on the train, `git describe` from the merge returns `v2.1.4`, so `stable` refused while `auto`/`rc` proposed `v3.0.0-rc.2` — an rc tag on `main`, which the provenance gate then rejects. **All three modes failed on the only branch a stable tag may be cut from.**

`tools/scripts/check-release-train.ts` replaces proximity with reachability. A train is a candidate when its stable tag exists nowhere and is greater than the highest stable tag reachable from `HEAD`; exactly one candidate graduates, zero and several both fail closed. The comparison is what excludes this repository's own abandoned train — `v1.10.0-rc.1..15` are reachable and `v1.10.0` was never tagged, because that cycle shipped as 2.0.0.

## K.4 Non-empty changelog protection

At graduation there are normally no commits after the final rc, so `git-cliff --unreleased` produced `## [X.Y.Z]` with nothing under it, and the readiness check only grepped for the heading — the script printed "Ready" and `.husky/pre-push` accepted the tag. `[1.9.0]` in `CHANGELOG.md` is what that looks like once shipped: two lines, "Merge develop-2.0" and "Bump version".

Stable mode now generates over `<previous stable>..HEAD` with `--ignore-tags` erasing the rc boundaries, yielding one consolidated section instead of one per candidate; starting at the previous release also excludes what that release already published. Both the script and `.husky/pre-push` count entries under the heading. Measured end to end: 159 entries under rc.1, 1 under rc.2, **162 under the graduated `[3.0.0]`**, a single heading, and a CHANGELOG diff that only adds. Crafted-file check: empty and whitespace-only sections rejected where the old `grep` accepted both.

## K.5 Fail-closed guards

**Exact-SHA.** `--expected-sha` was optional, and `flag()` returns `''` rather than `undefined`, so `--expected-sha ""` skipped the commit-identity comparison entirely and the gate authorized whatever commit the job sat on. Now required and validated as 40 lowercase hex: omitted, empty, whitespace-only, truncated, over-long, uppercase and well-formed-but-wrong all reject.

**Stable line.** `check-release-train.ts` is deliberately branch-agnostic, so on the release train it found the ungraduated train and answered `v3.0.0`. Preparing there rewrote `CHANGELOG.md` and all seven `package.json` files, `.husky/pre-push` then accepted the tag because CHANGELOG and versions genuinely did match, and only `release.yml` refused it — with the tag already on the remote. A publication gate that fails closed is not enough when it fails last.

`stable` now proves `HEAD` is on the stable line before the selector is consulted and before anything is written; `auto`/`rc` ask the same predicate in the opposite direction. Two accepting states, the second needing both halves: `HEAD` reachable from the stable ref; or the checked-out branch is the stable branch **and** the stable ref is an ancestor of `HEAD`. Branch name alone is never sufficient — a local `main` reset onto the train could only reach the remote by force, which ruleset 22082017 forbids.

Automated in `tools/scripts/check-release-stable-line.test.ts`, which executes the real shell script in a throwaway repository with no workspace and no `pnpm` reachable, asserting the diagnostic, the exit status and that `git ls-files -s` is unchanged.

## K.6 Branch-pattern drift enforcement

The active release train was named twice in `security.yml`, and `on:` filters cannot read `env`. Drift there is silent: update one and not the other at a cycle switch and the weekly OSV job keeps scanning the previous train, which still exists during the overlap, so nothing goes red while the new train gets no post-disclosure coverage for a whole cycle.

`security.yml`'s push filter now matches `[main, 'develop-*', 'release/*']` by pattern and needs no per-cycle edit. What a pattern cannot cover is machine-checked by `tools/scripts/check-workflow-branches.ts`, wired into `pnpm check:drift`: the filter still matches `RELEASE_TRAIN_BRANCH`, `release.yml` names the same train, and `ci.yml`'s `push` and `pull_request` filters cover both the train and `main`. CLAUDE.md's per-cycle checklist is corrected to three places and is now build-enforced.

## K.7 Dependency remediation

| package | before | after | advisories | branch |
| --- | --- | --- | --- | --- |
| mysql2 | 3.15.3 | 3.24.2 | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3 | main |
| browserslist | 4.28.4 | 4.28.8 | GHSA-73wf-gq98-2v4g, GHSA-c83g-rgw3-j3cx | main |
| qs | 6.15.3 | 6.16.0 | GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx | both |
| fast-uri | 3.1.5 | 3.1.6 | GHSA-5jgf-p345-68v8 + 3 related | main (develop already 3.1.6) |
| fastify | 5.8.5 | 5.12.1 | GHSA-3m5p-2c4r-xxw2 | main (develop already 5.12.1) |

**Dependabot root cause, from run 33578854105 rather than inferred:** `security_update_not_possible`, "The latest possible version of mysql2 that can be installed is 3.15.3". mysql2 has one requirer, the `prisma` CLI, which declares it as an **exact pin**. Dependabot had no requirement to unlock and does not author pnpm overrides — so the advisory could not close on any branch without a workspace override. That is why mysql2 needed one and qs did not: qs's two requirers declare caret ranges that already admit the fix.

qs was verified **unreachable** rather than assumed: both advisories are parse-side and need preconditions this tree never creates (`plainObjects`/`allowPrototypes` for the isBuffer DoS, `comma: true` for the array-limit bypass). The runtime requirer, `googleapis-common` via `@luke/calendar`, only calls `qs.stringify(params, { arrayFormat: 'repeat' })`; the single real `qs.parse` is `superagent`'s urlencoded response parser, default options, devDependency only.

The qs and fast-uri advisories were published **2026-09-02 between 14:45 and 15:44 UTC**, after the trees they affected had already scanned clean — the exact post-disclosure window §K.6's release-train scan exists for, arriving before that job's first scheduled run.

**Accepted resolver collateral:** `postcss 8.5.26` enters alongside 8.5.24 on the stable line. `next` pins postcss `8.4.31` exactly and the pre-existing `postcss@<8.5.18: '>=8.5.18'` override rewrites that to an unbounded range, so every `pnpm update` takes the newest 8.5.x. Measured as unavoidable without an override that was ruled out; above the security floor and the version `develop-2.2` already resolved. Recorded, not hidden.

## K.8 Why Fastify needed more than a version bump

`GHSA-3m5p-2c4r-xxw2`: the hop-count form of `trustProxy` "compiles to a predicate that structurally ignores the address argument". Fastify 5.12.1 fixes it by **disabling the numeric form at runtime** — and that fix alone is not a remediation for this repository, in either direction:

- **`main`** ran `trustProxy: 1`. Bumping to 5.12.1 makes every request report the web container's address, collapsing all users into one rate-limit bucket — the CRITICAL from the 2026-08-07 audit, restored.
- **`develop-2.2`** already ran 5.12.1 and scanned clean, but `lib/trustProxy.ts` held `(_address, hop) => hop < 1` — a hand-written custom function reproducing exactly the semantics the patch removed. The advisory is explicit: "Custom functions must inspect the `address` argument, not only the hop index." **The branch was behaviourally vulnerable despite resolving the patched version.** The module's comment had also mischaracterised the 5.12 change as a regression that "fails closed silently", and worked around it.

Reproduced under 5.12.1 before any change, via `inject({ remoteAddress })`: an untrusted peer sending `X-Forwarded-For: 9.9.9.9` resolved `request.ip` to `9.9.9.9`, choosing its own `keyBy:'ip'` bucket in `lib/ratelimit.ts` and writing a forged address into `lib/auditLog.ts`.

**Both halves are load-bearing**, and each is separately mutation-proved:

```
hop < 1 && isTrustedAddress(address, hop)
```

Without the address check an untrusted peer forges `request.ip` (2 tests fail). Without the hop check a client injects a hop whose address is itself inside the trusted range — `X-Forwarded-For: 9.9.9.9, 10.254.10.7` — walks the compiled predicate past it and gets the leftmost value back, which is the hole a bare CIDR string handed to Fastify leaves open (1 test fails). Parsing and matching use `@fastify/proxy-addr`, declared directly rather than reached through Fastify's dependencies; its `compile()` throws on an invalid range, so a deployment typo fails at boot.

**Network isolation is the other half of the remediation.** No compose file declared `networks:` at all, so `postgres`, `api`, `web` and the object store shared one default bridge: "only apps/web can reach apps/api" was true of intent, not of topology. Three distinct claims were conflated and are now separated — *not publicly port-mapped* (provable from the repo), *not reachable by an Internet attacker* (not provable here; depends on host firewall and what else runs on the Docker host), *reachable only by one trusted peer* (was **false**). Now `edge` carries web and api, `data` carries api, postgres and object storage with `internal: true`, and api is the only service on both. The edge subnet is deterministic — `10.254.10.0/24` prod, `10.254.20.0/24` rc — overridable via `LUKE_EDGE_SUBNET`/`LUKE_RC_EDGE_SUBNET`, and `LUKE_TRUSTED_PROXY_CIDR` is interpolated from the **same expression** that creates the network, so the subnet Docker builds and the range apps/api trusts cannot drift apart. Defaults work with no new operator input, which is why this landed as hardening rather than a breaking change.

The pre-existing test block called itself an "anti-spoofing proof" while running every `X-Forwarded-For` case from the *trusted* address, so it never asked the only question that mattered.

## K.9 Governance state

**PR #28** — `hotfix/mysql2-main` → `main`, six commits, merged as a two-parent merge commit **`d912acd9184faaf474b3e51662909663c857a9d2`** at 2026-09-02T17:44:27Z, pinned to head `e119473d6877fc3a04778ae0dac436d5b101d632`. No squash, no rebase, no administrator bypass.

**Issue #29** ("Security workflow failing on develop-2.2") — opened automatically by `notify-on-failure` when `osv-push` first caught the qs advisory; closed 2026-09-02T17:49:24Z after both lines were remotely green.

**PR #30** — `chore(deps): bump fastify from 5.8.5 to 5.12.1`, opened by Dependabot and **closed automatically as redundant** at 17:46:32Z, two minutes after the PR #28 merge, with "Looks like fastify is up-to-date now, so this is no longer needed." No human action; recorded because it is evidence the remediation reached `main`, not a separate change.

**Rulesets** (repository had none before this cycle):

| id | name | target | rules |
| --- | --- | --- | --- |
| 22082017 | main integrity | `refs/heads/main` | deletion, non_fast_forward |
| 22082018 | release train integrity | `refs/heads/develop-*`, `refs/heads/release/*` | deletion, non_fast_forward |
| 22132087 | main review gate | `refs/heads/main` | pull_request, required_status_checks |

All three `active` with **zero bypass actors**. The review gate requires a PR with `required_approving_review_count: 0` — no fake human-approval requirement for a single-maintainer repository — plus strict up-to-date status checks on exactly `Lint, TypeCheck & Unit Tests`, `Integration Tests` and `Migrations`, all pinned to `integration_id: 15368`. Security checks are deliberately not required: `security.yml` has no `pull_request` trigger and produces no PR checks.

## K.10 Synchronization merge

`main` was merged back into `develop-2.2` as a real two-parent merge, first parent `2485ae4a9be40de07d8605e4fcd514ffb54129cb`, second parent `d912acd9184faaf474b3e51662909663c857a9d2`.

Five conflicts, resolved against the resulting architecture rather than by choosing a parent: `apps/api/package.json` took develop's newer set (nothing on `main` was newer; `main`'s only unique entry was the deprecated `@opentelemetry/instrumentation-fastify` that `06fb83b` replaced with `@fastify/otel`); both compose files took develop's SeaweedFS topology, with MinIO and its init service absent from the result; `pnpm-workspace.yaml` was genuinely merged, keeping develop's overrides and carrying `main`'s `browserslist: '>=4.28.7 <5'` floor, with the mysql2 comment reconciled to cover both advisories and to stop naming a prisma version the override outlives; `pnpm-lock.yaml` was resolved from the merged manifests, which needed exactly one added line — the browserslist override — with **zero package movement**, because develop had already resolved 4.28.8 on its own.

The first-parent delta against `2485ae4` is therefore two files and 17 insertions.

Final resolutions: qs 6.16.0, fast-uri 3.1.6, fastify 5.12.1, browserslist 4.28.8, mysql2 3.24.2, sharp 0.35.4, postcss 8.5.23 + 8.5.26. No package regressed and no unrelated version entered.

## K.11 Verification evidence

**Local, on the merged tree** — lint, typecheck, typecheck:test and unit tests 23/23 uncached; `typecheck:root`; tools lint, typecheck and **143 tests**; `check:drift` all five checkers including `[workflow-branches] ok`; module contract; **532 integration tests** (+1 expected fail) against PostgreSQL 16; **59 browser tests**; production and RC compose resolving with default *and* overridden edge subnets, single-source-of-truth matching in all four; `osv-scanner`: **no issues found**.

**Mutation proofs, all re-run after the merge** — removing the stable-line guard fails 4 tests; reverting train selection to `git describe` fails 7 of 12; the hop-only `trustProxy` predicate fails 2; the address-only predicate fails 1.

**Remote**

| SHA | branch | CI | Security |
| --- | --- | --- | --- |
| `2485ae4` | develop-2.2 | 33661476297 ✅ | 33661476304 ✅ |
| `e119473` | hotfix PR #28 | 33661504186 ✅ (PR) | 33661551616 ✅ (dispatch) |
| `d912acd` | main | 33662937653 ✅ | 33662937606 ✅ |
| `6168a53` | develop-2.2 (merge) | 33664969954 ✅ | 33664970003 ✅ |

The dispatched run 33661551616 proved both halves of §K.6's design in one invocation, verified from the job logs: `osv-weekly` checked out `refs/remotes/origin/hotfix/mysql2-main` at `e119473`, `osv-weekly-release-train` checked out `refs/remotes/origin/develop-2.2` at `2485ae4`. On every push run, `gitleaks`, `semgrep` and `osv-push` are `success` and the two weekly jobs are correctly `skipped`.

## K.12 Execution status and next work

No `v3.*` tag exists on the remote (remote tag count unchanged at 56), `pnpm release:prepare` has not been run in any mode, and no release artifact has been built from either line. `git-cliff --bumped-version` on `develop-2.2` continues to compute **v3.0.0**, justified by the `storage.type` AppConfig contract break in `612c9a6` — a supported-configuration change under the policy recorded in `ca23216`, independent of the `feat(calendar)!` label, which that policy would not apply today.

The immediate Cycle 9 objective is unchanged from §J.10: the **`@luke/api` package-contract boundary** — stop `apps/web` and the root scripts program consuming `apps/api/src`, establish an explicit built type contract for the tRPC `AppRouter` surface, and make it package- and `exports`-based as `@luke/core`, `@luke/nav` and `@luke/calendar` already are. Not started.
