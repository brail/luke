# LUKE Agent Engineering & Platform Governance Audit

**Branch reviewed:** `develop-2.2` (with selected checks against `main`)  
**Date:** 2026-08-30  
**Purpose:** redesign the governance of LUKE's Claude Code skills so that the system is explicit, deterministic, low-drift, and safe for agent-driven development; make `luke-deps` the owner of the technology/platform layer without creating a redundant `luke-infra` skill.
**Revision:** v3 — consolidated final pass across every LUKE skill, shared protocol, hooks, docs/ADR governance, testing, and orchestration contracts.

---

## 0. Executive decision

The current LUKE agent system is already unusually mature. Do **not** replace it with a new framework and do **not** create a parallel `luke-infra` skill.

The right move is to turn the existing collection of strong skills into a governed system with explicit ownership.

### Target operating model

- `CLAUDE.md` = **constitution**: short, stable, always-relevant rules and architectural facts.
- `luke-shared` = **governance protocol**: rules common to skills, control hierarchy, session/concurrency model, ownership map.
- `luke-deps` = **Technology & Platform Governor**: approved stack, dependency graph, runtime/toolchain, workspace/build/lint/type/ORM platform, CI/dependency supply-chain mechanics, upgrade/evaluation policy.
- `luke-audit` = **application architecture compliance** against the approved platform and project rules.
- `luke-bugs` = **runtime/logic failure detection**.
- `luke-security` = **application security** and exploitability; dependency advisories remain `luke-deps security`.
- `luke-test` = **QA control plane**: assess verification adequacy, generate/update tests when requested, and prove changed behavior.
- `luke-fix` = **controlled fix loop**.
- `luke-docs` = **documentation maintenance**, not technology governance.
- ESLint / Semgrep / deterministic scripts / CI / selected hooks = **enforcement plane**.

The core rule is:

> **A skill may discover or reason about a rule, but anything mechanically verifiable should ultimately be enforced by code.**

This is already the philosophy of `luke-shared/audit-protocol.md`; this refactor should finish the job rather than introduce a new philosophy.

---

# 1. What is already excellent and should be preserved

## 1.1 Shared control hierarchy

`.claude/skills/luke-shared/audit-protocol.md` has the right architecture:

1. impossible to get wrong via types/schema/constraints;
2. automatically blocked via ESLint/Semgrep/CI tests;
3. deterministically flagged via scripts/scanners;
4. LLM finding as the lowest control level.

The mandatory "Promotion to rule" step is one of the strongest parts of the repository. Preserve it.

## 1.2 `luke-deps` verification philosophy

`.claude/skills/luke-deps/SKILL.md` is much more than an updater. It already has:

- review-first/apply-second separation;
- one-major-per-verification-cycle;
- dependency risk classification;
- behavior-driven verification levels;
- explicit hold semantics;
- advisory/override handling;
- toolchain mode;
- concurrency awareness around lockfiles and test DB;
- lessons-driven verification.

The companion `references/verification-matrix.md` is especially strong because it maps dependencies to the **invariant they can silently break**, not merely to a generic test command.

This should become the foundation of the broader Platform Governor role.

## 1.3 Audit specialization

The split among:

- `luke-audit` — architectural drift;
- `luke-bugs` — realistic runtime bugs;
- `luke-security` — attack scenarios;

is conceptually correct. Do not merge them into one giant prompt.

## 1.4 Test skill

`luke-test` contains several high-value agent-engineering rules:

- tests selected by real failure mode;
- no green-with-zero-tests behavior;
- tests written against public surfaces;
- invariants instead of snapshotting implementation;
- a regression test must be proven red on the broken version.

Keep this specialization.

## 1.5 Existing deterministic drift infrastructure

`tools/scripts/check-skill-integrity.ts` and `check-docs-integrity.ts`, wired through `pnpm check:drift`, prove the repo already understands that agent instructions are production infrastructure.

The refactor should extend this mechanism, not build a second one.

---

# 2. Main architectural problem: ownership is currently blurred

The issue is not lack of rules. The issue is that the same class of fact is currently represented in multiple places with no single owner.

Examples:

- `CLAUDE.md` contains stack facts and stack constraints.
- `luke-audit` independently contains stack checks.
- `luke-deps` owns upgrade mechanics and some toolchain facts.
- CI encodes runtime/tool versions again.
- Dockerfiles encode them again.
- `pnpm-workspace.yaml` encodes supply-chain policy.
- lessons record historical infrastructure regressions.

This is survivable while one person remembers the system. It becomes dangerous with multiple coding agents because each agent reads a different subset and may treat whichever copy it sees as authoritative.

### The target ownership rule

**Stable architectural choice** may appear in `CLAUDE.md` because every coding session needs it.

Example:

- package manager = pnpm;
- ORM = Prisma;
- UI/API contract = tRPC;
- shared validation = Zod;
- web framework = Next.js;
- API runtime = Fastify/Node.

**Dynamic platform state or operating procedure** belongs to `luke-deps` and must be derived from live config where possible.

Examples:

- exact Next version;
- Node pin and lifecycle;
- pnpm exact version;
- Prisma family alignment;
- which version is held and why;
- override expiry;
- package-manager quarantine settings;
- which Docker base is current;
- whether the active ESLint config actually enables Next rules;
- compatibility between TypeScript and typescript-eslint;
- Turbo graph assumptions.

`CLAUDE.md` should not be a duplicate lockfile.

---

# 3. Evidence of real drift today

These are not hypothetical examples; they exist in the reviewed repository state.

## 3.1 `CLAUDE.md` says Next 15, the application runs Next 16.3.3

`CLAUDE.md` currently describes:

```text
apps/web/ → Next.js 15 + shadcn/ui
```

while `apps/web/package.json` contains:

```json
"next": "^16.3.3"
```

This is a textbook example of why exact platform versions must be derived from manifests rather than repeated in standing instructions.

**Classification:** governance drift, not application bug.

**Owner after refactor:** `luke-deps platform` detects it; `CLAUDE.md` is changed so the class of error cannot recur.

## 3.2 Security workflow comments describe a state that is no longer true

`security.yml` contains historical comments saying the workflow remains inert until it reaches `main` and that the file does not exist there.

The same `security.yml` is now present on `main`.

This demonstrates a second failure mode: comments can accurately document a past incident and then become false assertions about current infrastructure.

**Owner of runtime fact:** `luke-deps platform` / deterministic operational check.  
**Owner of comment quality:** `luke-docs` or normal code review.

Do not solve this by duplicating more prose.

## 3.3 Project language policy is not consistently applied to infrastructure files

`CLAUDE.md` declares English-only instruction files and English code comments.

Current examples include Italian comments/descriptions in:

- `.github/actions/setup-workspace/action.yml`;
- `.github/workflows/ci.yml`;
- `.github/workflows/security.yml`;
- `pnpm-workspace.yaml`;
- `tools/scripts/check-skill-integrity.ts`;
- `.claude/hooks/git-reminders.sh`.

This is a lower-severity issue than functional drift, but it proves the present audit surface is incomplete.

Do **not** mix a mass comment rewrite into the governance refactor. Record it as a separate cleanup cycle.

## 3.4 Password algorithm documentation is stale

`apps/api/prisma/schema.prisma` still documents `LocalCredential` as a Bcrypt credential while the current runtime stack uses `argon2` and `luke-deps` already has Argon2-specific behavior verification.

Verify the real password implementation before changing the comments, then make the wording either Argon2-specific or algorithm-neutral.

This is another example of why agent-facing comments are operational inputs, not decoration.

---

# 4. High-priority current infrastructure findings that `luke-deps` should own

These were found in the earlier platform audit and reconfirmed where relevant on `develop-2.2`.

They are **not all to be fixed in the governance refactor**. They should become the initial backlog that proves the new `/luke-deps platform` mode works.

## P0 — fail-open SAST command chain

Root `package.json` currently contains:

```json
"security:sast": "semgrep scan --config .semgrep/rules/mutation-requires-permission.yml; semgrep scan ..."
```

The first Semgrep invocation is separated by `;`, so its failure does not necessarily make the whole script fail if later commands succeed.

### Required remediation

Make the chain fail closed. Prefer a single reusable security script with shell strict mode if the same command set must remain synchronized among root scripts, CI and hooks.

Minimum acceptable fix: replace the fail-open separator and make intended blocking invocations explicitly blocking.

### Governance lesson

The SAST **plumbing** belongs to platform governance. Security finding semantics belong to `luke-security`.

---

## P1 — `luke-full` is not actually a full platform health check

`.claude/skills/luke-full/SKILL.md` currently orchestrates only:

1. `luke-audit`;
2. `luke-bugs`;
3. `luke-security`.

Dependency/platform health is omitted.

### Target

Add a fourth dimension:

```text
Platform & Toolchain → /luke-deps platform
Architecture         → /luke-audit
Runtime Bugs         → /luke-bugs
Security             → /luke-security
```

A full audit should **not** automatically perform a fresh package upgrade review. It should run the read-only platform integrity mode.

That distinction matters:

- `/luke-deps platform` = "is the approved platform internally healthy and coherent?"
- `/luke-deps` review = "what dependency/toolchain changes are available?"

---

## P1 — Claude Code fork execution semantics are implicit

Current Claude Code documentation states:

- `context: fork` runs a skill in an isolated subagent context;
- `background` applies to forked skills;
- current default is `background: true`;
- `background: false` explicitly waits for the result;
- backgrounded forked agents have a narrower tool set;
- backgrounded forked edits sit outside the invoking session's checkpoints.

Several LUKE skills use `context: fork` but do not specify `background`:

- `luke-audit`;
- `luke-bugs`;
- `luke-security`;
- `luke-full`;
- `luke-docs`.

At the same time, `luke-full` explicitly says "Run sequentially" and "Wait for completion".

### Target

Execution semantics should never depend on a Claude Code default that may evolve.

Recommended policy:

- every skill with `context: fork` MUST declare `background: true|false` explicitly;
- `luke-full`: `background: false`;
- `luke-docs`: `background: false` because it writes files;
- audit/bugs/security: use `background: false` if deterministic synchronous orchestration is more important than standalone background convenience; this is the recommended LUKE setting;
- add an integrity check that rejects a forked skill with omitted `background`.

This is a **runtime compatibility invariant**, not stylistic preference.

---

## P1 — read-only guarantee is weaker in `luke-full` than in its child audits

`luke-audit`, `luke-bugs`, and `luke-security` use the built-in `Explore` agent, which structurally limits write capability.

`luke-full` uses `agent: general-purpose` because it must orchestrate skills, but only says in prose "Do NOT modify any file".

### Target

Use Claude Code frontmatter tool restrictions to make the invariant structural where practical.

For `luke-full`, explicitly disallow write/edit tools while preserving the tools required to scope and invoke the child skills.

Do not rely only on prose for a read-only orchestrator.

Before implementing, verify exact tool names supported by the installed Claude Code version.

---

## P1 — no platform integrity gate exists

Root `check:drift` currently runs only:

```text
check-skill-integrity.ts
check-docs-integrity.ts
```

There is no equivalent `check-platform-integrity.ts`.

This is the largest structural gap relative to the desired `luke-deps` ownership model.

### Target

Add:

```text
tools/scripts/check-platform-integrity.ts
```

and expose:

```json
"check:platform": "tsx tools/scripts/check-platform-integrity.ts"
```

Then make:

```text
pnpm check:drift
```

include skill, docs, and platform integrity.

`/luke-deps platform` should begin by running the deterministic checker, then perform the semantic checks that cannot be encoded safely.

---

## P1 — workspace dependency version alignment is a prose rule, not a gate

`CLAUDE.md` and `luke-deps` both require dependency version alignment across workspace manifests.

`luke-deps` currently provides a shell command to inspect it, but root CI does not enforce it as a dedicated invariant.

### Target

Move the deterministic part into `check-platform-integrity.ts`.

Rules:

- ignore `workspace:*` internal links;
- compare repeated external dependency specifications across manifests;
- support explicit, documented exceptions only if genuinely required;
- prefer no exception mechanism until a real exception exists.

---

## P1 — pnpm release-age policy is internally inconsistent/inert

`pnpm-workspace.yaml` contains `minimumReleaseAgeExclude` but no `minimumReleaseAge`.

If the project intends a dependency quarantine window, it is not active. If no quarantine is intended, the exclusion list is misleading dead policy.

### Target

`luke-deps platform` must classify this as one of two deliberate states:

- quarantine enabled, with explicit duration and narrowly justified excludes; or
- quarantine disabled, with inert exclusions removed.

Do not silently choose the policy during the governance refactor. Report it and ask for/record the architectural decision.

---

## P1 — Next.js ESLint package is installed but not active in the flat config

`eslint-config-next` is installed at the root and in `apps/web`, but `eslint.config.mjs` does not import `eslint-config-next` or `@next/eslint-plugin-next`.

The current config therefore appears to omit the official Next/React/React-Hooks rule set despite carrying the dependency.

### Target

This becomes a `/luke-deps platform` finding and a later isolated infrastructure change.

Do not combine it with mass autofix or UI refactoring.

Verification must include a deliberately invalid bait case so "plugin failed to load and lint found nothing" cannot be mistaken for success.

---

## P1 — root TypeScript config is a web/Next config masquerading as a monorepo base

Root `tsconfig.json` contains:

- DOM libs;
- JSX preservation;
- `moduleResolution: bundler`;
- Next plugin;
- source path mapping directly into `packages/core/src`.

This is not a neutral shared TypeScript base for a repo that also contains Node/Fastify packages.

### Target direction

Later, in its own platform refactor:

```text
tsconfig.base.json       runtime-neutral strict defaults
apps/web/tsconfig.json   DOM + JSX + Bundler + Next plugin
apps/api/tsconfig.json   Node semantics
packages/*/tsconfig      package-specific Node/library semantics
```

Do not do this in the governance commit. `luke-deps platform` should own the plan and acceptance criteria.

---

## P1 — Prisma generator is on the legacy generator

`apps/api/prisma/schema.prisma` currently uses:

```prisma
generator client {
  provider = "prisma-client-js"
}
```

On the currently installed Prisma 7 line, the modern generator is `prisma-client`; migration requires explicit output/import/config work.

### Required sequencing

1. stabilize the governance layer;
2. migrate generator on the existing Prisma major;
3. update imports/build/config;
4. prove clean generation/build/tests/migrations;
5. only later consider a Prisma major.

Never combine generator migration with a Prisma major upgrade.

---

## P2 — Turbo graph cleanup

Current `turbo.json` has:

- `lint.dependsOn = ["^build"]`;
- `outputs` including both `dist/**` and `packages/core/dist/**`.

These deserve source-based validation:

- `lint -> ^build` may be unnecessary and slow;
- the package-specific output looks redundant because task outputs are package-relative and `dist/**` already covers package build output.

Do not delete either blindly. Verify why package exports/build artifacts are currently required.

---

## P2 — TypeScript 7 should be evaluated, not blindly adopted

TypeScript 7 is now a real platform decision, but LUKE uses tooling that depends on the TypeScript programmatic API, including `typescript-eslint` and `ts-morph`.

Treat TS7 as a `luke-deps evaluate` / toolchain spike, not as a normal dependency bump.

Possible outcome:

- stay on TS6 for now; or
- dual toolchain: TS7 CLI for type checking, TS6 for API-dependent tools.

Adopt only if the operational complexity is justified by measured benefit.

---

# 5. Target `luke-deps` contract

## 5.1 New mission statement

Recommended wording:

> **Own and maintain the approved LUKE technology platform, dependency graph and toolchain. Detect platform drift, assess technology changes, and apply upgrades through evidence-based verification.**

`luke-deps` is not merely a package updater.

## 5.2 Modes

Recommended interface:

```text
/luke-deps                          dependency review + platform summary, read-only
/luke-deps platform                 platform integrity and architecture drift, read-only
/luke-deps apply [path]             apply only an already-reviewed dependency plan
/luke-deps security [path]          dependency/supply-chain advisory response
/luke-deps toolchain                Node/pnpm/Docker/GitHub Actions lifecycle
/luke-deps evaluate <proposal>      technology/platform decision assessment, read-only
```

### `platform`

Answers:

> Does the real repository still conform to the approved LUKE platform architecture?

It does **not** ask registries for every latest package unless needed to resolve a finding.

### `evaluate`

This is where questions such as these belong:

- migrate Prisma → Drizzle?
- Fastify → Hono?
- Node → Bun?
- Next → TanStack Start?
- TS6 → TS7?
- adopt a new build/lint/runtime technology?

Output should be one of:

```text
ADOPT
SPIKE
HOLD
REJECT
```

with:

- current-state advantage;
- candidate advantage;
- migration blast radius;
- ecosystem/tooling maturity;
- security implications;
- agent-engineering implications;
- rollback path;
- measurable adoption criterion;
- unblock condition if held.

A fashionable technology is not a reason to migrate.

---

# 6. Files `luke-deps` should use as platform sources of truth

Do **not** create a JSON file that copies all exact versions from the manifests. That would become another drift source.

Create a concise reference that declares **authority and relationships**, not duplicated state.

Recommended new file:

```text
.claude/skills/luke-deps/references/platform-policy.md
```

It should contain an authority table similar to this:

| Platform fact | Live authority | Governance rule |
|---|---|---|
| Workspace packages | `pnpm-workspace.yaml` + workspace `package.json` files | no unmanaged workspace roots |
| pnpm exact tool | root `package.json#packageManager` | update with Corepack, never hand-edit integrity hash |
| Node compatibility | root `package.json#engines.node` | Active-LTS policy |
| Node execution pins | `.nvmrc`, Dockerfiles, setup-workspace action | matching approved major |
| Package versions | workspace manifests + `pnpm-lock.yaml` | family/alignment policy |
| Build graph | `turbo.json` | tasks reflect real artifact dependency |
| TypeScript | root/app/package tsconfigs | runtime boundaries explicit |
| Lint | `eslint.config.mjs` + `eslint-plugin-luke` | official framework lint + project policy both active |
| ORM | Prisma schema/config + Prisma package family | supported generator/config, migration agreement |
| DB runtime | Docker/compose/CI PostgreSQL pins | server/client compatibility explicit |
| CI | `.github/workflows/**` + local composite actions | fail closed; shared setup is authoritative |
| Supply chain | `pnpm-workspace.yaml`, Dependabot, OSV, overrides | no inert/expired policy |
| Agent runtime | `.claude/**` | frontmatter/runtime semantics explicit |

Versions should be **read from those files at run time**.

---

# 7. Target `luke-shared` governance model

Create:

```text
.claude/skills/luke-shared/governance-map.md
```

This file is not another checklist. It defines ownership boundaries.

Suggested matrix:

| Skill | Owns | Explicitly does NOT own | Writes? | Primary proof |
|---|---|---|---:|---|
| `luke-deps` | platform, deps, toolchain, package security | feature architecture, app exploits | review no / apply yes | platform checker + verification matrix |
| `luke-audit` | application architecture compliance | package freshness/toolchain lifecycle | no | source inspection + deterministic promotion |
| `luke-bugs` | runtime/logic bugs | style, version policy | no | reproducible scenario + regression test proposal |
| `luke-security` | exploitable app security | dependency freshness | no | attack scenario + security regression proof |
| `luke-test` | tests for changed behavior | application fixes | tests only | real test execution |
| `luke-fix` | controlled application remediation | uncontrolled batch fixing | yes after approval | re-audit |
| `luke-docs` | README/JSDoc/Prisma docs/ADRs | platform policy ownership | docs/comments only | docs integrity checker |
| `luke-full` | orchestration and synthesis | independent new checklist | no | child skill reports |

### Boundary rule

If two skills currently check the same invariant, one must be the **owner** and the other a **consumer**.

Example:

- package version alignment owner = `luke-deps`;
- `luke-audit` may mention a platform failure only by consuming the `luke-deps platform` result, not by maintaining a duplicate shell check.

---

# 8. Target `luke-full`

`luke-full` should be an orchestrator only.

Recommended order:

```text
0. /luke-deps platform
1. /luke-audit
2. /luke-bugs
3. /luke-security
4. synthesis
```

Do not put dependency freshness in the mandatory full audit.

### New summary table

```text
| Skill                 | CRITICAL | HIGH | MEDIUM | LOW | Status |
|-----------------------|----------|------|--------|-----|--------|
| /luke-deps platform   | ...      | ...  | ...    | ... | ...    |
| /luke-audit           | ...      | ...  | ...    | ... | ...    |
| /luke-bugs            | ...      | ...  | ...    | ... | ...    |
| /luke-security        | ...      | ...  | ...    | ... | ...    |
```

Do not force all four skills into the exact same severity vocabulary if their meanings differ; normalize only in the synthesis layer.

### Read-only enforcement

Because `luke-full` uses a general-purpose agent to orchestrate, add explicit write-tool restrictions where compatible with the installed Claude Code version.

### Execution mode

Make foreground/background behavior explicit; recommended `background: false` for deterministic synthesis.

---

# 9. Target `luke-audit`

`luke-audit` remains application architecture compliance.

### Remove/move to `luke-deps`

- dependency version mismatch;
- package-manager/tool version lifecycle;
- dependency family alignment;
- framework/tooling installation correctness that is purely platform state.

### Keep

- application code using forbidden raw SQL;
- AppConfig policy;
- auth/RBAC architecture;
- tRPC usage conventions;
- Zod ownership;
- storage/NAV boundaries;
- frontend component rules;
- transactional/audit/permission patterns.

### Consume platform policy

Read the stable platform policy/reference where a rule depends on an approved technology choice, instead of defining a second version of it.

### Reconciliation with the earlier `luke-audit` review

The earlier review was directionally correct, but the full skill-suite analysis changes **ownership**, not the need for the controls.

Keep the earlier conclusions that `luke-audit` must verify application-level architectural constraints, especially:

- package/domain boundaries as they affect application code;
- AppConfig usage and environment policy;
- auth/RBAC/section architecture;
- tRPC conventions and mutation protections;
- shared Zod/schema ownership;
- storage and NAV anti-corruption boundaries;
- frontend implementation rules;
- transactional, audit-log and permission invariants;
- promotion of recurring findings to deterministic ESLint/Semgrep/CI checks.

Reassign the earlier infrastructure-oriented checks to `luke-deps platform`:

- exact framework/tool versions and version drift;
- dependency-family alignment;
- Node/pnpm/Docker/GitHub Actions lifecycle;
- TypeScript/ESLint/Turbo/Prisma toolchain health;
- package-manager policy and release-age/supply-chain mechanics;
- mechanical correctness of CI/platform gates.

Do **not** delete these checks from the LUKE governance system. Delete only the duplicate ownership. `luke-audit` may consume a platform finding/result when it is relevant to an application finding, but it must not maintain a second platform checklist.

The earlier idea of broadening `luke-audit` into a general infrastructure/meta-audit is therefore intentionally rejected. That would create a God Audit and duplicate `luke-deps`, `luke-test`, and `luke-security`.

---

# 9A. Target `luke-test` — QA control plane for the monorepo

The initial testing analysis remains valid and must be part of the governance refactor. The current document originally preserved `luke-test` only at a high level; that was insufficient.

`luke-test` should become the monorepo's **QA control plane**: the authority that decides what deterministic evidence is sufficient for a change. It should not become a God Skill that blindly runs every suite.

## 9A.1 Current frontend QA gap

`apps/web/package.json` has `typecheck`, `test` and Playwright E2E scripts, but no `typecheck:test`. The root `pnpm typecheck:test` is a Turbo task, so a workspace that does not expose that script contributes no web-test typecheck evidence.

The current `apps/web/vitest.config.mts` is deliberately Node-only and restricted to `src/lib/**/*.test.ts`. Its own comment states that components and hooks are left to Playwright smoke tests. That creates a missing middle tier between pure unit tests and full application E2E.

Target evidence layers for `apps/web`:

```text
STATIC
  lint
  production typecheck
  test typecheck

BEHAVIOR
  Vitest Node unit — pure functions and mappings
  Vitest Browser component — React components/hooks in a real browser

SYSTEM
  Playwright E2E — critical full-application flows only
```

Do not add Jest or Cypress. Do not introduce jsdom as the default merely because a DOM tier is missing. With the current Vitest generation, official Vitest guidance recommends Browser Mode for component testing because it exercises a real DOM/browser API surface. LUKE already carries Playwright and has Radix/shadcn, portals, focus behavior and `dnd-kit`, all of which increase the value of a real-browser component tier.

Preferred initial stack, subject to a normal `luke-deps evaluate`/compatibility check before installation:

```text
@vitest/browser-playwright
vitest-browser-react
```

Keep the existing Playwright test runner for E2E. Vitest Browser Mode reuses Playwright as the browser provider but is a different testing tier.

## 9A.2 `typecheck:test` is a first-class gate

Add a web-specific test TypeScript configuration/script so test files, helpers, fixtures, custom browser types and mocks cannot drift independently of production code.

The exact config shape should be derived from the final Browser Mode layout, not copied from `apps/api`. Acceptance criterion: `pnpm typecheck:test` must deterministically include the web test corpus, and a deliberately invalid web test fixture must make the gate fail in an isolated proof.

## 9A.3 Risk-based verification selection

`luke-test` should ask:

> What evidence is required to prove this change correct?

not:

> Which test command can I run?

Minimum-evidence examples:

| Change | Expected evidence |
|---|---|
| Pure TS utility | production/test typecheck as applicable + unit |
| Zod/shared contract | typecheck + contract/unit invalid/valid cases |
| Interactive React component | test typecheck + browser component behavior |
| tRPC procedure | typecheck + unit/integration depending on DB/wire behavior |
| Prisma/data mutation | unit where meaningful + DB integration/rollback proof |
| Auth/rate-limit behavior | integration + selected system/runtime proof |
| Critical user flow | selected Playwright E2E |
| Bug fix | regression test proven red on broken behavior, then green on fix |

This matrix belongs in a `luke-test` reference file, not duplicated across application skills.

## 9A.4 QA GAP and residual risk

Add `QA GAP` as a first-class result. A missing verification tier is neither PASS nor SKIPPED.

Example:

```text
QA GAP — modified interactive business form has no component-level behavioral coverage.
Residual risk: MEDIUM
Verdict: PASS WITH QA GAP
```

Recommended final `luke-test` report:

```text
QA RESULT

Change scope
- apps/web
- packages/core

Risk
- UI behavior: HIGH
- shared contract: MEDIUM

Verification
✓ production typecheck
✓ test typecheck
✓ unit
✓ component
○ integration — not required
○ e2e — not required

Regression coverage
✓ ...

QA gaps
None

Residual risk
LOW

VERDICT: PASS
```

## 9A.5 Relationship with other skills

Preserve this operating chain:

```text
luke-full  -> finds systemic issues
luke-fix   -> changes application code after approval
luke-test  -> proves the resulting behavior
```

`luke-fix` should stop treating `typecheck`/lint alone as sufficient verification for behavior-bearing changes. It should hand verification requirements to `luke-test` or follow the same shared verification policy.

`luke-bugs` and `luke-security` may prescribe the required regression evidence in their findings, but `luke-test` owns how that evidence is implemented and executed.

`luke-deps` owns testing **toolchain selection/version compatibility**; `luke-test` owns testing **strategy and adequacy**.

## 9A.6 Anti-goals

- Do not make `luke-test` run the full monorepo suite after every local change.
- Do not duplicate test paths/helper signatures already discoverable from package/config files.
- Do not mock the entire LUKE provider stack by default; create the smallest harness needed by the component.
- Do not use E2E to enumerate component state combinations that a component test can prove faster.
- Do not weaken assertions, delete tests or modify application behavior merely to obtain green output.

---


# 9B. Target `luke-bugs` — runtime correctness, not a second security audit

The current `luke-bugs` is strong where it requires a plausible failure scenario and rejects style-only findings. Preserve that standard. Its main weakness is **scope overlap with `luke-security`**: the current frontend/auth section explicitly hunts IDOR, leaked internal errors, missing auth rate limiting and client-side secret usage, all of which are also systematic security checks in `luke-security`.

The target boundary should be:

- `luke-bugs` owns **runtime correctness**: races, stale state, N+1 behavior, null crashes, broken cleanup, error propagation, wrong async semantics, React state bugs and data-consistency failures;
- `luke-security` owns **systematic exploit discovery**: attacker-controlled access, privilege escalation, IDOR, token/session weakness, injection, rate limiting and sensitive-data exposure;
- a bug scan may still discover a security-impacting defect, but it should report it as a **security escalation**, not maintain a duplicate security checklist.

Recommended handoff shape:

```text
Security escalation: YES
Reason: <why the runtime bug creates an attacker primitive>
Suggested follow-up: /luke-security <same scope>
```

Do not remove security impact from bug reports. Remove only the duplicated **hunt**. This lowers context cost and prevents two skills from slowly developing different definitions of the same vulnerability.

### Heuristics are not invariants

Several current bug/audit checks should be classified explicitly as one of:

1. **Constraint** — violation is wrong by project decision and can be reported directly.
2. **Heuristic** — evidence that warrants inspection, not a finding by itself.
3. **Investigation trigger** — search pattern used to locate risky code; a concrete failure scenario is still required.

Examples:

- `array.forEach(async ...)` is close to a syntactic constraint and is promotable to ESLint/Semgrep.
- `findMany` inside a loop is an investigation trigger for N+1, not proof of unacceptable performance by itself.
- `findMany` without `select` is not automatically a sensitive-data bug unless the selected object can cross a trust boundary or leak into logs/output.

This classification should be shared by `luke-audit`, `luke-bugs` and `luke-security`. It prevents an agent from "fixing" harmless code simply because a grep pattern matched.

---

# 9C. Target `luke-fix` — remediation router plus proof, not generic fixer

`luke-fix` is conceptually good: one finding at a time, explicit user confirmation, no destructive git revert, and re-audit after each change. Preserve those properties.

There are four changes required.

## 9C.1 Fix the MEDIUM contradiction

The current skill builds a queue containing `MEDIUM` findings, while its hard rules say **never process MEDIUM or LOW findings automatically**. Those statements cannot both be true.

Target behavior:

- auto-queue: `CRITICAL`, then `HIGH` only;
- `MEDIUM` and `LOW`: show in the completion report, or let the user explicitly request one;
- never silently escalate a medium finding into an automatic edit.

## 9C.2 Route by owner

`luke-fix` must not become the write-path for every kind of finding returned by `luke-full`.

| Finding owner | Remediation owner |
|---|---|
| application architecture / runtime / app security | `luke-fix` |
| dependency/platform/toolchain | `luke-deps apply` / `luke-deps toolchain` |
| missing or inadequate tests | `luke-test` |
| README/JSDoc/ADR/index drift | `luke-docs` |

A synthesized `luke-full` finding therefore needs an `owner` field. `luke-fix full` may consume the synthesis, but it must **delegate instead of editing outside its authority**.

## 9C.3 Replace "minimal verification" with risk-adequate verification

The current skill contains `React hook? -> no automated check, note it for manual testing`. That becomes obsolete once the Browser component tier exists.

After an application-code fix:

1. run the narrow deterministic static gate required by the file/change;
2. re-run the originating audit against the affected scope;
3. invoke or follow `luke-test assess/verify` for behavior-bearing changes;
4. if `luke-test` reports a QA GAP, do not call the remediation fully proven.

A disappeared audit finding is **not equivalent to correct behavior**. Audit proves the prohibited pattern is gone; QA proves the replacement behaves correctly.

## 9C.4 Regression tests remain a separate write authority

`luke-fix` currently modifies application code and `luke-test` modifies tests. Keep this separation. After a bug/security fix, `luke-fix` can request `luke-test assess`; if a regression test is required, offer to invoke `luke-test` to write it rather than quietly editing tests itself.

Target chain:

```text
finding -> owner -> user approval -> remediation -> originating audit -> luke-test verification -> proven/QA GAP
```

---

# 9D. Target `luke-docs` — documentation governor with correct authority direction

`luke-docs` has excellent progressive-disclosure structure already: mode-specific reference files, marker-preserving writes, read-before-write, and deterministic marker/link checks in `check-docs-integrity.ts`. Preserve this design.

The final pass found three governance defects.

## 9D.1 No volatile platform facts in templates

`references/readme-templates.md` currently hardcodes `Next.js 15` in the `apps/web` README template even though `apps/web/package.json` is on Next 16.3.3. This is exactly the kind of semantic drift that path/symbol integrity checking cannot detect.

Templates must describe **where to derive a fact**, not contain the current fact:

```text
BAD:  {Next.js 15, App Router, shadcn/ui...}
GOOD: {Read Next.js major/version from apps/web/package.json; App Router and UI layer from current config/imports.}
```

The same rule applies to Node, pnpm, Prisma, React, Postgres image versions and every other volatile platform fact.

## 9D.2 An Accepted ADR outranks accidental code drift

The current ADR mode treats a contradiction between an `Accepted` ADR and the code as evidence that the **ADR may be stale**, and it is allowed to rewrite Status automatically. That gets the direction of authority wrong.

A contradiction has two possible explanations:

1. the architectural decision was intentionally superseded but the ADR was not updated;
2. the implementation drifted away from a still-valid decision.

A documentation agent cannot choose between them without a human decision.

Target behavior:

- ADR validation is read-only with respect to decision status by default;
- report `ADR/CODE CONFLICT` with evidence;
- user chooses one of: restore implementation, deprecate/supersede ADR, or accept a new ADR;
- only then may `luke-docs` update Status/index according to the explicit decision.

`Context`, `Decision`, and `Consequences` remain human-owned as today.

## 9D.3 Accepted ADRs become normative input to architecture audits

`CLAUDE.md` cannot carry every architectural rationale without becoming huge. Accepted ADRs are therefore part of the normative architecture, not merely documentation.

Target authority hierarchy:

```text
explicit current user decision
    > Accepted/Superseding ADR + stable CLAUDE constitution
    > executable manifests/config for observed technical facts
    > generated README/JSDoc descriptive material
    > historical lessons
```

This hierarchy is not a statement that prose beats executable reality. It distinguishes **normative decisions** from **observed facts**:

- package version? manifest wins;
- "we intentionally use single-instance process-local state"? accepted ADR is normative until superseded;
- code contradicts that ADR? report architectural drift rather than silently rewriting history.

`luke-audit` should load only the Accepted ADRs relevant to its scope (progressive disclosure), not every ADR on every diff.

## 9D.4 Extend deterministic docs integrity to ADR index completeness

`docs/decisions/013-asset-derivative-pipeline.md` exists and is Accepted, while the current generated `docs/decisions/README.md` index stops at ADR 012. The present docs checker verifies links and marker shape, but not that every tracked ADR is indexed.

Add deterministic checks for:

- every tracked `docs/decisions/NNN*.md` appears exactly once in the index;
- every index entry resolves to a tracked ADR;
- status extraction is parseable under the supported ADR formats;
- no duplicate ADR number.

Do not leave index completeness to an LLM-only generation pass.

---

# 9E. Target `luke-shared` — governance kernel, not only an audit protocol

The shared protocol is one of the strongest parts of the system. Its control hierarchy, baseline discipline, deterministic promotion and concurrency protections should remain.

Its role is now broader than the filename `audit-protocol.md` suggests. Avoid a disruptive rename solely for aesthetics, but add small shared references for cross-skill contracts rather than inflating every SKILL.md.

Recommended target:

```text
.claude/skills/luke-shared/
  audit-protocol.md          # existing scope/baseline/control/concurrency rules
  governance-map.md          # ownership and handoffs
  result-contract.md         # machine-friendly child/orchestrator result envelope
  authority-order.md         # normative decisions vs observed facts
```

## 9E.1 Standard result contract

`luke-full` and `luke-fix` currently need to parse prose emitted by other skills. Give every LUKE skill a small structured footer, for example:

```json
{
  "skill": "luke-bugs",
  "scope": ["apps/api/src/..."],
  "mode": "audit",
  "status": "findings",
  "owner": "luke-bugs",
  "counts": { "critical": 0, "high": 1, "medium": 2, "low": 0 },
  "blocked": false,
  "qaGap": false
}
```

The human report remains Markdown. The structured footer exists for composition and must contain no free-form evidence that would duplicate the report.

## 9E.2 Baseline suppressions need lifecycle

A baseline entry is an accepted exception, not a permanent disappearance mechanism. Extend its contract with a review mechanism such as `reviewBy` or an explicit ADR/reference for durable exceptions.

At minimum:

```json
{
  "key": "...",
  "reason": "...",
  "addedAt": "2026-08-30",
  "reviewBy": "2026-11-30",
  "decisionRef": "docs/decisions/NNN-....md"
}
```

Not every entry needs an expiry date, but an indefinite exception should point at a deliberate decision. This prevents a once-acceptable workaround from being suppressed forever after its reason disappears.

## 9E.3 `lessons.md` needs progressive disclosure as it grows

The current rule that every finding-producing skill reads all of `lessons.md` is acceptable at today's scale, but it creates a predictable context-cost problem. Keep the single log for now; add ownership/category metadata or a generated index so a future skill can load relevant sections plus globally critical lessons instead of the entire history.

Do **not** split the file prematurely. First make relevance discoverable.

---

# 9F. Target `luke-full` — health synthesis without pseudo-precision

The v2 target correctly adds `luke-deps platform`. The final pass adds two changes.

## 9F.1 Remove the 0-100 health score

The current `luke-full` computes a numeric score from LLM-generated finding counts. Even after baseline suppression, the number is not stable enough to deserve two-digit precision: it depends on model behavior, deduplication and how findings are grouped.

Replace the score with deterministic/reviewable states:

```text
RELEASE BLOCKED
ACTION REQUIRED
HEALTHY WITH KNOWN GAPS
HEALTHY
```

and show:

- blocker/high counts by child skill;
- deterministic gate failures;
- suppressed baseline count;
- QA GAP/residual risk;
- platform health status.

A numerical trend can be added later only if the underlying findings become predominantly machine-generated/deterministic.

## 9F.2 Add a read-only QA assessment mode

A full health check should be able to ask whether changed/high-risk areas have adequate verification **without writing tests**. Add to `luke-test`:

```text
/luke-test assess   # read-only: scope/risk/evidence/QA GAP
/luke-test write    # current behavior: create/update tests only
/luke-test verify   # execute the selected existing evidence, no writes
```

To preserve user expectations, the implementation may initially keep bare `/luke-test` as an alias for the current write behavior, but the long-term safer default is assessment-first.

Target full orchestration:

```text
0. luke-deps platform     read-only
1. luke-audit             read-only
2. luke-bugs              read-only
3. luke-security          read-only
4. luke-test assess       read-only
5. synthesis
```

`luke-full` must never invoke `luke-test write`.

---

# 9G. Checklist design rule — constraint vs heuristic vs investigation trigger

This is a system-wide correction surfaced by the final pass.

A skill checklist must mark each rule internally as one of:

| Class | Meaning | Can produce finding from pattern match alone? |
|---|---|---:|
| Constraint | project/ADR says this must/must not happen | yes, if evidence is unambiguous |
| Heuristic | often problematic; needs contextual proof | no |
| Investigation trigger | cheap search used to find risky code | no |

Two current examples show why this matters:

1. `luke-audit` says raw SQL is forbidden outside NAV, while `CLAUDE.md` contains deliberate exception classes (`SELECT 1`, application SQL requiring features Prisma cannot express, using `Prisma.sql`). The skill has made the source rule stricter than the source itself.
2. `CLAUDE.md` currently mandates an index on every FK and every filtered column, and `luke-audit` repeats that as a direct violation. This is an intentionally chosen project rule today, but it is technically over-broad enough to deserve architectural reconsideration: indexes should ultimately be justified by integrity/query/delete behavior and measured access patterns, not by a blanket grep. Until that project rule is explicitly changed, the audit must honor it; the **governance refactor should flag the rule itself for decision**, not silently reinterpret it.

General requirement: a specialized skill may summarize a normative rule, but may not silently make it stronger. When exceptions/conditions matter, reference the source or move the detailed rule into a single shared policy.

---

# 10. Target `luke-security` vs `luke-deps security`

The boundary should be explicit.

## `luke-security`

Owns:

- auth bypass;
- IDOR;
- session/token weakness;
- injection;
- rate-limiting design;
- sensitive-data exposure;
- exploitability of application logic.

## `luke-deps security`

Owns:

- OSV/advisories;
- direct/transitive vulnerable dependencies;
- override behavior;
- deprecated security-sensitive packages;
- package/tool supply-chain policy.

## Shared boundary

CI/security-gate **mechanical correctness** belongs to platform governance.

Example:

- "Semgrep command is fail-open" → `luke-deps platform`.
- "Semgrep lacks a rule for a recurring injection pattern" → `luke-security` proposes promotion.

---

# 11. Deterministic platform checker — required design

Create:

```text
tools/scripts/check-platform-integrity.ts
```

The first version should stay small and high-confidence. Do not encode subjective architecture as brittle regex.

## Phase-1 invariants to implement

### 11.1 Workspace version alignment

Detect repeated external packages with incompatible/different declared versions across tracked workspace manifests.

Ignore internal `workspace:*` links.

### 11.2 Node pin-site consistency

Check approved Node major across the pin sites that actually exist:

- `.nvmrc`;
- root `package.json` engine;
- `apps/api/Dockerfile`;
- `apps/web/Dockerfile`;
- `.github/actions/setup-workspace/action.yml`.

Do not require identical textual syntax; require semantically compatible approved major.

### 11.3 pnpm source consistency

- root `packageManager` exists and is exact;
- no npm/yarn lockfile is tracked;
- declared pnpm engine is compatible with the exact packageManager version.

### 11.4 Release-age coherence

If `minimumReleaseAgeExclude` exists while `minimumReleaseAge` is absent/zero, fail with an actionable message.

The user must then choose whether quarantine is enabled or the excludes are removed.

### 11.5 Required platform files

Verify the presence of the actual authority files named in `platform-policy.md`.

The existing skill-integrity script already shows the correct philosophy: a checker should operate on tracked repo state, not convenient local-only state.

### 11.6 Dependency family coherence

At minimum:

- Prisma family;
- tRPC family;
- React/react-dom/types family where relevant;
- OpenTelemetry family where compatibility requires it.

Do not assume every package in a family shares the same npm major; encode the real compatibility relationship rather than a simplistic "all strings equal" rule.

### 11.7 Fail-closed security runner

Prefer testing the **shared security runner** once it is centralized, rather than trying to parse arbitrary shell syntax forever.

If centralization is deferred, detect the known fail-open command pattern as a temporary guard.

---

# 12. Extend `check-skill-integrity.ts`

The current checker already verifies path/symbol drift and one agent-capability invariant.

Add only runtime semantics that are stable and mechanically testable.

## Required additions

### 12.1 Explicit fork background semantics

If a `SKILL.md` contains:

```yaml
context: fork
```

it must also contain explicit:

```yaml
background: true
```

or:

```yaml
background: false
```

No reliance on runtime default.

### 12.2 Fork must declare its agent

For LUKE project skills, a forked skill should explicitly declare `agent` so its permission/tool model is reviewable.

### 12.3 Read-only general-purpose orchestrators need structural restrictions

Where a skill declares itself read-only but uses `agent: general-purpose`, require an explicit write restriction or a documented exception.

Implement this only after confirming the exact frontmatter/tool names on the installed Claude Code release; avoid encoding a false parser.

### 12.4 Skill size budget

Official current Claude Code guidance recommends keeping `SKILL.md` under 500 lines and moving detailed material to supporting files.

Make >500 lines a warning or blocking rule only after checking current skill sizes and deciding whether exceptions are needed.

### 12.5 Optional local Claude validation

Current Claude Code exposes:

```text
claude plugin validate .claude/skills
```

on recent versions.

Use it in `/luke-deps platform` when available to validate real Claude frontmatter semantics.

Do **not** make CI depend on Claude CLI unless the repo deliberately installs/pins it there.

---


## 12.6 Validate the skill governance contract, not only paths and symbols

Extend skill integrity in small deterministic increments:

- required frontmatter fields for each skill class (read-only forked audit, orchestrator, writer);
- explicit foreground/background semantics on forked skills where supported;
- write-authority consistency: a skill that declares itself read-only must not describe direct file modification;
- every skill referenced by an orchestrator exists;
- every writer declares/consumes the concurrency section;
- no known volatile platform version is hardcoded in a generated documentation template;
- structured result footer/schema is present once the shared result contract is adopted.

Do not attempt to "understand" arbitrary prose with a brittle regex. Check only contracts whose syntax the project owns.

## 12.7 Test the checkers themselves

`check-skill-integrity.ts`, `check-docs-integrity.ts` and the new platform checker are release gates. Give them fixture/unit tests for both positive and negative cases, especially:

- zero-discovery must fail;
- broken path/symbol must fail;
- ignored local-only path must not create a clean-checkout failure;
- missing ADR index entry must fail;
- duplicate ADR number must fail;
- platform version-family mismatch must fail;
- malformed/partial skill result contract must fail once enforced.

A checker that has never been proven red is only assumed to block.

---

# 13. Hooks policy

Before adding more hooks, centralize reusable gates behind canonical root scripts. Hooks, CI and skills should call the same named verification commands rather than each maintaining a slightly different list. For example, choose a small vocabulary such as `verify:fast`, `verify:prepush`, `verify:ci` only if it reduces duplication; do not add aliases for their own sake.

The current `git-reminders.sh` says `pnpm typecheck + lint + test`, while the real pre-push/CI gates also include test typechecking and drift checks. A reminder that enumerates gates separately can itself drift. Prefer "run the canonical pre-push verification" or invoke the canonical script.


Current `.claude/settings.json` has one Bash `PreToolUse` hook pointing to `git-reminders.sh`.

That is fine as a reminder layer, but reminders are not enforcement.

Current Claude Code hooks provide deterministic pre-tool blocking and can deny an operation even when permission modes are permissive.

## Recommended LUKE hook philosophy

Use a hook only when all three conditions are true:

1. the event is local to a tool call;
2. the rule is cheap and deterministic;
3. blocking before execution is materially safer than catching it in CI.

Good candidates:

- prohibit destructive git restore/checkout patterns that would destroy another session's work;
- prohibit direct use of npm/yarn if desired;
- require user approval for a tightly defined destructive command family.

Bad candidates:

- architectural audits;
- dependency evaluation;
- security reasoning;
- "is this code good?";
- anything needing broad codebase context.

Those belong to skill/checker/test layers.

Do not add model-based hooks unless command hooks cannot express the rule; current Claude Code documentation explicitly positions command hooks as the production choice for deterministic enforcement.

---

# 14. `CLAUDE.md` target role

Do not gut `CLAUDE.md`. Regular feature agents still need stable project rules without invoking a skill.

## Keep in `CLAUDE.md`

- rules of engagement;
- English instruction/comment policy;
- stable monorepo topology;
- approved core technologies by name;
- project-wide non-negotiable architecture constraints;
- domain invariants needed during normal coding;
- auth/crypto protected areas;
- RBAC/storage/NAV/UI rules that every implementation agent must respect.

## Remove from `CLAUDE.md` or make non-versioned

- exact framework/tool versions;
- upgrade procedures;
- package lifecycle details;
- historical dependency incidents already captured in lessons/references;
- any command/check that has become a deterministic script and can be referenced instead.

### Example

Bad standing fact:

```text
apps/web → Next.js 15
```

Better:

```text
apps/web → Next.js + shadcn/ui frontend. Exact platform versions are derived from workspace manifests and governed by /luke-deps.
```

This keeps the architectural choice always visible without creating version drift.

---

# 15. `lessons.md` target role

The current archival policy is correct.

Keep `lessons.md` as **unpaid regression knowledge**: facts learned from real failures that are not yet completely machine-enforced.

Once a lesson becomes covered by a deterministic check:

- archive the full narrative;
- keep only the enforced pointer in active lessons;
- do not make every skill spend tokens rereading solved history.

### New governance principle

A new governance finding should not automatically become another paragraph in `lessons.md`.

First ask:

> Can this become a deterministic rule immediately?

If yes, implement the rule and archive/record the history without leaving a permanent prompt tax.

---

# 16. Infrastructure backlog that the new `luke-deps platform` should report

The first run of the new mode should be expected to identify or validate at least these classes:

| Finding | Initial priority | Apply in governance refactor? |
|---|---:|---:|
| root SAST fail-open separator | P0 | separate tiny fix; yes early |
| exact Next version drift in CLAUDE | P1 | yes, as governance cleanup |
| forked skill implicit background behavior | P1 | yes |
| `luke-full` omits platform health | P1 | yes |
| no platform integrity checker | P1 | yes |
| dependency alignment not CI-enforced | P1 | yes via checker |
| release-age excludes without release-age policy | P1 | no; surface decision |
| `eslint-config-next` installed but apparently inactive | P1 | no; separate cycle |
| root TS config not runtime-neutral | P1 | no; separate cycle |
| Prisma legacy generator | P1 | no; separate cycle |
| stale Bcrypt comments | P2 | separate docs/code-comment cycle |
| Italian comments in infra/instruction code | P2 | separate cleanup |
| Turbo graph/output cleanup | P2 | separate cycle |
| pnpm catalogs | P2 | evaluate later |
| TS7 | P2 | controlled spike only |
| Prisma schema multi-file | P2 | structural-only refactor later |

This table is a seed, not a hardcoded checklist. The new mode must inspect live state.

---

# 17. Recommended implementation sequence for Claude Code

This sequencing is important. Do not allow the agent to combine governance redesign with unrelated platform modernization.

## Cycle 0 — one-line/low-blast-radius safety fix

Fix the fail-open `security:sast` chain in isolation.

Verification:

- intentionally exercise the relevant failure behavior or inspect shell exit behavior;
- `pnpm security:sast` according to available local tooling;
- no unrelated package or workflow changes.

Suggested commit class:

```text
fix(security): make local SAST chain fail closed
```

Do not commit without user approval.

---

## Cycle 1 — define ownership, no platform behavior change

Expected files:

```text
.claude/skills/luke-shared/governance-map.md        NEW
.claude/skills/luke-deps/references/platform-policy.md  NEW
.claude/skills/luke-deps/SKILL.md                   MODIFY
.claude/skills/luke-shared/audit-protocol.md        SMALL MODIFY if needed
CLAUDE.md                                            SMALL MODIFY
```

Goals:

- `luke-deps` formally becomes Platform Governor;
- add `platform` and `evaluate` semantics;
- define ownership boundaries;
- remove exact dynamic version facts from `CLAUDE.md` where unnecessary;
- preserve existing dependency verification behavior.

No dependency bump. No TS/Prisma/ESLint/Turbo refactor.

Suggested commit class:

```text
chore(agent): define platform governance and skill ownership
```

---

## Cycle 2 — make Claude Code execution contracts explicit

Expected files:

```text
.claude/skills/luke-audit/SKILL.md
.claude/skills/luke-bugs/SKILL.md
.claude/skills/luke-security/SKILL.md
.claude/skills/luke-full/SKILL.md
.claude/skills/luke-docs/SKILL.md
tools/scripts/check-skill-integrity.ts
```

Goals:

- explicit `background` on every fork;
- `luke-full` truly synchronous/deterministic;
- read-only orchestrator write restrictions if supported;
- platform phase added to `luke-full`;
- integrity checker protects those semantics.

Do not change audit checklists beyond ownership deduplication.

Suggested commit class:

```text
chore(agent): harden skill execution contracts
```

---

## Cycle 3 — add platform drift gate

Expected files:

```text
tools/scripts/check-platform-integrity.ts           NEW
package.json                                         MODIFY
possibly tools/scripts/lib/*                         SMALL SUPPORTING CHANGES
```

Implement only high-confidence deterministic invariants from Section 11.

Wire:

```text
pnpm check:platform
pnpm check:drift
```

Verification must prove the checker can fail, not only that the clean repo passes.

Preferred proof: fixture/unit-level negative cases or safe temporary copies — do not corrupt the live working tree merely to create bait.

Suggested commit class:

```text
chore(infra): add deterministic platform drift gate
```

---

## Cycle 4 — deduplicate audit ownership

Expected files:

```text
.claude/skills/luke-audit/SKILL.md
.claude/skills/luke-full/SKILL.md
possibly luke-shared/governance-map.md
```

Remove dependency/toolchain checks whose owner is now `luke-deps`.

Verify `luke-full --full` still reports all four health dimensions exactly once.

Suggested commit class:

```text
refactor(agent): remove cross-skill governance overlap
```

---

## Cycle 4A — upgrade `luke-test` and close the frontend QA architecture gap

This is logically independent from platform governance and should be its own reviewed cycle.

Expected governance files:

```text
.claude/skills/luke-test/SKILL.md                     MODIFY
.claude/skills/luke-test/references/verification-matrix.md  NEW
possibly .claude/skills/luke-shared/governance-map.md SMALL UPDATE
```

Expected test-platform files in a subsequent isolated implementation commit:

```text
apps/web/package.json
apps/web/vitest.config.mts or dedicated Vitest project config
apps/web/tsconfig.test.json (or equivalent explicit test config)
package.json / turbo.json only if required for named gates
CI workflow only if browser component tests need their own job
```

Goals:

- make `luke-test` the QA control plane rather than only a test writer;
- add risk-based evidence selection, `QA GAP`, residual-risk reporting;
- add `apps/web` test typechecking;
- introduce a real-browser component tier with Vitest Browser Mode after dependency compatibility review;
- preserve Playwright E2E as the system-flow tier;
- keep Node Vitest for pure web logic;
- prove each new gate can fail.

Do not combine this cycle with unrelated UI refactors or mass test generation. Start with a small representative tranche of high-value component/hook tests.

Suggested commit split:

```text
refactor(agent): make luke-test the monorepo QA control plane
test(web): add typed browser component test tier
```

---


## Cycle 4B — close the remaining skill-contract defects

After ownership and QA architecture are stable, update the specialized skills in one focused governance cycle:

1. `luke-bugs`: remove duplicated systematic security hunt; add security-escalation handoff.
2. `luke-fix`: resolve MEDIUM contradiction; add owner-based routing; replace manual React verification with `luke-test assess/verify` where applicable.
3. `luke-docs`: remove hardcoded stack versions from templates; make ADR conflict reporting assessment-first; add explicit user decision before status mutation.
4. `luke-full`: remove numeric health score; consume structured child results; add `luke-test assess` when available.
5. `luke-shared`: add ownership/result/authority references without duplicating skill-specific checklists.
6. `check-docs-integrity.ts`: enforce ADR index completeness/duplicates.
7. Add negative fixture tests for the deterministic governance checkers.

Do not mix this cycle with package/framework upgrades.

Acceptance proof:

- intentionally omitted ADR index entry -> deterministic failure;
- platform/skill/docs checkers each have at least one negative test;
- a synthetic `MEDIUM` finding is not auto-edited by `luke-fix`;
- a platform-owned finding consumed from `luke-full` is routed to `luke-deps`, not edited by `luke-fix`;
- an interactive React change can be classified by `luke-test assess` without writing a file.

---

## Cycle 5 — run the new governor, do not auto-fix its report

Run:

```text
/luke-deps platform
```

Then produce a platform report with:

- deterministic checker output;
- semantic findings;
- P0/P1/P2 classification;
- source-of-truth evidence;
- acceptance criteria;
- proposed isolated remediation cycles.

**Stop here and show the report to the user.**

This is the moment to decide which infrastructure changes to execute.

---

# 18. Platform remediation sequence after governance is stable

Unless new findings change priority, use this order:

1. SAST fail-closed plumbing if not already fixed.
2. Activate/repair official Next ESLint integration without mass autofix.
3. Decide pnpm release-age quarantine policy.
4. Split neutral TypeScript base from web/node configs.
5. Review package export/source-alias boundaries.
6. Migrate Prisma generator on Prisma 7 only.
7. Split Prisma schema by domain with zero logical migration diff.
8. Clean Turbo task/output graph after proving actual dependency needs.
9. Evaluate pnpm Catalogs/version centralization.
10. Hold TypeScript 6 during the governance/platform refactors; at TypeScript 7.1 RC perform a compatibility assessment, and migrate cleanly to TypeScript 7.1 stable only if the ecosystem gate passes. Do not introduce a TS6/TS7 bridge by default.

No two high-blast-radius items in one cycle.

---

# 19. Acceptance criteria for the governance refactor

The governance work is complete only when all of the following are true.

## Ownership

- `luke-bugs` no longer maintains a duplicate systematic application-security checklist; security-impacting bug findings have an explicit handoff.
- `luke-fix` routes platform/dependency/docs/test remediation to the owning skill instead of editing across domains.
- Accepted ADRs are treated as normative architectural decisions until explicitly superseded; code/ADR conflicts are not auto-resolved by `luke-docs`.

- every major governance domain has exactly one owning skill;
- no dependency/toolchain invariant is independently specified in both `luke-audit` and `luke-deps`;
- `luke-full` synthesizes rather than inventing a fourth checklist.

## Runtime semantics

- every forked skill declares foreground/background explicitly;
- the orchestrator's read-only nature is structurally enforced where supported;
- Explore skills that depend on project-specific rules explicitly read the source they need, because Explore/Plan fork agents do not automatically receive `CLAUDE.md`.

## QA governance

- `luke-test` exposes or has a planned read-only assessment path distinct from test-writing behavior.
- `luke-full` never invokes a test-writing mode.
- `luke-fix` cannot call a behavior-bearing fix proven merely because lint/typecheck passed.
- `apps/web` component behavior has a defined Browser-mode tier and its test corpus is covered by `typecheck:test`.

- `luke-test` is explicitly the QA control plane, not merely a test-file generator;
- `apps/web` has a deterministic `typecheck:test` path;
- pure web unit tests and browser component tests are distinct tiers;
- Playwright E2E remains reserved for full-system/critical-flow evidence;
- `QA GAP` and residual risk are first-class report outputs;
- a bug fix cannot be declared proven without regression evidence appropriate to its failure mode;
- test/toolchain version compatibility remains owned by `luke-deps`, while test adequacy remains owned by `luke-test`.

## Drift

- generated documentation templates contain no stale concrete platform versions where the value can be derived from manifests;
- every tracked ADR is indexed exactly once and duplicate ADR numbers fail deterministically;
- skill/checker contracts have negative tests proving their gates can go red.

- `pnpm check:platform` exists;
- `pnpm check:drift` includes platform integrity;
- platform checker has at least one proven negative case;
- version alignment is deterministic;
- Node/tool pin relationship is deterministic;
- release-age configuration cannot silently be half-configured.

## Context cost

- no giant new platform handbook is pasted into every session;
- stable facts remain in `CLAUDE.md`;
- procedures/details live in skill references;
- exact versions are read live rather than duplicated in prose;
- `SKILL.md` files remain concise, moving details to references when useful.

## Safety

- no governance cycle performs an unrequested stack migration;
- no dependency major is bundled into governance work;
- no Prisma generator migration is bundled with a Prisma major;
- no mass autofix is bundled with lint configuration;
- no agent commits without explicit user approval.

---

# 20. Claude Code-specific validation notes

The target design is consistent with current Claude Code documentation checked on 2026-08-30.

Key current runtime facts to account for:

1. Skill bodies load when invoked; supporting files can be kept separate and loaded only when needed.
2. Claude recommends keeping `SKILL.md` concise and moving large references out of it.
3. `context: fork` creates an isolated subagent context.
4. `agent` defines the forked execution environment.
5. Built-in Explore and Plan fork agents skip automatic `CLAUDE.md` loading; project-specific skills must read what they need explicitly.
6. Forked skills support explicit `background`; current default is background execution.
7. Background forked agents have narrower tools; background edits are outside the invoking session's checkpoints.
8. `disallowed-tools` can structurally remove tools while a skill is active.
9. Hooks are the deterministic mechanism for tool-event enforcement; command hooks are preferred for production deterministic controls.
10. Recent Claude Code versions can validate skill metadata with `claude plugin validate .claude/skills`.

Official docs consulted:

- Claude Code Docs — Extend Claude with skills: `https://code.claude.com/docs/en/skills`
- Claude Code Docs — Create custom subagents: `https://code.claude.com/docs/en/sub-agents`
- Claude Code Docs — Automate actions with hooks: `https://code.claude.com/docs/en/hooks-guide`

Before encoding version-specific Claude Code behavior into a blocking checker, verify the installed local `claude --version` and the corresponding docs/behavior.

---

# 21. Explicit anti-goals

Claude must **not** do any of the following while implementing this report:

- create a separate `luke-infra` skill;
- replace the existing shared audit protocol;
- merge audit/bugs/security into one mega-skill;
- create a second file containing copied exact dependency versions;
- migrate Next/Fastify/Prisma/tRPC simply because alternatives exist;
- upgrade dependencies while refactoring skill governance;
- adopt TypeScript 7 without a compatibility spike;
- migrate Prisma generator and Prisma major together;
- split Prisma schema while redesigning models;
- change lint configuration and mass-autofix the application in the same cycle;
- move every rule into a hook;
- use model-based hooks for rules a command/script can express;
- add broad exception lists to make new checkers green;
- weaken a checker because CI exposes a real drift;
- edit files owned by another live Claude Code session;
- use destructive git restore/checkout to undo its own edits;
- commit without explicit approval.

---

# 22. Execution brief for Claude Code

The following is the instruction block to give Claude Code together with this report.

```text
You are refactoring LUKE's agent-engineering governance, not the application stack.

Read this audit completely before editing anything.

Primary objective:
Make luke-deps the Technology & Platform Governor of LUKE while preserving the existing specialized audit/test/fix skills and the shared control hierarchy.

Non-negotiable design:
- CLAUDE.md is the short constitution for stable always-relevant facts.
- luke-shared owns cross-skill governance and control hierarchy.
- luke-deps owns platform/dependencies/toolchain/supply-chain mechanics and technology evaluation.
- luke-audit owns application architecture compliance.
- luke-bugs owns runtime/logic bug discovery.
- luke-security owns application exploitability; dependency advisories belong to luke-deps security.
- luke-test is the QA control plane: assess evidence adequacy, write/update tests only in its write mode, and verify behavior.
- luke-fix owns controlled application remediation and delegates platform/docs/test remediation to the owning skill.
- luke-docs owns documentation; it must report ADR/code conflicts rather than deciding unilaterally whether an Accepted ADR or the implementation is wrong.
- luke-full only orchestrates and synthesizes; it never invokes a write mode.

Do not create luke-infra.
Do not perform framework/library migrations during this governance refactor.
Do not upgrade dependencies during this governance refactor.
Do not commit without explicit approval.

Work in the implementation cycles specified in Section 17.
Treat each cycle as an independently reviewable diff.
Before each cycle, list the files you intend to modify and the approach, honoring CLAUDE.md confirmation rules.
After each cycle, run only the verification appropriate to that cycle and show the exact results.
Do not start the next cycle until the current cycle is clean and the user has accepted/committed or explicitly parked it.

First, re-read the live versions of every file named in the audit. The audit is a design specification, but the repository is the final authority for current file contents.

Important Claude Code runtime requirement:
Inspect the installed Claude Code version before changing fork/background/tool frontmatter. Current upstream documentation says context: fork defaults to background execution; the repository must not rely on an implicit default. Confirm the installed runtime, then encode explicit semantics and protect them in check-skill-integrity.ts.

Platform policy must not duplicate exact dependency versions. It should declare approved technologies, source-of-truth locations, lifecycle policy and invariant relationships. Exact current versions are read from manifests/config/lockfiles.

The first /luke-deps platform implementation must be read-only. It should run the deterministic platform checker first, then perform only the semantic checks that cannot safely be encoded in the checker.

When a new finding is mechanically expressible, promote it to the highest deterministic control practical instead of adding permanent prose.

Before editing specialized skills, apply the final ownership corrections from Sections 9B-9G: remove the duplicated systematic security hunt from luke-bugs; resolve luke-fix's MEDIUM contradiction and route findings by owner; remove volatile stack versions from luke-docs templates; make ADR/code conflicts assessment-first; distinguish constraints from heuristics/investigation triggers; and adopt the shared structured result contract.

At the end of the governance refactor, prove at least one negative fixture for each new/extended deterministic governance checker, then run:
- pnpm check:drift
- pnpm lint
- pnpm typecheck
- pnpm typecheck:test
- pnpm test
- claude plugin validate .claude/skills if supported by the installed Claude Code version

Then run /luke-deps platform and STOP after producing its remediation plan. Do not automatically apply the platform findings.

Report:
1. cycles completed;
2. files changed per cycle;
3. deterministic controls added;
4. ownership overlap removed;
5. exact verification results;
6. remaining platform findings, prioritized;
7. proposed commit message for each uncommitted cycle.
```

---

# 23. Final assessment

### Current state

The LUKE agent system is not a toy collection of prompts. It already behaves like an early internal engineering control system.

Its strongest ideas are:

- specialized audit domains;
- evidence-oriented tests;
- dependency behavior verification;
- lesson escalation;
- drift scripts;
- concurrent-session awareness.

### Main weakness

The remaining risk is no longer lack of good prompts; it is **governance ambiguity between strong prompts**: duplicated ownership, prose facts that can drift, orchestration that parses unconstrained reports, and a few checklist heuristics expressed as absolutes. The v3 target closes those seams without turning the system into one God Skill.


The system has grown organically enough that **ownership and live source-of-truth boundaries have not caught up with its sophistication**.

That is why good rules can still drift across `CLAUDE.md`, skills, comments, manifests and workflows.

### Target state

The target also includes a governed QA layer: `luke-test` selects and reports sufficient evidence across static checks, Node unit tests, real-browser component tests, integration tests and E2E, with explicit QA gaps rather than silent omissions.


After this refactor:

- `luke-deps` becomes the explicit governor of the real technical platform;
- `luke-full` becomes genuinely full;
- the skill runtime contract no longer depends on implicit Claude Code defaults;
- platform drift becomes a blocking deterministic concept alongside docs/skill drift;
- exact versions live in real manifests instead of prompt prose;
- future stack decisions are evaluated consistently instead of being rediscovered in chat;
- every agent knows which skill owns which decision.

That is the point at which LUKE's agent system moves from **good prompts around a codebase** to **a governed engineering operating system for an agent-developed codebase**.


---

# Appendix A — Closure disposition (2026-08-31)

Reconciled against `develop-2.2` at `12cb8e0`. The audit body above is preserved as written on 2026-08-30 and is deliberately **not** edited retroactively to describe the final state. This appendix records what became of each item.

## A.1 Verdict

**GOVERNANCE AUDIT V3: CLOSED WITH FOLLOW-UPS**

Every item §16 marks *"apply in governance refactor = yes"* is complete. Every §19 acceptance criterion is met. Items §16 marks *"no; separate cycle"* are carried forward in A.4 and were outside this audit's closure boundary by its own design.

## A.2 Disposition summary

| Section | Item | Disposition |
|---|---|---|
| 3.1 | CLAUDE.md version drift | DONE — `CLAUDE.md:39`, rationale at `:47` (`6006368`) |
| 3.2 | `security.yml` false comments | OPEN FOLLOW-UP — `:51,:64` contradict `:5` |
| 3.3 | Italian infra comments | OPEN FOLLOW-UP — deferred by the audit itself |
| 3.4 | Bcrypt docs stale | OPEN FOLLOW-UP — `schema.prisma:134,139` |
| 4 | **P0** SAST fail-open | DONE — `package.json:41` (`dbe02ef`) |
| 4 | `luke-full` omits platform health | DONE — Phase 0 (`2b8a917`) |
| 4 | fork execution semantics implicit | DONE — `fork-declares-background` (`69df6ee`) |
| 4 | orchestrator read-only guarantee | DONE — `disallowed-tools` + checker rule |
| 4 | no platform integrity gate | DONE — `check-platform-integrity.ts` (`cb14810`) |
| 4 | alignment is prose, not a gate | DONE — `checkVersionAlignment:300` |
| 4 | release-age policy inert | DONE — 4320 + strict; decision recorded |
| 4 | `eslint-config-next` inactive | OPEN FOLLOW-UP — §16 "separate cycle" |
| 4 | root tsconfig not runtime-neutral | OPEN FOLLOW-UP — §16 "separate cycle" |
| 4 | Prisma legacy generator | OPEN FOLLOW-UP — §16 "separate cycle" |
| 4 | Turbo graph cleanup | OPEN FOLLOW-UP |
| 4 | TypeScript 7 | DONE — HOLD recorded, `platform-policy.md:96` |
| 5–10 | target skill contracts | DONE — `6006368`, `7a6fcdb`, `bf1fe13`, `c41c9a4` |
| 11.1–11.4, 11.6–11.7 | platform invariants | DONE |
| 11.5 | required platform files | ALREADY RESOLVED — enforced by skill-integrity path validation |
| 12.1–12.3, 12.6 | execution contracts | DONE |
| 12.4 | skill size budget | NEEDS DECISION — largest is 495 of 500 |
| 12.5 | `claude plugin validate` | NOT REPRODUCIBLE — expects a plugin manifest this repo deliberately lacks |
| **12.7** | **checker self-tests** | **DONE — `12cb8e0`** |
| 13 | hooks / drifting reminder | OPEN FOLLOW-UP — `git-reminders.sh:12` |
| 14 | CLAUDE.md target role | DONE |
| 15 | lessons.md role | ALREADY RESOLVED |
| 17 | Cycles 0–5 | DONE |

## A.3 Closure evidence for §12.7 / §19

Two commits carry the final closure:

- **`34af653`** — `fix(agent): bind invocation arguments explicitly in scoped skills`. Scoped skills now bind invocation arguments explicitly before any scope derivation, and `luke-full` carries the canonical selector across the skill boundary unchanged. Verified by a clean `/luke-full --full`: explicit scope recognized immediately, no confirmation prompt, no default-diff fallback, and no child falling to default scope and being retried.
- **`12cb8e0`** — `test(agent): add regression fixtures for skill integrity checker`. Permanent negative regression fixtures for `check-skill-integrity.ts`, the last release-gate checker without them.

All three release-gate checkers now carry permanent fixture suites — `check-docs-integrity.test.ts`, `check-platform-integrity.test.ts`, `check-skill-integrity.test.ts` — with `pnpm test:tools` at 46/46.

The skill checker's permanent negative cases: fork without `background`; fork without `agent`; read-only skill missing all direct write-tool exclusions; read-only skill missing one of them; absent frontmatter; unterminated frontmatter. Positive cases are asserted at equal weight, so an over-broad gate is caught as readily as a missing one.

Proven non-vacuous rather than assumed: neutering the background rule turned exactly one test red and left the other twelve green, after which the rule was restored byte-identical. This replaces the transient one-time mutation proofs of Cycle 2, which demonstrated the gates could fail on the day they were written but left no permanent artifact — the gap §12.7 names when it says a checker never proven red is only assumed to block.

Residual coverage, recorded rather than claimed closed: zero-discovery and path/symbol resolution remain untested for this checker. Both live in `main()` and would require a materialized repository, as the platform suite uses.

## A.4 Post-v3 follow-ups

Outside this audit's closure boundary. None of these reopens the governance refactor.

**Separate cycles named by §16.** `eslint-config-next` activation — the highest-leverage of these, since `react-hooks/exhaustive-deps` mechanically catches the defect class later confirmed in `useWizardLock`; root tsconfig neutrality; Prisma generator migration; Turbo graph cleanup; Bcrypt comment staleness; Italian infrastructure comments; pnpm catalogs; Prisma schema multi-file.

**Surfaced during execution.** `security.yml` stale main-comment; `git-reminders.sh` drifting gate enumeration; `luke-deps` §6 prose claiming no automated alignment gate exists while `checkVersionAlignment` does; Explore/fan-out checker fail-open — known enforcement gap, intentionally not remediated or covered by this closure cycle; baseline entry expiry; skill size budget at 495 of 500; zero-discovery and path/symbol fixture coverage.

**Human decisions.** ADRs 006–009 status; CLAUDE.md rule 8 breadth.

**Frozen application findings, not governance: SEC-A CONFIRMED CRITICAL — release-blocking; BUG-B CONFIRMED MEDIUM — open remediation backlog.**

## A.5 Post-v3 — agentic control-plane evolution

This section records direction, not scheduled work. It exists so the next cycle does not re-derive these principles from scratch.

**Layer roles.** Skills are versioned governance contracts — reviewable, diffable, owned. Agents and models are reasoning and execution workers; they are never a source of authority. Deterministic scripts, tests and CI remain the only enforcement. A finding that can be mechanically verified should be promoted out of the semantic layer whenever the promotion is genuinely deterministic — that is the standing direction of travel, and §3's control hierarchy already names it.

**The observed reproducibility ceiling.** Two `/luke-full --full` runs, on an identical tree, minutes apart, produced materially different results: `luke-bugs` reported CRITICAL 0 then CRITICAL 1; `luke-deps` reported P1 1 then P1 4; `luke-test` reported 7 QA gaps then 5. Scope was correct and identical in both runs. This is not a scoping defect and not a failure of any single skill — it is the reproducibility ceiling of LLM-derived semantic findings.

The operative consequence: **absence of a finding is not evidence of absence.** A clean run does not retire a previously confirmed finding.

**Persistence of adjudication.** `luke-full` today synthesizes ephemeral prose; every run re-derives from zero, so an adjudicated disposition can be silently replaced by a later stochastic re-derivation. The direction is for confirmed and adjudicated findings to persist across runs in structured run state, with one rule governing reopening: **a subsequent run may reopen an adjudicated finding only on explicit new evidence, not on a differing re-derivation.** The `status` field in `result-contract.md` is the seed of this; a finding ledger is its natural extension.

**Model diversity is for independence, not voting.** Running a review under a different model is useful because it re-derives from the code rather than inheriting a prior conclusion — which is how three successive architectural hypotheses were falsified during the Cycle 5A argument-binding investigation. It is not a quorum mechanism. Findings are settled by repository evidence and human adjudication, never by agreement between models.
