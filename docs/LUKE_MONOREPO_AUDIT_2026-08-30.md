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

## K.13 v2.1.4 publication

Supersedes **only** §K.12's time-sensitive execution snapshot — the statements there that no `v3.*` tag exists and that Cycle 9 is not started remain true, but "release preparation has not run" no longer is: the stable line has since been released as `v2.1.4`. Everything in §K.1–§K.11 is unaffected and stands as written.

`v2.1.4` publishes the security remediation recorded in §K.7 and §K.8. It is **not** the `v3.0.0` release train, and it consumed no version from it: `git-cliff --bumped-version` on `develop-2.2` still computes **v3.0.0**, and no `v3.*` tag exists.

### Preparation and merge

`pnpm release:prepare` on a temporary `hotfix/release-v2.1.4` branch cut from `d912acd` computed exactly `v2.1.4`. A `release/*` name was deliberately not used — that namespace belongs to ruleset 22082018, which protects release trains, not disposable patch preparation.

Version-bump commit **`58aa8fe76858d5c67a4b8aa249e8820b94309b16`**, eight files: `CHANGELOG.md` (+20) and the seven tracked `package.json` files, each a version-only `2.1.3` → `2.1.4`. No lockfile, source, workflow, Compose or configuration change. The generated `[2.1.4]` section carries eight entries, all derived from `main` commits since `v2.1.3` — no `develop-2.2`-only work.

Worth recording because it looks like a failure and is not: `pnpm sync-version:check` **cannot** be green between the bump and the tag. It reads `git describe --tags --abbrev=0`, which is still `v2.1.3` at that point — the behaviour `scripts/release-prepare.sh` documents in its own header. It returned 0 once `v2.1.4` existed.

**PR #31** merged through ruleset 22132087 with a normal merge commit pinned to the head SHA — no squash, rebase, administrator bypass or auto-merge. Main merge SHA **`935dc29fa3c7edee656d75c5354c6e140584254d`**, second parent `58aa8fe`. All seven package versions and the eight-entry CHANGELOG section verified at that SHA before tagging.

### Verification on `main`

| run | workflow | result |
| --- | --- | --- |
| **33668747530** | CI | ✅ `Lint, TypeCheck & Unit Tests`, `Integration Tests`, `Migrations` |
| **33668747741** | security | ✅ `gitleaks`, `semgrep`, `osv-push` (weekly jobs correctly skipped) |

### Provenance proof — local, not a workflow check

`main`'s `release.yml` still predates the provenance job described in §K.2. That gate exists only on `develop-2.2` and does not reach the stable line until the release train merges, so `v2.1.4` was published by the **pre-provenance** release workflow.

The gate was therefore run explicitly before the tag was pushed, sourced from `origin/develop-2.2` and executed against the real repository and the local tag:

```
[release-provenance] ok — v2.1.4 is a stable tag on 935dc29fa3c7edee656d75c5354c6e140584254d.
channel=stable   version=2.1.4   series=2.1
publish_series=true   publish_latest=true   publish_rc_latest=false
```

This is recorded as a **pre-push local proof**, not as evidence of a check that ran in CI. Lightweight tag `v2.1.4` → `935dc29`, never forced and not moved since.

### Artifacts

Release run **33669314781**, all five jobs successful: `Verify / Lint, TypeCheck & Unit Tests`, `Verify / Integration Tests`, `Verify / Migrations`, `Build API image`, `Build Web image`.

| image | digest |
| --- | --- |
| `ghcr.io/brail/luke-api` | `sha256:e31f5cf6ec8d57b5472474428822f6aa5cb4659605cc17fe084911718df00020` |
| `ghcr.io/brail/luke-web` | `sha256:99b1fd78e616e23909ba522e6211750620ec21cd5f086a7293ae19d58a4019c5` |

For **each image independently**, `2.1.4`, `2.1` and `latest` resolve to that single digest. Both `rc-latest` pointers are byte-identical before and after publication — `luke-api` at `sha256:ed27e3ce…bade99`, `luke-web` at `sha256:8e348d2a…f28ad6d` — confirming in practice the channel separation §K.2 enforces in principle.

`ghcr.io/brail/luke-api:2.1.4` carries `APP_VERSION=v2.1.4`, read from its image config. **The Web image's embedded `APP_VERSION` is unverified**: it is not exposed through that image's manifest-list config, and it was not probed by running the container. It must be checked during deployment validation, not assumed from the API image.

### Deployment status

**Artifacts are published; production has not been deployed or modified.** No Portainer action was taken and no production container, image, volume, network or environment variable was touched. Deployment is a separate, separately reviewed action.

### Synchronization

`main` merged back into `develop-2.2` as **`704cdfb8bb1a341886c480d3033112c397dac1b1`**, first parent `5bd87c7`, second parent `935dc29`. Zero conflicts; the first-parent delta is exactly the release bump — eight files, 27 insertions, 7 deletions — because everything else on `main` had already arrived in `6168a53`. Remotely green: CI **33671347763**, Security **33671347886**.

The manifests on the release train now read `2.1.4`. That is the stable line's released version, not the train's target; the next stable graduation sets them again from git-cliff's computation.

### Next work

Unchanged from §K.12: the **`@luke/api` package-contract boundary** is the immediate Cycle 9 objective, not started.

# Appendix L — Cycle 9 closure: the `@luke/api` package contract (2026-09-03)

Supersedes **only** the time-sensitive statements in §K.1, §K.12 and §K.13 ("Next work") that Cycle 9 is not started. Everything else in Appendix K, and every section before it, stands as written.

## L.1 Disposition

**`@luke/api` package contract: CLOSED.** `apps/api/package.json` points `main` and `types` at `dist`, publishes an `exports` map that admits only `.` and `./package.json`, and ships a `files` allowlist of `dist`. Consumers compile against `dist/index.d.ts` — `AppRouter`, `RouterOutputs`, `RouterInputs` — and every private subpath (`src/*`, `dist/*`, `routers`, `lib/*`) is refused by TypeScript and by Node with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The package-boundary half of `P1-06` that §J.7 left open is closed at the boundary it belonged to.

**API source out of the Web and root TypeScript programs: CLOSED.** Measured in `00c21b0`: `apps/api/src` 129 → 0 files in `apps/web` (production, 3354 → 1618 files), `apps/web` (tests, 3489 → 1760) and the root scripts program (2282 → 524). All three read 16 built declarations instead.

**API and Nav source out of the Web runtime image: CLOSED.** Every `@luke/api` import in `apps/web` is `import type` and erased at build, so the runner stage copies neither `apps/api` nor `packages/nav`; `apps/web/node_modules/@luke/api` is a dangling symlink in the shipped image, by design.

**Deterministic clean builds: CLOSED.** Every emitting workspace deletes its outputs before compiling, and the TypeScript `composite` setting that let a build report success while emitting nothing is gone (§L.3).

**Development lifecycle: native Turbo and TypeScript.** A custom build/watch/ownership coordinator was implemented, reviewed and rejected before anything reached the remote (§L.4).

**Release state: unchanged.** No tag, no release preparation, no deployment, no production change, no version bump (§L.9).

## L.2 The contract

- `apps/api/package.json`: `main`/`types` → `./dist/index.js` / `./dist/index.d.ts`; `exports` = `{ ".", "./package.json" }`; `files` = `["dist"]`.
- `apps/web`: `@luke/api` moved to `devDependencies` and out of `transpilePackages`; `apps/web/tsconfig.json` documents that all three workspace packages now resolve through their own `exports` maps to `dist`.
- Root: `typecheck:root` and `test:module-contract` build `@luke/api` before compiling against it; `postinstall` runs `prisma generate`, because a fresh clone otherwise died at `@luke/nav#build` with TS2305 before any development task ran.
- `turbo.json`: `dist-scripts/**` joins `build.outputs`, so the API's compiled admin scripts are cached and restored with the rest.

## L.3 Deterministic clean builds and the `composite` root cause

`apps/api` and `packages/core` carried `composite: true`, which implies `incremental`. TypeScript then trusts `tsconfig.tsbuildinfo` as the record of what it emitted and never checks that the outputs exist. Reproduced on both: `tsc` → 176 declarations (api) / 54 (core), `rm -rf dist`, `tsc` → **0 declarations, exit 0**. A partial deletion looked built — 122 declarations against 176 declaration maps and no `dist/index.d.ts`, every build green.

`composite` existed for project references, and Cycle 8 removed the last one. It is deleted from both projects (and the inert `composite: false` overrides in their script and test configs); the same `rm -rf dist` then `tsc` sequence now yields 176 and 54. Because no `tsc` invocation of any kind prunes an output whose source was renamed or removed (a planted `dist/lib/__stale.d.ts` survives `tsc` and `tsc -b --force`), every emitting `build` is `rm -rf dist && tsc` — `apps/api` also removes `dist-scripts`. Two consecutive `pnpm build` runs cache every emitting package; the output listing is identical to the coordinator-era build.

## L.4 Development lifecycle: the rejected coordinator and the final graph

Publishing `dist` as the contract made `apps/api` a library as well as a server, so `pnpm dev` must keep `apps/api/dist` current. The first implementation — never pushed; its tip `ff5e4b2` was preserved as a temporary local recovery ref, `backup/pre-b2-rewrite`, for the duration of review and verification — answered a different question: how to run emitting builds safely inside a worktree where `pnpm dev` is already up. It added a lock-directory protocol (a build claims a package, every watch polls the claim, suspends, and resumes; pid-stamped records reclaimed on crash) through four shared scripts and four test files, 1,832 lines. The architectural review rejected it on two grounds: that workflow is not a supported requirement, and the corruption it guarded against was the `composite` defect of §L.3, which has a two-line fix. A native alternative, `turbo watch dev`, was measured and also rejected: it restarted the persistent API and Next tasks on every dependency change and re-ran the 14-second API build per save.

The committed lifecycle is Turbo's own ordering plus one addition:

| task | dependsOn | note |
| --- | --- | --- |
| `dev` (core, nav, calendar) | `["^build", "build"]` | `tsc --watch`; unchanged from the prior ordering |
| `@luke/web#dev` | `["^build"]` | `next dev`; no production Next build precedes it |
| `@luke/api#dev` | `["^build", "build"]`, `with: ["@luke/api#dev:types"]` | `tsx watch` |
| `dev:types` | `["^build", "build"]` | `tsc --watch --emitDeclarationOnly`, added |

Every emitting watcher therefore starts only after its own initial build and its dependencies' builds have finished, which is the single-writer guarantee at startup. Two facts recorded in `lessons.md` because the review caught them: a `dev` task that emits must keep the dependency on its own `build` (`^build` alone lets a library watch start beside the build that API and Web request), and a package-specific Turbo entry replaces the global one rather than merging with it, so `@luke/api#dev` spells out every key.

## L.5 Supported rule for emitting commands while dev is running

Recorded in `CLAUDE.md`: do not run emitting builds or tests (`pnpm build`, `pnpm test`, `pnpm typecheck`, the pre-push hook) in a worktree where `pnpm dev` is running; use a second worktree or stop dev first. A build that completes leaves `dist` whole, because a non-incremental compile rewrites every output; one interrupted between its clean and its emit leaves a partial tree that the running watch will not restore. Type errors do not cause this — `tsc` emits on errors. `pnpm --filter @luke/api build` is only needed when dev is not running; while it runs, `dev:types` keeps the declarations current.

## L.6 Evidence

All measurements below were taken on the tree that is now `5c6b502`, on the real checkout unless stated.

**Contract.** `pnpm test:module-contract`: `@luke/core` — 3 subpaths `require()`d from `dist` as ESM; `@luke/api` — resolves to `apps/api/dist/index.js`, 6 private subpaths refused. `check-platform-integrity` P7 (published contract shape), P8 (Web runtime image free of API source) and P9 (root `postinstall`) each carry fixture cases proving the rule goes red; `pnpm test:tools` 190 / 190.

**Mutation of the output tree.** With `composite`: `rm -rf dist && tsc` → 0 declarations, exit 0. Without: 176. A manual `pnpm --filter @luke/api build` under a live `pnpm dev` left 176 declarations and `dist/index.d.ts` present; the watch's next emit followed in 3.3 s; API and Web stayed healthy.

**Development lifecycle** (cold `pnpm dev`, no Turbo cache, no `dist`):

| measure | result |
| --- | --- |
| API listening / Next ready / all four watchers settled | 23.6 s / 20.5 s / 30.1 s |
| watcher start after its own build end (summary end time vs ms-stamped log) | core +0.210 s, nav +0.262 s, calendar +0.192 s, api `dev:types` +0.219 s |
| `@luke/web#dev` after api, core and calendar builds | +0.217 s; `@luke/web#build` absent from the run |
| core edit → `packages/core/dist/index.d.ts` / API restart by `tsx watch` | 0.47 s / 1 |
| router edit → `apps/api/dist/routers/health.d.ts` / `apps/web` `tsc --noEmit` | 3.2 s / TS2322 on a deliberately wrong literal |
| login page edit → SSR HTML | 94 ms |
| Ctrl-C (SIGINT to the process group) | 0 descendants, ports free, no watcher left |

**Full stack.** `check:drift`, `lint:tools`, `typecheck:tools`, `typecheck`, `typecheck:test`, `typecheck:root`, `lint` (49 pre-existing `apps/web` warnings, 0 errors), unit tests (core 5, web 7, calendar 6, api 41 files), browser component tests (4 files), `pnpm build` twice (second run cached for every emitting package). Outputs: core 216 files / 54 declarations, nav 60 / 15, calendar 36 / 9, api 704 / 176, `dist-scripts` 42.

**Docker.** Both images built from a clean export of the committed tree on Docker Desktop: API 230 s, Web 339 s, exit 0. Web runner stage: `/app/apps/api` absent, `/app/packages/nav` absent, `.next` present, `@luke/api` link dangling. API runner stage: `dist`, `dist-scripts`, no `src`, no `tsconfig.tsbuildinfo`. The images were discarded; nothing was published.

## L.7 Commit chain and size

Rewritten locally from the unpushed coordinator series by folding each change into the commit that introduced the behaviour; the reconstructed tip's tree is byte-identical to the reviewed snapshot (`backup/b2-snapshot`, `7754f8f`): empty diff and equal tree hash. Pushed as a fast-forward `d12ec10..5c6b502`, never forced.

| commit | subject |
| --- | --- |
| `b5e19fb812525da73435838e5744323cbb3b7357` | fix(build): rebuild every emitting workspace from a clean state |
| `d5a1fd5ed312e8cf474f7d02bfd9cec59d66a6d2` | fix(build): capture dist-scripts in the turbo build outputs |
| `00c21b04978859de44755a20ef54dad43205550c` | refactor(api): publish a built type contract behind an exports map |
| `a4ea6eaba528a64ab1c395007dc75ba9a2c084da` | refactor(web): stop shipping API source in the production image |
| `5c6b5024bf7185d6f699d8c9af7f84752e194f7d` | test(tools): gate the @luke/api package contract and the dev bootstrap |

Final diff against `d12ec10`: 29 files, +1365 / −69, of which +1201 are the contract gate, its fixtures and `module-contract.cjs`. The rejected series measured +3156 / −67; the 1,832 coordinator lines never reached the remote.

## L.8 Remote verification at `5c6b502`

| run | workflow | jobs |
| --- | --- | --- |
| **33767286218** | CI | ✅ `Lint, TypeCheck & Unit Tests` (100688282991), `Migrations` (100688283258), `Integration Tests` (100688283347), `Browser Component Tests` (100688283493) |
| **33767286168** | security | ✅ `gitleaks` (100688282483), `osv-push` (100688282868), `semgrep` (100688283097); skipped by design: `osv-weekly-release-train`, `osv-weekly` (schedule-only), `notify-on-failure` (no failure) |

## L.9 Release and deployment status

No tag was created, `pnpm release:prepare` did not run in any mode, no image was published, no Portainer or production action was taken, and no manifest version moved: every `package.json` still reads `2.1.4`, the stable line's released version (§K.13). `origin/develop-2.2` advanced only by the five commits above. At closure time two temporary local backup branches existed — `backup/pre-b2-rewrite` (`ff5e4b2`, the rejected series) and `backup/b2-snapshot` (`7754f8f`, the reviewed snapshot) — never pushed, and eligible for deletion once the audit commit passed remote verification.

## L.10 Next work

`6.2` dependency-boundary enforcement, in the order §J set: it follows the real package contracts, and all four workspace packages now publish one. Not started.

# Appendix M — Cycle 10 closure: dependency-boundary enforcement (2026-09-04)

Appends to Appendices A–L; nothing above this heading is rewritten. Supersedes only the "Next work" statement in §L.10, which Cycle 10 has now executed. Baseline `354cbc559646c0fe19f3d3576e9b28fc43ad263d`; implementation chain `97f552d7504d1097b02e3730caa3e7d4a45e9c74` → `9f4fffbed82f70e8b4333ba8e6087a3293a7a4bc` → `7cacf08a99dd6b43bd2a2f0c6fdb0f9921b172a8` → `8865fb7a8dd3486fa2a373f258d42827c5a2191b` → `7cd71c9462ce91eeb796a4e0ea742f65a26f7765` on `develop-2.2`, pushed as a fast-forward and never forced; `origin/develop-2.2` is `7cd71c9`.

## M.1 Disposition

**`6.2` (make dependency direction machine-checkable) → DONE.** The item as written listed four rules — core must not import nav or calendar, the web client must not import server-only modules, integration packages must not leak into core — and four candidate mechanisms. Cycle 10 closed it without a dependency-graph tool and without a second statement of the graph: normative direction lives in the platform-integrity checker as a two-attribute policy over the manifests, declaration integrity lives in ESLint over every static module-reference form, the one server-only entrypoint has one explicit allowlist, and the graph property none of those can prove is exercised by the Next production build on every push. §L.10 named this as the next work once every workspace published a real package contract; it did, and this is it.

**Co-closures.** §J.7 residual 4 — root `scripts/**` had typecheck but no ESLint coverage — is DONE: `lint:tools` now lints `scripts/` and the root tooling configs. §F.10's enforcement gap is resolved at the layer F.10 anticipated — a different one from flat-config globs: the direct reference to the server entrypoint is refused by a specifier rule at lint time, and the transitive graph is refused by the bundler in CI. `P0-02b` itself remains PARTIALLY ADDRESSED as recorded in §F.1: the isomorphic web bucket still carries both global sets, because the same source file genuinely runs on both sides; that is a description of Next's model, not a gap this cycle could close by glob, and a wrong-runtime global reference inside that bucket is still not a lint error.

**Narrowed, not closed.** Item `5.3` (root devDependencies on `@luke/api` and `@trpc/client`) asked to "verify they are not load-bearing, then remove". Verified: both are load-bearing — `scripts/rc-prod-clone.ts` imports `@luke/api` as a type and `@trpc/client` as a value — so the removal the item proposed is not available. The root manifest is now classified `tooling` under the workspace policy and may name workspaces only under `devDependencies`, which is exactly what it does. What remains of `5.3` is the consequence the root declaration has for every workspace: Node resolution walks up to the root, so `@luke/api` and `@trpc/client` resolve from `packages/core` and `tsc` accepts the import. The workspace half is now caught at lint (§M.2); the third-party half is not, and stays open under `5.3`.

**Not built, deliberately.** No edge list, no dependency-cruiser, no Nx boundaries, no Semgrep import rules, no `server-only` marker package, and no restoration of `lint → ^build`. Each was measured and is recorded in §M.3.

## M.2 The architecture: three authorities and one build

The first proposal — one ESLint rule reading the importer's manifest — was falsified by the review before implementation: with `@luke/api` added to `packages/core/package.json` and imported from core, the rule, core lint, core typecheck, `check:platform` and `check:tsconfig` all passed. Only Turbo's task graph objected, with "Cyclic dependency detected", and only because api → core already existed; the same edge from nav to calendar closes no cycle and would have been accepted. A rule that reads only the importer's manifest is declaration integrity, and a manifest is a permission the importer can grant itself. Direction needs a policy above the manifests. The closure is therefore two layers whose composition is the invariant:

| Invariant | Statement | Owner | Runs |
| --- | --- | --- | --- |
| I2 — normative direction | declarations ⊆ policy: every workspace dependency a manifest declares respects the layer and runtime attributes in `WORKSPACE_POLICY` | `checkWorkspaceDependencyDirection` (P10) in `tools/scripts/check-platform-integrity.ts` | `check:drift` — CI and `.husky/pre-push` |
| I1 — declaration integrity | imports ⊆ declarations: every static reference to a workspace package is declared by the nearest manifest, with the semantics in §M.4 | `@luke/no-undeclared-workspace-import` | CI lint step, editor |
| I3 — server entrypoint | in `apps/web`, `@luke/core/server` is referenced only from `WEB_SERVER_ENTRYPOINT_IMPORTERS`, which is `apps/web/src/auth.ts` | `@luke/no-restricted-module-references` | CI lint step, editor |
| I4 — Next graph | no module importing a Node builtin enters the `[Client Component Browser]` layer | Turbopack, `next build` | CI, "Build (web)", every push |

I1 and I2 compose: imports ⊆ declarations ⊆ policy, so an import respects direction even when the importing package edits its own manifest, because the edit itself is what P10 refuses.

**P10** is seven rows keyed by manifest path, like `PUBLISHED_CONTRACTS`, so the behavioural fixtures exercise it under their own names: `packages/core` layer 0 universal; `packages/nav` and `packages/calendar` layer 1 node; `apps/api` layer 2 node; `apps/web` layer 3 browser; the repository root and `eslint-plugin-luke` are `tooling`. A runtime dependency may reach only a strictly lower layer whose runtime is universal or the dependant's own; a devDependency only a lower layer; same layer is sideways and forbidden; tooling names workspaces only under `devDependencies`. It fails closed on: a tracked manifest with no row, a row with no manifest, a `workspace:` link to a name no single manifest has, a tracked workspace declared with a semver range instead of `workspace:`, a workspace under `peerDependencies` or `optionalDependencies` (no manifest uses either, so the group is refused rather than given a meaning), a self-dependency, a package listed under both groups, a classified manifest with no name, and two manifests sharing a name — both are reported, and the shared name resolves no edge. Measured on the real tree before the fix: the baseline's own `apps/web → @luke/calendar` was red (browser taking a Node library at runtime), and each of core → api (upward), nav → calendar (sideways), web → api at runtime, root → nav at runtime, a semver range on `@luke/core` and a `workspace:` ghost produced one precise message.

**I1** reads the nearest `package.json` and judges the specifier; it performs no module resolution, which is what keeps it correct in CI, where `pnpm lint` runs before any `dist` exists (Cycle 7 removed `lint → ^build`). **I3** is the same visitor with a fixed denylist. **I4** was measured directly: a `'use client'` component importing `@luke/core/server`, one importing `auth.ts`, one reaching the entrypoint through an undirected helper, and a core barrel re-exporting `crypto/secrets.server` each failed `next build` with `Module not found: Can't resolve 'fs'` traced through `secrets.server.js [Client Component Browser]`, while lint and tsc stayed green. That build ran only in the Docker builder stage at tag time; it now runs on every push (§M.8).

## M.3 Rejected alternatives, each measured

- `import-x/no-extraneous-dependencies`: resolution-based. With no `dist` present — CI's state during lint — it reported nothing on any of the baits; with `dist` built it reported four. It also allows devDependency value imports by default and judges every external package, a different, pnpm-covered concern.
- `import-x/no-relative-packages`: resolution-based, and its default resolver has no `.ts` extension, so it caught a `dist/*.js` escape and missed the `src/*.ts` one.
- `import-x/no-restricted-paths`, dependency-cruiser, Nx module boundaries, Semgrep import rules: resolution- or graph-based, so the same `dist` dependence, plus a second hand-written statement of the graph beside the manifests. Two attributes per workspace express the invariant and derive the graph.
- ESLint's own `no-restricted-imports` for I3: it sees `import` and `export … from` only. Five of the seven static forms an unenrolled file can use — `import()`, a static template literal, `require()`, `import x = require()`, `import('x').T` — were silent on the real config.
- `server-only` markers: the package throws under plain Node, so it cannot mark `@luke/core/server`, which Fastify consumes; it would fit only the web files, where the build already fails through `fs`. A dependency for a clearer message.
- Restoring `lint.dependsOn: ["^build"]` to make resolution-based rules honest: reverses Cycle 7 to buy what a non-resolving rule gives for free.
- Directive-based client/server file classification: §F.10's objection stands, and the graph confirmed it — the same undirected module legitimately enters both graphs.

## M.4 The source surface

The rule judges every tracked workspace package, scoped or not. The names are not a list in the config: `eslint.config.mjs` reads the `packages:` sequence of `pnpm-workspace.yaml`, expands each `<dir>/*` glob and reads every manifest's `name`, and refuses to lint if the result is empty or a glob has a shape it does not understand. The unscoped `eslint-plugin-luke` is therefore judged exactly like `@luke/core`; before this, an undeclared `import plugin from 'eslint-plugin-luke'` was silent.

Semantics, per reference: a package under `dependencies` may be referenced in any form; a package only under `devDependencies` may be referenced as a type — `import type`, inline `type` specifiers, `export type`, `import('x').T`, `typeof import('x')` — and as a value only in test and tooling files (`{apps,packages}/**` test globs, `apps/web/{tests,e2e}/**`, `apps/api/test/**`, `tools/`, `scripts/`, the root JavaScript configs); `peerDependencies` and `optionalDependencies` never declare a workspace edge; a package may not name itself; a relative path must stay lexically inside the directory of the manifest that owns the file, decided by the path alone — `..` or a `../` prefix after `path.relative` escapes, a component merely named `..foo` does not, and nothing is resolved, so the destination need not exist; an absolute specifier — POSIX, Windows drive or `file:` — is refused outright. Every form counts through one shared visitor: `import`, `export … from`, `export *`, `import()` and `require()` with a string or a no-expression template literal, `import x = require()`, and the type-level `import('x').T`, read through typescript-estree's canonical `source` field rather than its deprecated `argument` getter; a specifier built from an expression is not judged, because it is not statically knowable. Both rules validate their options at the schema level, so a block that omits `workspacePackages` or `paths` is a configuration error ("Value [] should NOT have fewer than 1 items"), not the `TypeError` while loading the rule that the first implementation produced and not a silent no-op.

The surface the rules run on matches the invariant. One glob, `{apps,packages}/**/*.{ts,tsx,mts,cts}`, is the parser and plugin surface for every workspace, so the test-file override globs are subsets by construction — before this, a future `packages/nav/test/*.test.ts`, `apps/web/e2e/*.spec.ts` or a TypeScript test inside the plugin matched the override but not the parser block, and ESLint aborted with "could not find plugin @luke" on all four paths measured. The web surface is every source form Next can build — `ts, tsx, js, jsx, mts, cts, mjs, cjs` — split into a production source constant, which the five project UI rules govern, and a test constant, which they do not; framework rules, runtime globals and I3 apply to both. Lint commands no longer narrow what the config covers: `eslint .` per workspace reaches the Prisma seeds and `prisma.config.ts`, the vitest and Playwright configs and the plugin itself, and `lint:tools` reaches `scripts/`, `eslint.config.mjs` and `commitlint.config.js`. Of the 17 executable files no lint command reached at the baseline, four remain outside by design: the semgrep rule fixtures under `.semgrep/tests/`, which exist to violate rules. The two `module-contract.cjs` probes keep their own block without I1, documented there: each `require()`s its own package by name, which is the self-import the rule forbids everywhere else and the one thing those files exist to do. `apps/api/dist-scripts/**` joined the ignore list as build output. Two newly covered files had their imports reordered mechanically.

Turbo's `lint` task now hashes its real inputs: `$TURBO_DEFAULT$` plus `$TURBO_ROOT$/eslint.config.mjs`, the plugin's `index.js` and `rules/**/*.js`. Measured in a sequential cycle: appending one comment line to the root config moved all four workspace lint hashes; appending one to a plugin rule moved all four again; appending one to `README.md` moved none; each restore reproduced the baseline byte for byte.

## M.5 Web dependency cleanup

`apps/web` had declared `@luke/calendar` as a runtime dependency since `148bb53`, added so that `externalDir` could type-resolve `apps/api/src`; Cycle 9 ended that traversal and no import remained. Under the policy the edge is not merely dead but forbidden — a browser package taking a Node-only library at runtime — and P10 is red on the baseline for that row. Removing it was the first real finding the policy produced. `pnpm remove` also normalised the `update-browserslist-db` peer range in the lockfile to the `browserslist` override that already existed in `pnpm-workspace.yaml`. The two places that described the edge — the package-contract comment in `apps/web/tsconfig.json` and the generated internal-dependencies block in `apps/web/README.md` — were corrected in the same commit, so no point in history describes a dependency that had just been removed.

The asymmetry with `packages/nav → @luke/core`, declared and also unused (§H.5), is the policy's point: under a declarations-are-permissions model, "unused" is not the criterion. nav → core is a Node package taking a universal package one layer down, a permitted capability; its removal is hygiene and was left for the hygiene batch. web → calendar was never permitted.

## M.6 One authority for the server entrypoint

`WEB_SERVER_ENTRYPOINT_IMPORTERS` was first drafted by inheriting `WEB_NODE_ONLY_FILES`, the Cycle 5 runtime-globals list. Auditing that list entry by entry rejected the inheritance: being Node-only is not the same as having business with the master key. `auth.shared.ts` is the client-safe half of the auth configuration, and a server import there builds green (`next build` exit 0) and fails at first client use, so lint is the only signal there is; a Node-tier test that imported the entrypoint passed — against the real `~/.luke/secret.key` of whoever ran it, and it would create one on a CI runner; route handlers are Node by default but may opt into `runtime = 'edge'` without anything noticing, and none needs the entrypoint. `lib/authz/**`, admitted in an intermediate draft, imports `auth` and never the entrypoint. The final list is one file, `apps/web/src/auth.ts`, the only real importer, which declares `runtime = 'nodejs'`; a file that genuinely needs the entrypoint is enrolled there by name.

The unwired `tools/scripts/validate-client-server-boundaries.ts` — a 159-line script that stated a second, contradictory allowlist (any file under `apps/web/src` not in `server/` or `api/`) and was run by no script, hook, workflow or skill — is removed, together with its live instructions in `tools/README.md` and the root `README.md`. `tools/reports/import-optimization-final-report.md`, which records the script historically, is untouched.

## M.7 `proxy.ts` is Node, and two stale comments

`eslint.config.mjs` granted `apps/web/src/proxy.ts` Edge/worker globals on the pre-16 middleware premise, with a comment that read Next's Edge runtime source to justify it. On Next 16.3.3 that premise is false: `next/dist/build/analysis/get-page-static-info.js` refuses a route-segment config in the proxy with "Proxy always runs on Node.js runtime". The dedicated Edge block is gone; `proxy.ts` sits in `WEB_NODE_ONLY_FILES` with Node globals — bait: `Buffer` and `process.cwd()` lint clean, `window` is `no-undef` — and deliberately not in the server-entrypoint allowlist. The file's own header no longer calls itself Edge middleware. `apps/web/next.config.js` no longer claims a route handler for the temporary brand-logo upload; the tracked flow posts straight to `/upload/brand-logo/temp` with its Bearer token through the `/upload/:path*` rewrite, and the comment says so (§M.9 records why it had said otherwise). All comment-only; no runtime behaviour changed.

## M.8 CI: the web build on every push

"Build (web)" runs `pnpm turbo run build --filter=@luke/web` as the last substantive step of the existing required job "Lint, TypeCheck & Unit Tests", after the cheaper gates, so failures surface earlier and the required-check identity is unchanged; no new job. Bounded to `apps/web`: no image, nothing published, `.next` discarded with the runner. It is cache-safe for the variables it models, not a claim of completeness: a first draft used Turbo's loose env mode, and a dry run showed that under strict mode only `NEXT_PUBLIC_*` was inferred, so `INTERNAL_API_URL` was dropped, while under loose mode it was passed but not hashed — a different value was a cache hit. `turbo.json` now carries an explicit `@luke/web#build` entry: `INTERNAL_API_URL` (the rewrites branch in `next.config.js`) and `NEXT_PUBLIC_*` (inlined into the bundle) are hashed inputs; `NEXTAUTH_SECRET`, `NEXT_TELEMETRY_DISABLED` and `NODE_OPTIONS` are passthrough, visible to the task and absent from its key. Measured: the task hash moved from `cb3ae6ba53c598c8` to `775dfafcd63f3688` on an `INTERNAL_API_URL` change and to `4f8f66de9f9c5318` on a `NEXT_PUBLIC_API_URL` change, and stayed at `cb3ae6ba53c598c8` when only `NEXTAUTH_SECRET` changed. The step sets reserved `.invalid` hostnames, a placeholder secret no runtime reads, the heap size the Dockerfile documents, and no `NODE_ENV`, because `next build` forces `production` itself. The exact step command was also run from a clean export of the working tree — tracked and untracked-but-not-ignored files only, no `.env.local`, no `dist` — with a frozen install: exit 0 in 39 s, strict mode, all six rewrites recorded against `api.luke.invalid:3001`. Whether the build runs in Docker with the same result is a separate question this step does not answer.

## M.9 The ignored stale route

An in-tree production build during the investigation generated 42 static pages; the same tree exported cleanly generated 41. The difference was a single route, `/api/upload/brand-logo/temp`, served by `apps/web/src/app/api/upload/brand-logo/temp/route.ts` — a file that was never tracked, because `.gitignore` ignores every directory named `temp/`, and that was therefore absent from every clean export and every CI run while present on the developer's disk. `.env.local` sets only `INTERNAL_API_URL` and `NEXTAUTH_SECRET`, neither of which adds a route. The file was retired only after proving that the tracked flow does not use it: `BrandDialogWithPermissions.tsx` posts by XHR to `buildTempBrandLogoUploadUrl()`, which is `/upload/brand-logo/temp`, with an `Authorization: Bearer` header, and reaches the API through the `/upload/:path*` rewrite like every other upload. After retirement the in-tree build and a refreshed clean-export build both generate 41 static pages and their `routes-manifest.json` and `app-path-routes-manifest.json` are byte-identical (`e6caca29d9983375`, `a305a84ccc3213f0`). A copy of the retired file exists in the session's scratchpad outside the checkout; it is not part of repository history and was never added to Git.

## M.10 Review history

Three independent review rounds preceded the fold, and no review-fix commit was made; every correction was folded by hunk into the five commits. The first round falsified the single-rule design (§M.2), rejected the inherited allowlist (§M.6), required the CI build instead of counting release-time Docker builds, and corrected the test-count wording of the first report (plugin cases were 24 → 55 at that point, not "55 → 86"). The second round made the CI build cache-safe, closed I3 for every reference form, matched I1 to its stated source surface, closed four rule-level holes (import types, static template literals, peer/optional groups, containment without a destination), made P10 package identity fail closed, and corrected the rule header and the proxy comments. The third made Turbo lint inputs honest, linted the root configs, fixed containment for `..foo` components, made the duplicate-name report match its claim, retired the stale route, and re-established manifest parity. A final bounded pass corrected the rule's `meta.docs.description`, made the web extension surface coherent between globals, UI rules and boundary rules, and added `.mts`/`.cts` to the boundary surface.

Two process facts belong here rather than in `lessons.md`, which this cycle did not edit. The shell's working directory drifted into a disposable prototype clone for one turn; the affected commands were re-run against the real root and both trees verified before anything else was done. A probe cleanup ran `rm -rf packages/core/test`, deleting the tracked `module-contract.cjs`; the diff stat caught it and the file was restored byte-identical from HEAD before the module-contract gate ran. Two build mutations were vacuous on the first attempt because the probe route sat under an underscore-prefixed folder, which Next treats as private; they were rerun under a routable path. The fold itself built each commit's tree through a temporary index, staging intermediate blobs for the four shared files, and moved the branch with one `update-ref`; the tip's tree equals the reviewed working tree, `784636ddd8945702a6a75147eba5bbc0513212de`, which a local backup ref also pins.

## M.11 Evidence

Local, on the tree that is now `7cd71c9`, all green: `check:drift` (skill 17, docs 62, platform 7 manifests and 7 workspace roles, tsconfig 13, workflow branches) · `test:tools` **215/215** (was 190) · `eslint-plugin-luke` **117/117** (was 24) · `lint:tools` · `pnpm lint` 0 errors, 49 pre-existing warnings · `typecheck`, `typecheck:test`, `typecheck:tools`, `typecheck:root` · `test:module-contract` · unit tests forced, 9/9 tasks · the exact CI web build, strict env mode, 41/41 · commitlint over the five commits, 0 problems and 0 warnings · gitleaks over the five commits, no leaks · Semgrep ERROR tier against the baseline, 0 findings.

| commit | subject | scope |
| --- | --- | --- |
| `97f552d7504d1097b02e3730caa3e7d4a45e9c74` | chore(web): drop the @luke/calendar dependency the runtime policy forbids | 4 files, +6 / −9 |
| `9f4fffbed82f70e8b4333ba8e6087a3293a7a4bc` | chore(tools): enforce workspace dependency direction as a layer and runtime policy | 3 files, +400 / −1 |
| `7cacf08a99dd6b43bd2a2f0c6fdb0f9921b172a8` | chore(lint): make workspace imports match their declarations | 23 files, +1187 / −218 |
| `8865fb7a8dd3486fa2a373f258d42827c5a2191b` | chore(web): classify proxy.ts as Node and correct stale route comments | 3 files, +29 / −39 |
| `7cd71c9462ce91eeb796a4e0ea742f65a26f7765` | ci: build the web app on every push | 2 files, +44 |

The lockfile moves in exactly three hunks across the range: the `@luke/calendar` link removed from the web importer, the `@typescript-eslint/parser` devDependency added to the plugin importer (its tests need the parser), and the `browserslist` peer-range normalisation. No manifest version moved.

Remote, on `7cd71c9`, both push workflows and nothing else — no rerun, no dispatch, no compensation:

| run | workflow | jobs |
| --- | --- | --- |
| **33851780067** | CI | ✅ `Lint, TypeCheck & Unit Tests` (100955994875), `Migrations` (100955994987), `Browser Component Tests` (100955995011), `Integration Tests` (100955995017) |
| **33851779951** | security | ✅ `osv-push` (100955994620), `semgrep` (100955994699), `gitleaks` (100955994811); skipped by their intended conditions: `osv-weekly-release-train`, `osv-weekly` (schedule-only), `notify-on-failure` (no failure) |

Inside `Lint, TypeCheck & Unit Tests`, step 13 **Build (web)** ran after Lint, TypeCheck, TypeCheck (test), Lint & TypeCheck (tools), TypeCheck (root scripts), Control-plane tests, Docs & skills drift, Unit tests and Module contract, and succeeded — the first execution of the Next production build in the push CI workflow. No release workflow ran on this SHA.

## M.12 Honest enforcement boundaries

- A client module reaching an enrolled server-only file, and a core barrel re-exporting a server module, are production-build properties. `next build` refuses them, now on every push; ESLint does not prove them and this appendix does not claim it does.
- A route handler that opts into `runtime = 'edge'` while enrolled for the server entrypoint would be noticed by nothing; none is enrolled, and enrolment is by file name.
- The isomorphic web globals bucket remains dual-runtime by design (`P0-02b`, §F.10), so a `Buffer` in a client component or a `window` in a server component is not a lint error there.
- `tools/` and `scripts/` share the root manifest and its tooling semantics; a tooling script may load any root devDependency at runtime, which is what tooling is for.
- Third-party packages declared only at the root, `@trpc/client` today, resolve from every workspace and are judged by nothing (`5.3`, narrowed in §M.1).
- `@types/pdfmake` still injects `lib.dom` into the API programs (§J.6); `S-01` branch protection is still a decision to make; `P1-04`, `P1-05`, `P1/P2-08`, `5.1` and `6.3` are unchanged.
- Explicitly not done in this cycle, so that nothing implies otherwise: manifest-cache invalidation for long-lived editor sessions (a newly declared dependency is seen after the ESLint server restarts), diagnostics for malformed manifests, a Turbo exclusion for the plugin's own test files from the lint inputs, any change to the 49-warning cap or to `pre-push`, and dynamic `createRequire` analysis.

## M.13 Release, deployment and recovery state

No tag was created, `pnpm release:prepare` did not run in any mode, no PR was opened or merged, no image was published, no Portainer or production action was taken, and no manifest version moved: every `package.json` still reads `2.1.4` (§K.13). This appendix is the first audit change since §L. Two local-only backup refs exist — `refs/backup/cycle10-pre-fold` (`aa5445a`, the pre-fold five-commit series) and `refs/backup/cycle10-reviewed-tree` (`bb2bb2d`, a commit wrapping tree `784636dd`) — neither pushed, both eligible for deletion only once the commit carrying this appendix has itself passed remote verification. The three pre-existing stashes are untouched. The retired route's external copy (§M.9) is outside the repository.

## M.14 Next work

Per the sequence in §A.4, the next architectural item in the ordering recorded after `6.2` is **`P1-04`**, the Prisma generator migration on the current major, followed by `P1-05` and `P1/P2-08`. The hygiene batch that §A.4 assigned to its cycle 8 — `5.1`, `5.3` as narrowed here, `6.3` and the inert `tools/*` workspace glob — was displaced by the tsconfig cycle and remains a small, Sonnet-sized cycle available at any point; `S-01` remains a decision. None is started.

# Appendix N — Cycle 11 closure: Prisma generator migration and `@luke/db` ownership (2026-09-04)

Supersedes **only** the time-sensitive statements in §M.12 and §M.14 that record `P1-04` as unchanged and not started. Everything else in Appendix M, and every section before it, stands as written. `P1-05`, `P1/P2-08`, `5.1`, `6.3`, the hygiene batch and `S-01` are untouched by this cycle and remain exactly as §M.12 and §M.14 describe them.

## N.1 Disposition

**`P1-04`: DONE.** The schema declares `provider = "prisma-client"` with `output = "../src/generated/prisma"`. Every acceptance criterion in the item is met: no database migration was produced by the generator change (`prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --exit-code` reports "No difference detected", exit 0); `prisma generate` succeeds from a clean checkout through the root `postinstall` alone; the API build succeeds; the integration suite passes; no generated code enters a browser bundle, and the dependency-direction policy refuses the edge that would allow it; no published declaration points at an unavailable generated path.

**Prisma stays on 7.10.0.** This was a generator and ownership refactor, not a major upgrade — the separation the item itself prescribes. `prisma`, `@prisma/client`, `@prisma/adapter-pg` and `@prisma/instrumentation` all remain `7.10.0`/`^7.10.0`, and `checkDependencyFamilies` still holds the family to one major.

**`P1-05`: OPEN, not started.** The schema is one file of 2,419 lines — one line longer than the 2,418 recorded in the item, because the generator block gained an `output` line. No domain split was attempted.

**Release and production state: unchanged.** No tag, no `pnpm release:prepare` in any mode, no published image, no deployment, no version bump; every `package.json` still reads `2.1.4` (§K.13, §M.13).

## N.2 The architectural decision, and what was rejected

The `prisma-client` generator emits TypeScript source into a directory instead of hiding a package inside `node_modules`. That source has to belong to a workspace, and the choice was forced by two existing constraints: `@luke/nav` needs the Prisma types and may not import from `@luke/api` (the layer policy of §M.2 forbids the upward edge), while `@luke/core` ships to the browser.

Four alternatives were measured and rejected before the adopted design:

- **API-local output.** Mechanically fine for `apps/api`; `@luke/nav` broke loudly on a clean install with 13 × `TS2305`. Restoring it would have meant hand-retyping several models' upsert shapes inside nav — a second, drifting copy of generated types.
- **Two generated clients, one per consumer.** Falsified: 25 × `TS2345`. Two structurally identical generated copies are not assignable to one another.
- **Moving nav's Postgres persistence into `apps/api`.** Would have relocated 2,531 of nav's 3,596 lines and forced a rewrite of the raw-SQL rule's scope and the NAV documentation — a larger reshaping than introducing one package.
- **Prisma inside `@luke/core`.** Rejected without measurement: core is the universal, browser-shipped package, and a database client there is the precise leak the runtime classification exists to prevent.

**Adopted: a dedicated `@luke/db` workspace at layer 0, runtime `node`, beside `@luke/core` at layer 0, runtime `universal`.** Same layer means neither may depend on the other — that is the point, not an accident: core cannot pull a database client into a browser bundle, and db has no use for core's schemas. `@luke/nav` (layer 1) and `apps/api` (layer 2) may depend on it; `apps/web` (layer 3, `browser`) is refused twice over, by runtime as well as by declaration, and declares no such edge. The cost is one more manifest and one more row in each policy surface; the gain is a single owner for database tooling, a single `new PrismaClient` site, and nav's rules unchanged.

## N.3 The ownership boundary

`@luke/db` owns the database *infrastructure*: `prisma/schema.prisma`, the 76 versioned migrations and `migration_lock.toml`, `prisma.config.ts`, the generated client, the `createPrismaClient` factory, the `PRISMA_DIR` / `PRISMA_MIGRATIONS_DIR` / `PRISMA_PACKAGE_ROOT` constants, and the generic Prisma CLI operations (`prisma:generate`, `prisma:studio`, `prisma:push`, `db:migrate:new`, `db:migrate:deploy`, `db:reset`).

`@luke/api` keeps everything domain-shaped, and the boundary is meaning rather than command prefix: the seed (`prisma/seed.ts` and `prisma/seeds/`) and all nine `db:*` scripts — `db:seed`, `db:bootstrap`, `db:nav-reset`, `db:harden-google-acl`, `db:complete-stranded-rows`, `db:fix-allday-dates`, `db:migrate-rbac-section-key`, `db:migrate-storage`, `db:backfill-asset-derivatives`. They apply business rules and import `apps/api/src`; a `db:` prefix alone was not treated as a reason to move anything.

Generated source lives at `packages/db/src/generated/prisma` — 87 files, every one carrying `@ts-nocheck` and `/* eslint-disable */`. It is gitignored as a tree (verified by `git check-ignore -q` exit code, not by output), produced by `prisma generate`, compiled by `tsc` into the `dist` that both consumers resolve through the package's `exports` map, excluded from the Docker build context, and already covered by the existing `generated/` entry in `.semgrepignore`.

## N.4 Package and declaration contracts

- **`@luke/nav` declares `@luke/db` under `dependencies`**, mirroring how `@prisma/client` was declared there before. All ten of nav's imports are `import type`, and its emitted public declarations name db's types, so the edge is real at the declaration level whichever group it sits in.
- **`apps/api` declares `@prisma/client` under `devDependencies` with no source import at all.** Its emitted `.d.ts` graph reaches `@prisma/client/runtime/client` — `Decimal` and `JsonValue` travel out through the inferred `AppRouter` type — and TypeScript resolves that specifier from the file that names it, so it resolves from `apps/api`. Measured: removing the declaration left `apps/api`'s own package-local lint, typecheck and tests green, `check-platform-integrity` rejected the missing declaration, and `apps/web` went from clean to **88 errors**. The failure is invisible from the package that owns the line, which is why `DECLARATION_GRAPH_DEPENDENCIES` in `check-platform-integrity.ts` now gates it, with three fixture cases (removed, wrong group, manifest untracked).
- **`apps/web` has no database-package edge** in either dependency group.

## N.5 Deterministic generation

`@luke/db`'s `build` is `rm -rf src/generated dist && prisma generate && tsc`. The cleanup is not decorative. Measured on the real package: a stale file planted at the generator's output root, and at `models/` and `internal/` beneath it, was removed by `prisma generate` — it cleans its own output root. A file planted one level *above* that root, at `packages/db/src/generated/`, **survived**, and `tsc` compiled it into `dist` as four emitted files. The whole tree is gitignored, so no other gate — not git, not lint, not review — would ever have named it.

`PRISMA_GENERATED_TREE` in `check-platform-integrity.ts` checks the ordering, not merely the presence of both strings: `prisma generate && rm -rf src/generated` contains both and deletes the client the build just wrote. Four fixture cases cover it — no cleanup, cleanup after the generate, build script missing, manifest untracked — and reverting the real build script makes the checker fire.

`src/generated/**` is declared alongside `dist/**` in `@luke/db#build`'s Turbo outputs, and that entry is load-bearing: with it removed, a warm cache hit replayed 360 `dist` files and **0** generated files, and the db typecheck went red. With it present, the same wipe-and-replay restored 87 generated and 360 dist files and the typecheck stayed green.

## N.6 Runtime image and migration proof

The API builder builds `@luke/db` first — that task generates and then compiles, and every package below reads Prisma types through its `dist`. The runner carries `packages/db`'s `package.json`, `dist`, `prisma/` (schema and migrations), `prisma.config.ts` and `node_modules`; `apps/api/prisma.config.ts` is gone from the image, while `apps/api/prisma` is still copied because it is now the domain seed and its data. The entrypoint constructs its readiness client through `require('@luke/db')` and `createPrismaClient()` instead of assembling a client and an adapter by hand, and runs `(cd /app/packages/db && npx prisma migrate deploy)` — the only directory from which the CLI resolves config, schema and migrations together.

Proven locally, at the user's explicit instruction, as an explicitly authorised exception to the standing `lessons.md` rule that local image builds are not routine or release-authoritative evidence: the image built, the readiness probe passed, **76 migrations applied from an empty database**, a restart reported "76 migrations found in prisma/migrations … No pending migrations to apply", and after seeding, `/healthz` answered `200` and `/readyz` answered `{"status":"ready","checks":{"database":"ok","secrets":"ok","ldap":"ok"}}`. The recorded OOM from the earlier local-build attempt did not recur.

Nothing was published or deployed. The scratch container, the scratch volume, the local image and the three scratch databases were all removed afterwards; the real `luke_api_data` volume was never referenced.

## N.7 About-panel simplification

The About page listed frontend and backend dependency versions from two hand-maintained key lists — one reading `apps/web/package.json` directly, one reading `apps/api/package.json` inside a `system.about` procedure. Neither list was bound to anything, so a dependency that moved, was renamed or changed group vanished from the panel silently. Moving `@prisma/client` to `devDependencies` would have done exactly that.

The feature was removed rather than repaired: both cards, the label maps, the version stripping, the tRPC query, the loading skeleton, the `system.about` procedure and all runtime package-manifest reading in the API. The application identity, the `NEXT_PUBLIC_APP_VERSION` badge and the development marker remain; `triggerCalendarDigest` is untouched. **No replacement build-info mechanism was introduced** — the version that matters is already injected at build time from the git tag. `/about` no longer issues a query and is prerendered static (`○`) in the Next build.

Delta against the baseline: **162 deletions, 0 insertions** — 109 in `apps/web/src/app/(app)/about/page.tsx` and 53 in `apps/api/src/routers/system.ts`.

## N.8 The cold-CI failure and the forward fix

The first push of the three-commit series produced **CI run `33915244785`: failure**, and **Security run `33915244839`: success**. The failing job was "Lint, TypeCheck & Unit Tests" at step 5, TypeCheck; steps 6–13 were skipped as a consequence, so **Build (web) never executed** on that run.

The cause was a real race, not flakiness. `typecheck.dependsOn` is `["^build"]` — the *dependencies'* builds — and `@luke/db` has no workspace dependencies, so `@luke/db#typecheck` was scheduled against an empty dependency set (`pnpm turbo run typecheck --filter=@luke/db --dry=json` reported `dependencies: []`) while `@luke/db#build` ran concurrently as a prerequisite for api, nav, calendar and web. That build now begins with `rm -rf src/generated`, so the typecheck read the directory the build was deleting and failed with `TS2307` on `./generated/prisma/client.js`.

It surfaces only on a cold cache. The preceding local validation ran against warm Turbo state, in which `@luke/db#build` was a restore that never executed the delete; the failing CI execution was a cold cache miss, which executed the cleanup and exposed the race. The earlier cache-replay mutation of §N.5 exercised restoration, not concurrency, and did not cover it. This is the same class as the `dev`-task ordering defect already recorded in `lessons.md`, applied to `typecheck`.

The fix is forward-only, one commit, one file: `e8512bf3a4239794712a5d93ee48c8e40b291aec` adds a package-specific `@luke/db#typecheck` entry with `dependsOn: ["^build", "build"]` and `cache: true`. A package-specific entry replaces the global one rather than merging with it, so both keys are restated; `^build` is kept for the complete contract even though it currently resolves to nothing. No textual checker was added — the graph and a forced execution are the proof.

The failed workflow was **not** rerun and no workaround was applied; the new SHA triggered fresh workflows. **CI `33916225324`: success** — Lint/TypeCheck/Unit Tests, Migrations, Integration Tests and Browser Component Tests all green, with TypeCheck success and **Build (web)** — skipped in the failed Cycle 11 run — executing and succeeding on the forward-fix SHA. **Security `33916225300`: success** — `gitleaks`, `semgrep` and `osv-push` green; `osv-weekly`, `osv-weekly-release-train` and `notify-on-failure` skipped, which is their intended behaviour (`schedule`-only, and failure-triggered) and not a failure.

## N.9 Validation and mutations

Local gates, run cold after `rm -rf node_modules **/node_modules **/dist .turbo` and `pnpm install --frozen-lockfile`: `pnpm build` 6/6 · `pnpm typecheck` 11/11 · `pnpm typecheck:test` 9/9 · `pnpm lint` 7/7 with 0 errors (the 49 pre-existing web warnings are unchanged) · `pnpm lint:tools`, `pnpm typecheck:tools`, `pnpm typecheck:root` pass · `pnpm test` 10/10 tasks · `pnpm test:tools` 222/222 (218 before this cycle's four `PRISMA_GENERATED_TREE` fixtures; 215 before its three `DECLARATION_GRAPH_DEPENDENCIES` fixtures) · `pnpm check:drift` all five checkers ok · `pnpm test:module-contract` ok · integration against a real Postgres, 42 files, 532 passing and 1 expected failure · the exact CI web build command with its workflow environment, 6/6 · custom Semgrep rules at `--severity ERROR --error`, exit 0.

The three commit states were each checked out into a disposable worktree and `pnpm check:drift` run against all three; all three pass. Commit `47570be` was additionally typechecked on its own (`turbo run typecheck --filter=@luke/api --filter=@luke/web`, 6/6).

Mutations, each reverted after measurement:

| mutation | result |
| --- | --- |
| Remove `@prisma/client` from `apps/api` devDependencies | checker fires; `apps/api` tsc exit 0; `apps/web` 88 errors |
| Delete `src/generated`, compile | `TS2307` × 2 in `@luke/db`, × 10 in `@luke/nav` — loud, not degraded to `any` |
| Wipe `dist` + `src/generated`, warm cache replay | 87 generated + 360 dist restored, db typecheck green |
| Remove `src/generated/**` from `@luke/db#build` outputs, same replay | 0 generated / 360 dist, db typecheck red |
| Edit `schema.prisma` | build hash `3bbb664b…` → `71046e7a…`, and back on revert |
| Bait `new PrismaClient()` in `apps/api/src` | `luke-prisma-client-instantiation` fires — the rewritten exclude list is non-vacuous |
| Plant a stale file inside / above the generator output root | see §N.5 |
| Revert the `packages/db` build script | `PRISMA_GENERATED_TREE` fires on the real manifest |

Ordering proof for the fix, from `pnpm turbo run typecheck --force --output-logs=full` with every cache bypassed: `@luke/db:build` force-executed rather than hitting cache, regenerated the client ("Generated Prisma Client (7.10.0) to ./src/generated/prisma"), and completed before `@luke/db:typecheck` began; 11 tasks successful, 0 cached, exit 0. The resolved task definition reports `dependencies: ["@luke/db#build"]` where it previously reported `[]`.

Schema and migration parity: the 76 migration files and `migration_lock.toml` moved as **byte-identical renames** — `git diff --cached -M --numstat` reports `0 0` for 78 of the 80 renamed paths, the two exceptions being `schema.prisma` (+2 −1, the generator block) and `new-migration.sh` (+7 −3, the filter name and the `.env` path).

## N.10 Commit chain

Baseline `f963e2bf6859fbe99c48cd59dbc04b13fa702fe1`, linear, single-parent throughout:

| commit | subject | files |
| --- | --- | --- |
| `47570be0792f3eaa4ece6a475afdc4ca17a14d50` | `refactor(about): remove the dependency version panel` | 2 |
| `007c662964fbf540c8990046c935cfa8bfa0af7b` | `chore(db): move Prisma ownership and runtime packaging into @luke/db` | 251 |
| `2ce6b643326624712f3f0c1097b77d1bc6083bb8` | `docs: point the Prisma workflow at packages/db` | 8 |
| `e8512bf3a4239794712a5d93ee48c8e40b291aec` | `fix(build): order db typecheck after client generation` | 1 |

An earlier four-commit arrangement was rewritten **before** any push, because its first commit relocated the schema while leaving the API Dockerfile and entrypoint generating from the deleted path — not independently valid, and not bisectable. The replacement folds the runtime packaging and the three operational skill files into the same commit as the move, which is what lets all three states pass `check:drift`. The first three commits were pushed normally as a fast-forward; the fix is a forward commit on top of `2ce6b64`. **No pushed history was rewritten**, and no force push was used at any point.

## N.11 Honest residuals

- **A Turbo cache hit restores declared outputs but does not prune extra local files already sitting in an output directory.** With the build fixed, a stale file is removed on every cache miss and forced run; a warm hit replays over whatever is there. Bounded — a hit means the same input hash, so the build whose output is being replayed is the build that would have cleaned it — inherent to Turbo, and equally true of `dist`. Recorded, not closed.
- **The domain seed cannot run inside the runtime image.** `prisma/seed.ts` imports `../src/lib/configManager`, and `apps/api/src` is not shipped to the runner. This predates the cycle: `apps/api/prisma` was already copied without `src`. The boot proof seeded from the host instead. Not introduced here and not fixed here.
- **`@luke/db`'s generic CLI scripts source `../../apps/api/.env`.** A layer-0 package reaching upward on the filesystem to an application's bootstrap env. Deliberate — `DATABASE_URL` is deployment bootstrap under the Env Policy and there is one database, so there is one place it is declared — but it is not enforced by any checker.
- **A stale, gitignored `apps/web/tsconfig.tsbuildinfo` masked one mutation.** After restoring the removed declaration dependency, `apps/web` still reported 88 errors until that file was deleted. Anyone reproducing §N.4 by hand must clear it first.

None of the above is described as newly closed. `P1-05` and `P1/P2-08` remain open; the hygiene batch (`5.1`, `5.3` as narrowed in §M.1, `6.3`, the inert `tools/*` glob) and the `S-01` decision remain pending exactly as §M.14 records them.

## N.12 Final state and next work

`develop-2.2` and `origin/develop-2.2` both end at `e8512bf3a4239794712a5d93ee48c8e40b291aec`. The working tree and index were clean before this audit edit, and the three pre-existing stashes are untouched. Reflog and every superseded commit object remain reachable; nothing recoverable was deleted.

No tag was created, `pnpm release:prepare` did not run in any mode, no image was published, no Portainer or production action was taken, and no manifest version moved — every `package.json` still reads `2.1.4` (§K.13). `main` is unaffected; the whole cycle lives on the release-train branch.

Per the ordering in §A.4 and §M.14, the next architectural item is **`P1-05`**, the Prisma schema domain split, followed by `P1/P2-08`. Neither is started.

# Appendix O — Cycle 12 closure: Prisma multi-file domain schema (2026-09-05)

Supersedes **only** the time-sensitive statements in Appendix N (§N.1, §N.11, §N.12) that record `P1-05` as open, not started, or as the next architectural item. Everything else in Appendix N, and every section before it, stands as written.

## O.1 Disposition

**`P1-05`: DONE.** The 2,419-line single `packages/db/prisma/schema.prisma` is now a flat, coarse multi-file schema: a header file holding only `generator`/`datasource`, plus 8 domain files. The change is behavior-preserving and `SemVer` patch — no model, enum, field, relation, mapping, default, index, or database name changed, and no migration was produced. Prisma stays `7.10.0`, unchanged from the version N.1 recorded after the Cycle 11 generator migration. No new checker, orchestration mechanism, or CI job was introduced; the split is verified entirely through Prisma's own tooling (`validate`, `migrate diff`, `generate`) and the existing gates. Release and production state are unchanged — see §O.10.

## O.2 Architectural decision

The recommendation in this document's own §P1-05 (a 17-file granular split by sub-domain — `identity`, `platform`, `brand-season`, `dashboard`, `pricing`, `collection`, `nav-master`, `nav-pf`, `nav-kimo`, `company`, `calendar`, `notifications`, `locks`, `holidays`, `backup`, plus header and merchandising) was **independently investigated rather than adopted as written**. Three layouts were measured against the actual 79-model, 17-enum, 96-block schema, counting cross-file relation pairs out of the schema's 78 total relation pairs:

| design | files | cross-file relation pairs | notes |
| --- | ---: | ---: | --- |
| single file (baseline) | 1 (2,419 lines) | 0/78 | current state before this cycle |
| adopted coarse design | header + 8 domain files | 27/78 | committed; see §O.3 |
| medium design | 12 files | 38/78 | investigated, not adopted |
| granular audit design (this doc's §P1-05) | 17 files | 40/78 | investigated, not adopted; six files land under 100 lines |

The coarse design won on four grounds: it materially lowers per-edit context (a domain edit reads one ~200–500-line file, not 17 fragments); it avoids ownership fragments too small to be a meaningful unit (several of the granular design's 17 files fall under 100 lines — `dashboard.prisma`, `locks.prisma`, `pricing.prisma` among them); router/domain ownership is a more useful organizing principle for a coding agent than minimizing cross-file relations, since the schema's relation hubs (`User`, `Brand`, `Season`) make a meaningful share of cross-file relations unavoidable at any file count above one; and splitting further from the coarse to the granular design creates 13 additional cross-file relation pairs — 40 instead of 27 — at the cost of 9 more files and several sub-100-line fragments: more fragmentation, not fewer cross-file relations, and not enough ownership gain to justify it. `nav-analytics.prisma` alone — 499 relation-free lines, 18 models with no `@relation` to any other domain — removes nearly a fifth of the original file's bulk from the main editing surface with zero cross-file cost, which the granular design achieves too but at a finer, less useful grain (splitting it further into `nav-pf.prisma`/`nav-kimo.prisma` adds a file boundary with no ownership or relation benefit, since both halves are already relation-free and already share one sync-state model shape).

`platform.prisma` is recorded honestly as a coarse cross-cutting platform/operations group (`AppConfig`, `AuditLog`, `FileObject`, `DashboardConfig`, `DashboardTask`, `Notification`, `FeedbackSubmission`, `NotificationPreference`, `NotificationDedupKey`, `EditLock`, `SchedulerLock`, `BackupRecord`) — it does not correspond to one router family, and no future cycle should treat it as one without re-splitting it deliberately.

The schema files remain flat inside `packages/db/prisma/` rather than in a nested `prisma/schema/` subdirectory. The nested alternative was measured and rejected: it requires an explicit `migrations.path` entry in `prisma.config.ts`, and without it `prisma migrate status` silently reports no migrations found — a failure mode invisible until someone runs a migration command, not caught by `validate` or `generate`. The flat layout keeps the default `prisma/migrations` relationship Prisma assumes, so `PRISMA_DIR`, `PRISMA_MIGRATIONS_DIR`, the Docker copy step, and every existing operational path needed zero changes.

## O.3 Final schema layout

| file | lines | models | enums |
| --- | ---: | ---: | ---: |
| `schema.prisma` | 11 | 0 | 0 |
| `identity.prisma` | 185 | 6 | 3 |
| `platform.prisma` | 362 | 12 | 5 |
| `catalog.prisma` | 245 | 8 | 0 |
| `collection.prisma` | 347 | 10 | 0 |
| `merchandising.prisma` | 199 | 5 | 5 |
| `nav-analytics.prisma` | 499 | 18 | 0 |
| `company.prisma` | 123 | 5 | 1 |
| `calendar.prisma` | 448 | 15 | 3 |
| **total** | **2,419** | **79** | **17** |

`schema.prisma` now contains only `generator`/`datasource` configuration; `packages/db/prisma.config.ts` declares `schema: 'prisma'`, so the CLI reads the whole directory rather than a single file. The domain table above and the committed files make the full model/enum allocation unambiguous; it is not reproduced model-by-model here.

## O.4 Preservation and database parity

Measured against the committed tree: 96/96 enum and model blocks preserved byte-identically (verified by extracting each block's exact text from the baseline `11614f4` source and confirming its presence, unmodified, in its new file); 674/674 `///` documentation lines preserved; all 79 `@@map` attributes preserved. The implementation measured **30** plain standalone comment lines surviving the split (20 outside any model/enum block — section dividers, relocated with the section they head — plus 10 one-line in-block comments such as `// Relations`), one more than the investigation's recorded figure of 29; the discrepancy is unresolved but immaterial, because a full-file byte-perfect reconstruction of the original 2,419-line source from the extracted blocks and their leading comments — proven identical, byte for byte, before any file was written — is a strictly stronger guarantee than either line count.

All 76 migrations and `migration_lock.toml` remained untouched (`git diff` on `packages/db/prisma/migrations/` is empty at every point in the cycle, including in the final commit). `prisma migrate diff` from the baseline single-file schema to the new folder: **No difference detected**. `prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma`: **No difference detected**. All 76 migrations applied to an empty disposable database; a second `migrate deploy` reported no pending migrations. The resulting database has **81 tables** — 79 model tables, the implicit many-to-many join table `_VendorEnabledParameterSets`, and `_prisma_migrations` itself.

No claim is made that the final schema files are formatted. `prisma format` was run only against a disposable copy, never the real tree; `NavSyncFilter` retains the five pre-existing formatting/alignment differences noted before this cycle, because formatting stayed deliberately out of scope.

## O.5 Generated client and package contract

A clean `prisma generate` from the split schema produces **87 files**, the same count as from the pre-split baseline. The public generated export-name set — every exported declaration and re-export across the generated tree — was extracted independently from both a from-scratch baseline generation and the split-schema generation, run in the same package context: **7,527 names in both, an identical set, zero additions and zero removals**. The earlier figure of 7,525 recorded during the investigation is a measurement-method difference in how that count was produced, not a contract difference — the identical-set proof, not either absolute number, is the semantic guarantee. Of the 87 generated files, 34 differ between the baseline and split generations, and every difference inspected is a pure reordering — the same per-relation helper types (`BrandCreateWithout<Relation>Input` and siblings) or the same barrel-file model list, in a different sequence — never a new, removed, or reshaped type.

`@luke/db`, `@luke/nav`, `@luke/api`, and the complete repository typecheck all succeeded against the split schema's generated client. Generated-code ownership (`packages/db/src/generated/prisma`, gitignored, produced by `prisma generate`, compiled into `dist`), Turbo's declared build outputs, and the Docker packaging established in Cycle 11 did not change.

## O.6 Configuration and operational documentation

Two behavioral changes: `packages/db/prisma.config.ts` now declares `schema: 'prisma'`; the CI schema-drift step in `.github/workflows/ci.yml` now targets `--to-schema ./prisma` instead of the single file.

Every live agent- and human-facing instruction that named the single `schema.prisma` file now directs readers to the schema directory or its domain files: `CLAUDE.md` (the ORM section, the Rules-of-engagement file list, and the Prisma Migration Workflow section), `docs/prisma-migration-workflow.md`, `.claude/skills/luke-bugs/SKILL.md`, `.claude/skills/luke-docs/SKILL.md` (three spots), `.claude/skills/luke-docs/references/adr-rules.md`, `.claude/skills/luke-deps/references/platform-policy.md`, `.claude/skills/luke-audit/SKILL.md`, both root and API `README.md`, `packages/db/src/paths.ts`, `packages/db/scripts/new-migration.sh`, and `.gitignore`.

The migration rule itself was corrected mid-cycle, after review, to avoid contradicting Cycle 11's own generator-only change: **a physical datamodel change — a model, enum, field, relation, mapping, default, index, or constraint, in any `packages/db/prisma/*.prisma` file — requires a versioned migration; a change confined to `generator`/`datasource` configuration in `schema.prisma` does not, when an authoritative `prisma migrate diff` proves no physical schema difference** (the Cycle 11 generator switch is the worked example cited in both `CLAUDE.md` and the workflow doc). The live `FileObject` pointer in `apps/api/STORAGE_CONFIG.md` was corrected to `packages/db/prisma/platform.prisma`.

## O.7 Mutations and gates

Five mutations, each applied, its effect proven, then reverted byte-identically:

- Renaming the relation-bearing `collection.prisma` away: `prisma validate` fails with 9 errors, dangling type references from `catalog.prisma`, `calendar.prisma`, and `identity.prisma`.
- Renaming the relation-free `nav-analytics.prisma` away: `prisma validate` alone stays green (no cross-file relations to break), but `migrate diff` drift reports 18 removed tables, and — once the mutation is propagated through a full `@luke/db` build into `dist` — `@luke/nav` typecheck fails (`TS2339` × 3, `TS7006` × 1).
- Removing `schema: 'prisma'` from `prisma.config.ts`: Prisma silently falls back to reading only the 11-line header file and generates zero models.
- Breaking one cross-file relation (`CollectionLayout.brand` retyped against a nonexistent name instead of `catalog.prisma`'s `Brand`): `prisma validate` fails with exactly 1 error, at the correct line.
- Running the real CI drift command against the stale target `./prisma/schema.prisma` instead of `./prisma`: it reports all 17 enums and roughly 80 tables as removed, exit 2; the corrected target reports no difference, exit 0.

Final gates, all green, no invented counts: `prisma validate`; full-repo `build` 6/6; `typecheck` 11/11; `typecheck:test` 9/9; `typecheck:root`; `lint` 7/7 (0 errors, the same 49 pre-existing web warnings); `lint:tools`; `typecheck:tools`; `check:drift` (all 5 checkers); `test:module-contract`; `test:tools` 222/222; unit `test` 10/10; integration tests against disposable Postgres, 42 files, 532 passing and 1 expected failure; the exact CI `Build (web)` command with its workflow environment; Semgrep custom rules at `--severity ERROR --error`, 0 findings; `git diff --check`, clean.

Two pre-existing informational findings surfaced and are recorded as such, not as failures: the procedure-coverage gate flags `system.triggerCalendarDigest` as uninvoked — pre-existing: the procedure itself was explicitly left untouched during Cycle 11 (§N.7), and this finding was not introduced by Cycle 12; the advisory `mutation-requires-permission` Semgrep rule flags `setMenuCollapsibleStates`, a documented false-positive pattern under CLAUDE.md's RBAC note.

## O.8 Commit and remote evidence

Single atomic implementation commit `301b3c1083f25a86a4727cd086974d2519ec5ed1`, `refactor(db): split the Prisma schema into domain files`, parent `11614f472f6f3f06435538d94fcd44bdca2b18f8`, linear single-parent history. 25 paths — 17 modified, 8 added (the domain `.prisma` files) — 2,457 insertions, 2,439 deletions. Pushed normally to `origin/develop-2.2` as a fast-forward; no force, no rewritten remote history.

Remote CI, run `33924464524`: **success** — Lint/TypeCheck/Unit Tests, Migrations, Integration Tests, and Browser Component Tests all green; `Build (web)` executed (not skipped) and succeeded. Security, run `33924464375`: **success** — `gitleaks` and `semgrep` succeeded; `osv-push` succeeded at the step level, not merely at the masked job level; `osv-weekly`, `osv-weekly-release-train`, and `notify-on-failure` skipped, correctly, by their schedule-only and failure-only trigger conditions on a push event. The Migrations job (`101189828414`) applied all 76 migrations from an empty database and reported the schema drift check — `pnpm --filter @luke/db exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma --exit-code` — as **No difference detected**.

## O.9 Honest boundaries and residuals

- Prisma's directory schema loader recursively discovers every `.prisma` file below the configured folder, including a hypothetical stray file under `migrations/`; no producer in this repository creates one, and this is accepted rather than engineered around, per the item's own scope.
- Placing a model in the wrong domain file is a review convention, not a machine-enforced one; nothing currently fails a build over domain misplacement.
- Generated declaration ordering (barrel-file listing order, per-relation helper-type sequence) changes with the split even though the datamodel and export surface are unchanged — see §O.5.
- `check-skill-integrity.ts`'s tracked-path count moved from 177 to 173 because five literal single-file citations became glob references, which the checker does not resolve as literal paths; schema completeness is still covered by `validate`, `migrate diff`, `generate`, and the typecheck gates, not by that counter.
- `apps/api/STORAGE_CONFIG.md` still contains an adjacent historical reference to an `add_file_storage` migration that does not correspond to any migration in the current `packages/db/prisma/migrations/` tree. Only the `FileObject` schema pointer on the line above it was in scope for this cycle (§O.6); the `add_file_storage` reference is deferred to the separate documentation assessment, not fixed here.
- Pre-existing, untouched: the runtime-image seed residual and the stale Dockerignore exception recorded in Appendix N §N.11; `dev-bootstrap --skip-seed`; historical ADR schema citations, untouched (`docs/decisions/004` includes the stale line-number citation; `docs/decisions/011` contains a historical single-schema reference, not the line-number form); archived task documents and prior audit reports that mention `schema.prisma` in a historical, non-instructional sense.
- All three pre-existing stashes remain untouched throughout the cycle.

None of the above is described as newly closed by this cycle.

## O.10 Final state and next work

`develop-2.2` and `origin/develop-2.2` both end at `301b3c1083f25a86a4727cd086974d2519ec5ed1`. The working tree and index were clean before this audit edit. No tag was created, `pnpm release:prepare` did not run in any mode, no image was published, no deployment or Portainer action was taken, and no manifest version moved — every `package.json` still reads `2.1.4`. `main` is unaffected (`935dc29fa3c7edee656d75c5354c6e140584254d`, unrelated to this line of work).

Per the ordering in §A.4, §M.14, and Appendix N §N.12, the next architectural item is **`P1/P2-08`**. The §A.3 hygiene batch and the `S-01` branch-protection decision remain pending, exactly as recorded before this cycle. None of them has started.

# Appendix P — H1 closure: Web warning assessment and behavioral corrections (2026-09-05)

H1 is an intervening hygiene batch — a web `react-hooks` lint-warning reduction pass, plus three runtime defects the investigation surfaced along the way — not a numbered Cycle in the §A.4 architectural sequence, and it supersedes nothing recorded in Appendices A–O. `P1/P2-08` remains the next architectural item exactly as Appendix O §O.10 records it; this batch neither starts nor closes it. The `H2` hygiene items introduced alongside `H1` remain open; none of their scope was pulled forward here. No React Compiler activation was attempted at any point: the `react-hooks/*` rules exercised throughout this batch are the compiler's compatibility-oriented static checks, not the compiler itself, which stays disabled in this build exactly as before.

## P.1 Scope and disposition

H1 is complete. It is scoped entirely to `apps/web`: a set of `react-hooks/exhaustive-deps` warnings judged fixable without behavior change, plus three related runtime defects the same investigation surfaced (calendar date-serialization timezone shifts, collection-row drawer session-state leakage, Google OAuth callback re-entrancy). It touches no Prisma schema, no package boundary, no build/typecheck architecture, and no item in the `§A.4` execution sequence — `P1-05` stays closed exactly as Appendix O left it, and `P1/P2-08` stays open and unstarted, exactly as Appendix O §O.10 records it. The remaining `H2` hygiene items are untouched and still open.

## P.2 Warning baseline and final ratchet

| Rule | Before | After |
| --- | ---: | ---: |
| `react-hooks/exhaustive-deps` | 26 | 8 |
| `react-hooks/incompatible-library` | 16 | 16 |
| `@next/next/no-img-element` | 6 | 6 |
| `jsx-a11y/alt-text` | 1 | 0 |
| **Total** | **49** | **30** |

`apps/web/package.json`'s `lint` script moved from `eslint . --max-warnings 49` to `eslint . --max-warnings 30` — a hard reduction with zero headroom: the script fails the instant a 31st warning of any rule appears. No ESLint rule was disabled or weakened, and no rule's severity changed, to reach this number; every one of the 30 remaining warnings is the same rule, at the same severity, that flagged it before this cycle.

The 16 `react-hooks/incompatible-library` warnings are unchanged before and after. They fire because React Hook Form's `useForm()` returns a `watch()`/similar accessor the compatibility check cannot prove memoizable — a structural property of the library, not of any one call site. React Compiler is not enabled in this build (§P.1), so these warnings carry no live compiler-skip consequence today; rewriting sixteen working `react-hook-form` integrations to silence a warning from a compiler that is not running, with no measured performance or correctness benefit identified, was considered and rejected.

The six `@next/next/no-img-element` warnings are also unchanged. Each was examined individually: the flagged `<img>` elements render runtime-selected, authenticated, blob-URL, or storage-provider-delivered image content — for example the collection-layout picture panel's uploaded-photo preview — which `next/image`'s static optimization pipeline is not built to serve, and swapping the element without addressing that mismatch would trade a lint warning for a functional regression. They remain open findings, not silenced ones.

The one `jsx-a11y/alt-text` warning is closed (1 → 0); no residual of that rule remains.

The eight remaining `react-hooks/exhaustive-deps` warnings each carry an evidence-backed reason recorded directly in the flagged code, not hidden by a suppression comment. `SseProvider`'s exclusion of `getSseTicketMutation` is the case verified directly in this cycle: a fresh `useMutation()` result on every `isPending`/`data` transition would tear down and reopen the live `EventSource` connection on every ticket fetch if added, not fix anything. The remaining seven carry the same standard — an explicit lifecycle, identity-churn, or type-system reason inline, established across the review that produced this ratchet — with none left as a bare, unexplained warning. None of the eight is described here as an error, and none is evidence that the current production build is broken; each is an accepted, reviewed exclusion, which is what a justified `react-hooks/exhaustive-deps` omission is meant to look like.

## P.3 Behavioral corrections

- Calendar navigation (`useCalendarViewNavigation`, extracted from `calendar/page.tsx`) now serializes and parses the `?view=&date=` URL state through local civil-date components (`toLocalIsoDate`/`parseLocalIsoDate`) instead of `Date.prototype.toISOString()`/`new Date(dateOnlyString)`, eliminating the UTC day-shift that occurred at either UTC-offset sign depending on direction.
- The month view's holiday lookup (`CalendarEventMonthView`) and the planning-wizard event-timeline drag/date-input handling (`EventTimelineDrag`) were migrated to the same local-date semantics, but only where the UI represents a calendar day to the viewer — not as a repository-wide mechanical UTC-to-local rewrite. `EventTimelineDrag`'s `anchorDate`/`value` were traced to a real event instant (`new Date(event.startAt)`) before any change was made; the migration followed only after confirming the values reaching `holidayDates`/`closedDates` needed to match the viewer's local calendar day, not the instant's own UTC representation.
- Event instants remain instants. Nowhere in this batch was a genuine timestamp (an event's `startAt`/`endAt`, an OAuth code-exchange instant) reinterpreted as a calendar day; every migration in this appendix targets a value that is, or is derived for use as, a calendar day a user reads off a UI.
- Deterministic Chromium coverage for the timezone-sensitive fixes runs under two dedicated Playwright `timezoneId` instances, `Europe/Rome` and `America/Los_Angeles`, on every `pnpm test:browser` invocation — independent of whatever ambient timezone the host or CI runner happens to be in.
- LUKE's existing browser-timezone detection and profile-update flow was not touched by this batch; nothing in H1's scope reads or writes that mechanism.
- Collection-row drawer drafts and defaults (form fields, picture preview, quotations) are preserved across the reviewed session boundaries (a different row, a mode switch, a close/reopen of the same row) by extracting the form-reconciliation logic into `useRowDrawerForm` and giving `CollectionRowDrawer` an explicit `key={rowDrawerKey}`, bumped by a session counter in `page.tsx`'s `openRowDrawer` event handler — never during render — forcing a genuine remount with mount-time-correct state on every new session.
- Adding `defaultGroupId` to that session key was deliberately rejected and stays rejected: the UI cannot start a second create flow while the drawer is already open, and a late-arriving default during the same create session must keep merging into untouched fields, not erase them by forcing a spurious remount.
- The Google OAuth callback (`useGoogleOAuthCallback`, extracted from the settings page) is idempotent under re-render with fresh mutation/toast object identities, under a code arriving while a mutation is already pending, and under React's real `<StrictMode>` double-invocation — all four covered by browser tests against the real hook, the `<StrictMode>` case newly added in this batch and falsified by removing the guard.
- `window.history.replaceState` is stubbed (`beforeEach`/`afterEach`, never calling through) in every one of that test file's cases, so no test changes the real browser test-runner's own URL.
- The reviewed dialog effect dependency corrections (`BrandDialogWithPermissions`, `TemplateDialog`, `TemplateItemDialog`, `SeasonDialog`, `VendorDialog`, `MerchandisingRowDialog`).
- Two memoized fallback arrays that were depended on elsewhere without being memoized: calendar's `allBrands` and team listing's `allUsers`.
- Adding the missing `isDndMode` dependency to `CollectionGroupSection`'s existing filtered-row `useMemo` — the `useMemo` itself was pre-existing; `isDndMode` was the one dependency it lacked.
- `HeartbeatTicker`'s interval-effect dependency.
- The documented `SseProvider` identity exclusion (§P.2).
- Renaming the `lucide-react` icon import from `Image` to `ImageIcon` in the collection-layout picture panel, which removed the sole false-positive `jsx-a11y/alt-text` warning the name collision caused, while leaving the separate, intentionally retained raw `<img>` `@next/next/no-img-element` warning on the same panel unchanged.

## P.4 Evidence and honest boundaries

- Web browser tests: 100/100 — 84 under the normal `vitest.browser.config.mts` project, 16 under the dedicated `vitest.browser.timezone.config.mts` project's two timezone instances (`tz-europe-rome`, `tz-america-los_angeles`).
- Web Node tests: 80/80.
- Web lint: exactly 30 warnings, 0 errors, taxonomy per §P.2's table.
- Web `typecheck` and `typecheck:test` both green, the latter after adding `vitest.browser.timezone.config.mts` to `tsconfig.test.json`'s `include` — confirmed present in `tsc`'s own `--listFilesOnly` output before relying on the gate.
- Root `lint`/`typecheck`/`test`/`test:browser` Turbo gates green, and the natural (non-bypassed, no `--no-verify`) `.husky/pre-push` hook green at push time.
- The drawer's production `key={rowDrawerKey}` path was not mounted through a complete render of `page.tsx`: doing so would require mocking sixteen-plus tRPC procedures plus `useAppContext`/`usePermission`/`useSession`, judged a disproportionate harness against what remained to prove. The mount-time-correct value-building functions (`buildRowFormValues`, `initialPreviewPictureUrl`, `initialQuotations`) are directly tested and falsified; the two-line parent wiring (`openRowDrawer`'s counter bump, the `key` prop itself) and React's own key-remount guarantee were confirmed by direct code review, not by an executed end-to-end render. This gap is recorded, not papered over.
- The remaining `layout` `react-hooks/exhaustive-deps` suppression in collection-layout's deep-link effect was reproduced in a disposable `git worktree add --detach` off the reviewed baseline, removed afterward: replacing the scalar `layout?.id` dependency with the full `layout` value reproduces `TS2589: Type instantiation is excessively deep and possibly infinite` at that exact line, confirming the suppression's stated reason. No permanent checker was added for it.
- No claim survives, in code or in tests, that `vi.waitFor` proves temporal stability. The corrected comment in the Google OAuth test file states only the real guarantee: `vitest-browser-react`'s `act(async () => {...})` wrapping flushes pending effects before `render()`/`rerender()` resolves.
- Zero `TARGETED MUTATION` labels remain in any committed test file, confirmed by a whole-repository search; the falsification evidence those labels used to claim lives in the review record, not inside committed test-file documentation.

## P.5 Review process

`/simplify` ran against the implementation ahead of the correction round recorded here. A fresh, independent Opus `/code-review` pass then found three classes of defect this closure fixes: host-timezone-dependent test fixtures (UTC-anchored `new Date('YYYY-MM-DD')` literals that only failed under a negative UTC offset, never exercised under one); a missing `tsconfig.test.json` include for the new timezone-specific Vitest config, silently exempting it from `typecheck:test`; and the same local-vs-UTC calendar-day defect recurring, unfixed, in the month-view holiday lookup and the event-timeline drag/date-input handling — the same family of bug as the navigation fix, not yet applied there. Every finding was corrected and falsified — the fix temporarily reverted, the regression test confirmed to fail, then reverted back — before any commit was made. Findings without new runtime evidence behind them were not applied: the previously and independently rejected `defaultGroupId`-in-session-key change stayed rejected, and no ESLint suppression was strengthened or weakened on review say-so alone. The final committed tree, `fead94d0141cc0d442ee96e57bdae1dc3985a3ab`, was proven byte-identical to the reviewed staged tree before that tree was split into the four commits below.

## P.6 Commit and remote evidence

Four linear, single-parent commits on `develop-2.2`, parent baseline `e39a75eb93c6916b38531aa0287a619b25946660`:

```text
5ea96b8e48768480bc31ae1e9e25d0b53ccc62c9
  fix(calendar): preserve local dates across timezones

09f0485ec819daef8541f69241a555a11c3588fb
  fix(collection): preserve row drawer state across sessions

f71beaa243f9280b6608bc85465c7d3f3fdfbd2a
  fix(settings): make Google OAuth callback handling idempotent

07a03f6005435cfb392540cc7bcfe7c1da4f3b6c
  refactor(web): resolve actionable React hook warnings
```

The cumulative tree at the fourth commit, `fead94d0141cc0d442ee96e57bdae1dc3985a3ab`, is the same reviewed tree cited in §P.5: 34 changed paths, 1,617 insertions, 185 deletions. Pushed to `origin/develop-2.2` as a normal fast-forward — no force, and no commit was rewritten after the push.

Remote CI, run `33976670648`: **success** — all four jobs green (`Lint, TypeCheck & Unit Tests`, `Migrations`, `Integration Tests`, `Browser Component Tests`). Within the first job: `Lint` passed at exactly `eslint . --max-warnings 30` → `30 problems (0 errors, 30 warnings)`; `TypeCheck` and `TypeCheck (test)` both succeeded as their own steps; the `Browser component tests` step ran `pnpm test:browser`, confirmed in the raw job log to execute both `vitest run --config vitest.browser.config.mts` (the 7 normal browser test files, `*.timezone.browser.test.tsx` explicitly excluded from this project) and, chained after it, `vitest run --config vitest.browser.timezone.config.mts` (the 3 timezone-specific test files selected by that project, each run under both the `tz-europe-rome` and `tz-america-los_angeles` instances — 6 file executions, 16 tests); together the browser tier reported 100 tests: 84 normal plus 16 timezone-specific; `Build (web)` executed as a step in the same job and succeeded, not skipped.

Remote Security, run `33976670643`: **success** — `gitleaks`, `semgrep`, and `osv-push` all completed successfully as real jobs. `osv-weekly`, `osv-weekly-release-train`, and `notify-on-failure` show `skipped`, correctly: the first two are `schedule`-only triggers inert on a `push` event, and the third is conditioned on a failure that did not occur. None of the three skips represents a gap in coverage for this push.

## P.7 Final state

`develop-2.2` and `origin/develop-2.2` both end at `07a03f6005435cfb392540cc7bcfe7c1da4f3b6c`. The working tree and index were clean immediately after remote verification. All three pre-existing stashes remain untouched throughout. No manifest version moved — every `package.json` still reads `2.1.4`. No tag was created, `pnpm release:prepare` did not run in any mode, no image was published, and no deployment or Portainer action was taken. `main` is unaffected (`935dc29fa3c7edee656d75c5354c6e140584254d`, unchanged since Appendix O). `H2` remains open, and `P1/P2-08` has not started.
