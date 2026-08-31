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
