---
name: luke-deps
description: >
  Technology and Platform Governor for the Luke monorepo. Owns the approved
  stack, the dependency graph, the toolchain and the supply chain: detects
  platform drift, assesses proposed technology changes, and applies upgrades
  through evidence-based verification — within-major bumps together, every
  major alone, each proven by the level of test that can actually catch its
  failure mode. Also covers advisory response, pnpm overrides review,
  deprecated package migrations and Node/pnpm/base-image lifecycle.
  Use for a platform health check, a periodic dependency review, before a
  release, or when osv-scanner reports an advisory.
  Modes: /luke-deps (review) | platform | apply | security | toolchain |
  evaluate. Optional filter: /luke-deps apply apps/api
argument-hint: '[platform|apply|security|toolchain|evaluate] [path|proposal]'
---

# Luke Platform Governor

**Own and maintain the approved Luke technology platform, dependency graph and
toolchain. Detect platform drift, assess technology changes, and apply upgrades
through evidence-based verification.**

Not merely a package updater. Two halves, and the split is the point:
**everything read-only runs first**, apply only ever executes a plan the user
has seen.

A dependency bump is the one change that alters behavior without altering a
diff you can read. Everything in this skill exists because of that: the
verification ladder, one-major-at-a-time, the risk table. Green types are not
evidence.

## Modes

| Mode                        | Does                                                  | Writes |
| --------------------------- | ----------------------------------------------------- | ------ |
| _(empty)_                   | dependency review + platform summary (§1–§6)          | no     |
| `platform`                  | platform integrity and architecture drift (§10)       | no     |
| `apply [path]`              | execute a reviewed plan (§7)                          | yes    |
| `security [path]`           | advisory-driven response (§9)                         | yes    |
| `toolchain`                 | Node / pnpm / base image / Actions lifecycle (§8)     | yes    |
| `evaluate <proposal>`       | technology decision assessment (§11)                  | no     |

**This skill is deliberately not forked.** `apply`, `security` and `toolchain`
run an approve-per-cycle loop with the user, and a forked context breaks it.
The fork/background contract in `tools/scripts/check-skill-integrity.ts`
therefore does not apply here.

**Read `.claude/skills/luke-shared/audit-protocol.md` first** and apply the
sections its applicability table assigns to `/luke-deps`: §3 escalation to a
deterministic rule, §4 `lessons.md` as a check input, §7 concurrent sessions.
§1 diff scoping does **not** apply — the input here is the registry and the
repository's own configuration, not the diff. A `$ARGUMENTS` path is a
workspace filter (`apps/api`, `packages/nav`), never a git range.

**Ownership**: `.claude/skills/luke-shared/governance-map.md`. This skill owns
platform, dependencies, toolchain and supply chain. It does not own application
architecture, runtime bugs or application exploits. When a platform finding
explains an application finding, hand it over — do not audit the application.

**Platform facts are read live**, from the authority table in
`.claude/skills/luke-deps/references/platform-policy.md`. Never copy a version
into a skill, a reference or `CLAUDE.md`.

---

## Ground rules

1. **One major per verification cycle.** Batching majors tells you something
   broke, not which one. `cd1613d` batched and shipped the `@fastify/multipart`
   regression; `308256f` had to bisect it back out by hand.
2. **The verification level must match the failure mode**, not the size of the
   diff. See §4 — this is the core of the skill.
3. **Never hand-edit `pnpm-lock.yaml`.** Change `package.json`, run pnpm, commit
   what it produces.
4. **Never `git commit`** — show the diff, propose the message, wait
   (CLAUDE.md rule 3). This skill produces commits' worth of work, never commits.
5. **Never revert with `git checkout` / `git restore`** on a file (protocol
   §7.4). To undo a bump: edit the version back and re-run pnpm.
6. **A hold is a deliverable.** A major you decided not to take is only useful
   if the reason and the unblock condition are written down (§7).

---

## 1 — Inventory

```bash
pnpm outdated -r                      # every workspace package
pnpm outdated -r --format json        # when you need to process it
pnpm install --frozen-lockfile 2>&1 | grep -i deprecat   # deprecations
pnpm security:deps                    # osv-scanner, advisories
```

Three things `pnpm outdated` will not tell you, and you must check by hand:

- **Deprecated-but-current packages.** A package can be on its latest version
  and still be abandoned. `06fb83b` migrated
  `@opentelemetry/instrumentation-fastify` → `@fastify/otel` for exactly this:
  never flagged as outdated, deprecated upstream.
- **The release-age quarantine.** Run `pnpm config get minimumReleaseAge`. If it
  is set, versions younger than that window are invisible to resolution, so
  "latest" in the report is not latest on the registry.
  `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` is the per-package
  exemption list — read it before concluding a package cannot be updated.
- **Overrides that outrank the bump.** Anything in the `overrides` block of
  `pnpm-workspace.yaml` wins over `pnpm update`. Cross-check every advisory
  finding against that block (§6).

Then read `lessons.md` (protocol §4) — its `## Dependencies` and
`## CI / Security Gates` sections are direct inputs here.

---

## 2 — Classify

Every outdated package lands in exactly one bucket. The bucket decides the
batching and the commit.

| Bucket             | What                                          | Batching                     | Commit                                                                    |
| ------------------ | --------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| **A** within-major | patch + minor                                 | all together, one cycle      | `chore(deps): bump dependencies within existing majors`                   |
| **B** major        | any major jump                                | **one at a time**            | `chore(deps): bump <pkg> N->M` (or one commit for a verified run of them) |
| **C** toolchain    | Node, pnpm, Docker base image, GitHub Actions | own cycle                    | `chore(infra): ...`                                                       |
| **D** advisory     | anything osv-scanner flags                    | jumps the queue              | `fix(deps): ...`                                                          |
| **E** deprecated   | replaced or abandoned upstream                | own cycle, it is a migration | `fix(<scope>): migrate ... to ...`                                        |
| **F** held         | not taken this round                          | no change                    | none — goes in the report                                                 |

Bucket A is not automatically safe: `@fastify/multipart` 10.0.0 → 10.1.1 was a
**patch-range** bump and broke uploads. A within-major bump on a package in the
risk table (§3) still gets that package's proof.

Code changes forced by a bump are **not** `chore(deps)` — they are
`fix(<scope>)` in their own commit (`d13d906` for argon2, `06fb83b` for otel).
That separation is what makes a bad bump revertable without losing the fix.

---

## 3 — Risk lookup

Before planning anything, look up every candidate in
`.claude/skills/luke-deps/references/verification-matrix.md`. It maps the
packages this repo actually depends on to **the invariant they can silently
break** and **the command that proves they did not**.

A package in that table is never verified by types alone. A package not in the
table gets levels 0–2 and, if it is a runtime dependency of `apps/api`, level 3.

---

## 4 — The verification ladder

| L   | Command                                                | Catches                                              |
| --- | ------------------------------------------------------ | ---------------------------------------------------- |
| 0   | `pnpm install`                                         | resolution failures, peer-range conflicts            |
| 1   | `pnpm lint` · `pnpm typecheck` · `pnpm typecheck:test` | changed API shape (argon2 `Options` → `HashOptions`) |
| 2   | `pnpm test`                                            | unit-visible regressions                             |
| 3   | `pnpm test:integration:local`                          | wire-level regressions (multipart teardown)          |
| 4   | targeted runtime proof (see the matrix)                | **same shape, different behavior**                   |
| 5   | `pnpm check:drift` · `pnpm security:deps`              | skill/doc drift, new advisories                      |

**Level 4 is the only level that catches the failures that matter most, and it
is the only one no CI job runs for you.** The fastify 5.12 `trustProxy`
regression passed levels 0–3 clean: numeric hop counts silently stopped being
honored, `req.ip` would have collapsed to the `apps/web` container address, and
the CRITICAL rate-limit bypass fixed on 2026-08-07 would have come back. The
types were identical. The unit tests were green. The rate-limit integration
suite was green too, because it stubbed `req.ip` on a fake context and never
went through fastify's own resolution.

Three rules follow from that:

- **Prove the behavior, not the compile.** `d13d906` verified argon2 with a real
  hash/verify round trip. `308256f` verified `p-limit` 7 ESM-under-CJS
  end-to-end, not just at import time. `06fb83b` verified the OTel SDK actually
  started and instrumented.
- **When a bump needs a new test, prove the test fails on the broken version.**
  Re-apply the bad version, watch it go red, then restore. A regression test
  written against already-fixed code proves nothing (`ec78c6f` did this).
- **Differential verification before blame.** A failure that appears after a
  bump is not necessarily from the bump. Reproduce it on the pre-bump tree
  first. During `c9a816e` the `apps/web` Docker build failed after the Node 24
  bump and failed identically on Node 22 — pre-existing, wrongly attributable,
  and correctly left out of scope.

**Before any level 3 run**: protocol §7.3 — if `pgrep -f vitest` finds another
session's run, wait or skip and say so. Never `pnpm test:db:down`.

**`pnpm-lock.yaml` and `node_modules` are shared the same way the test database
is.** Two sessions installing at once fight over one lockfile. Check
`pgrep -f "pnpm (install|update|add)"` before installing, and treat the lockfile
as a file you own for the duration (protocol §7.2 — append it to your ledger).

---

## 5 — Report (review mode ends here)

```
## Luke Dependency Review
Scope: <workspace filter or 'monorepo'>
Date: <today>
pnpm <version> · Node <version> · minimumReleaseAge: <value or unset>

### Summary
| Bucket | Count | Proposed cycles |
|---|---|---|
| A within-major | N | 1 |
| B major        | N | N |
| C toolchain    | N | 1 |
| D advisory     | N | ... |
| E deprecated   | N | ... |
| F held         | N | 0 |

### Plan
Cycle 1 — <bucket>: <packages, current -> target>
  Risk: <matrix hits, or 'none in table'>
  Verify: L0-L<n> + <targeted proof>
  Commit: <conventional commit subject>
Cycle 2 — ...

### Held
| Package | Current -> Latest | Why held | Unblocks when |
|---|---|---|---|

### Advisories
| ID | Package | Fixed in | Reachable? | Override needed |
|---|---|---|---|---|

### Version alignment
<output of the §6 check, or 'aligned'>

### Promotion to rule
<protocol §3 — mandatory>
```

Then stop. Review mode writes nothing. Ask whether to proceed with
`/luke-deps apply`.

---

## 6 — Pinning, overrides, alignment

**Carets do not protect you.** Reverting `@fastify/multipart` to `^10.0.0` still
resolved 10.1.1. A revert is an **exact pin plus a comment naming the version it
excludes and why** — otherwise the next install silently undoes it.

**Overrides are debt with an expiry date** (`lessons.md`). Pin a _range_, never
an exact version: an exact pin keeps forcing the vulnerable version even after
the patch ships, and `pnpm update` cannot outrank it — that is how
GHSA-mh99-v99m-4gvg stayed live behind a `brace-expansion` pin. Cap the range
when an uncapped one would drag transitive consumers onto a new major
(`fast-uri: '>=3.1.5 <4'` exists for exactly that). Every override carries a
comment with its GHSA id and its reason.

On every run, review the whole `overrides` block: an override whose upstream has
since published a clean version in the natural range is dead weight — propose
removing it, then confirm resolution with `pnpm why <pkg>`.

**Version alignment across the workspace is CLAUDE.md rule 9, and this skill
owns it** (`.claude/skills/luke-shared/governance-map.md` §2). It has no
automated gate yet. Run it:

```bash
jq -r '(.dependencies // {}) + (.devDependencies // {}) | to_entries[] | "\(.key)\t\(.value)"' \
  $(git ls-files '*package.json') | sort -u \
  | awk -F'\t' '{v[$1]=v[$1]" "$2; n[$1]++} END{for(p in n) if(n[p]>1) print p":"v[p]}' \
  | grep -v workspace
```

Empty output means aligned. Any line is a package carried at two versions —
fix it in the same cycle. The gate itself is the standing protocol §3 promotion
for this skill: a `tools/scripts` checker wired into `pnpm check:drift`, not a
lesson nobody runs. Until it exists, this command is the interim control and
`luke-audit` must not carry a second copy of it.

---

## 7 — Apply mode

Runs only on `/luke-deps apply`, and only against a plan from §5.

For each cycle, in plan order (D before everything else):

1. **Edit** the `package.json` files for this cycle only. Append every file you
   touch to your ledger (protocol §7.1), lockfile included.
2. `pnpm install` — read the output. Peer warnings are findings, not noise.
3. **Climb the ladder** to the level the matrix demands. Stop at the first
   failure.
4. **On failure**: decide, do not retry blindly.
   - upstream regression → revert to the last good version as an **exact pin**
     with a comment, and move the package to Held
   - intentional breaking change → the migration is its own `fix(<scope>)`
     commit, written and verified before the cycle closes
   - pre-existing failure → prove it with differential verification (§4), then
     say so and leave it out of scope
5. **Report the cycle** — packages, levels run, evidence, files changed — and
   propose the commit message. **Wait for approval.** Never commit.
6. Next cycle only after the previous one is committed or explicitly parked.
   Never leave two unverified cycles stacked in the working tree: that is the
   state that made `308256f` a bisection job.

A cycle that touches more than 3 files needs confirmation before it starts
(CLAUDE.md rule 2) — a majors cycle usually does not, a toolchain cycle always
does.

---

## 8 — Toolchain mode

`/luke-deps toolchain`. Node, pnpm, base images, GitHub Actions. These are
pinned in more places than a dependency is, and a missed pin does not fail — it
silently runs a different version somewhere.

**Node pin sites — all of them, every time:**

- `.nvmrc`
- `engines.node` in the root `package.json`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `.github/actions/setup-workspace/action.yml` — the composite action exists
  precisely so a Node bump is one edit instead of four; its header says so

**pnpm**: `corepack use pnpm@<version>` rewrites `packageManager` with the right
integrity hash. Do not hand-edit that string. Keep `engines.pnpm` consistent
with what the Dockerfiles and CI actually run.

Target the LTS lifecycle, not the newest number: Node 22 → 24 in `c9a816e`
happened because 22 moved to Maintenance and 24 became Active LTS.

**Do not run `docker build` locally as a validation step** — `lessons.md`
"Never build the Docker image locally", and the OOM noise it produced is the
reason. Verify base-image changes statically (image tag, `allowBuilds` and
`overrides` in `pnpm-workspace.yaml`, target arch in the release workflow) and
let `.github/workflows/release.yml` be the gate. If the user asks for a local
build anyway on a base-image major, that is their call — say what it can and
cannot prove.

**GitHub Actions** are already automated: `.github/dependabot.yml` groups them
monthly. Do not bump them by hand here unless a PR is stuck.

---

## 9 — Security mode

`/luke-deps security`. Advisory-driven only — the smallest change that clears
the finding.

1. `pnpm security:deps` (osv-scanner).
2. For each finding: is it a direct dependency or transitive? `pnpm why <pkg>`.
3. Direct → bump it. Transitive → an `overrides` range in `pnpm-workspace.yaml`
   with the GHSA id and reason in a comment (§6 rules apply).
4. Check the finding is not being _caused_ by an existing override.
5. Re-run `pnpm security:deps` to confirm it is gone — the exit code, not a
   reading of the diff.
6. Verify at the level the matrix demands. A security bump is still a bump:
   `603662a` was a hotfix, and it still needed proof.

Note the branch rule: `.github/dependabot.yml` targets the default branch only,
and a merged `develop-X.Y` is dead — never backport an advisory fix onto one
(`lessons.md`, "Branch management").

---

## 10 — Platform mode

`/luke-deps platform`. **Read-only.** Answers one question:

> Does the real repository still conform to the approved Luke platform
> architecture?

It is not a freshness check. It does not ask the registry what is newest unless
that is needed to resolve a specific finding — that is review mode. The two are
separate on purpose: a full audit should be able to ask whether the platform is
internally coherent without triggering an upgrade review.

**Order matters. Deterministic first, semantic second.**

1. Run the deterministic gate and report its exact output:

   ```bash
   pnpm check:drift
   ```

   Anything the checker already decides is not re-litigated in prose. A finding a
   script can make is a level-2 control; repeating it as an LLM observation
   downgrades it to level 4 (protocol §3).

2. Then, and only then, the semantic checks the checker cannot safely encode.
   Read `.claude/skills/luke-deps/references/platform-policy.md` and walk the
   authority table. For each row, read the live authority and ask whether the
   governance rule still holds:

   - is a pin site out of step with the others?
   - is a declared policy inert — configured but with no effect?
   - is an installed tool not actually wired into the config that would run it?
   - does a task-graph edge still correspond to a real artifact dependency?
   - is a lifecycle commitment (Node LTS, override expiry, held decision) overdue?
   - is a platform version duplicated as prose anywhere it can drift?

3. Where the local Claude Code build supports it, validate the agent runtime
   contract too:

   ```bash
   claude plugin validate .claude/skills
   ```

   Report it as unavailable rather than skipping it silently. Do not make CI
   depend on the Claude CLI — the repo does not install or pin it.

### Report

```
## Luke Platform Report
Date: <today>
Deterministic gate: <exact result of pnpm check:drift>

### Platform health
<HEALTHY | HEALTHY WITH KNOWN GAPS | ACTION REQUIRED | RELEASE BLOCKED>

### Findings
**[P0/P1/P2]** — <title>
Authority: <the file that holds the real fact>
Evidence: <what was read, and what it said>
Rule broken: <the governance rule from platform-policy.md>
Acceptance criterion: <how anyone confirms this is fixed>
Remediation cycle: <isolated cycle proposed — never bundled>

### Decisions required
<policy questions the repository has not answered; do not answer them here>

### Promotion to rule
<protocol §3 — which findings should become deterministic checks>
```

Then stop. `platform` proposes isolated remediation cycles; it never applies
them. A platform report that silently fixed things would remove the reviewable
boundary that keeps two high-blast-radius changes out of one diff.

---

## 11 — Evaluate mode

`/luke-deps evaluate <proposal>`. **Read-only.** For a technology decision, not
a version bump: Prisma → Drizzle, Fastify → Hono, Node → Bun, Next → something
else, a new build or lint or runtime technology, a major language-toolchain move.

A fashionable technology is not a reason to migrate. A migration needs a
specific measurable problem: a deployment or runtime requirement, a severe
measured bottleneck, a missing capability, an unacceptable maintenance cost, an
organizational constraint, or a security requirement.

Verdict is one of:

```
ADOPT   SPIKE   HOLD   REJECT
```

Every verdict carries:

- what the current choice does well — state the incumbent's advantage honestly;
- what the candidate would actually buy, in this repository's terms;
- migration blast radius: workspaces, generated code, tests, CI, deployment;
- ecosystem and tooling maturity, including the peer ranges that gate it;
- security implications;
- agent-engineering implications — does it make the architecture more or less
  visible to a coding agent?
- rollback path;
- the measurable criterion that would make the answer ADOPT;
- for HOLD, the unblock condition, recorded in `platform-policy.md` §4.

A hold without a written unblock condition is not a decision, it is a deferral
that gets re-argued from scratch next quarter.

---

## Hard rules

- NEVER commit. Show the diff, propose the message, wait for the go-ahead.
- NEVER batch two majors into one verification cycle.
- NEVER conclude "it works" from types plus unit tests for a package in the
  matrix. Level 4 or it did not happen.
- NEVER hand-edit `pnpm-lock.yaml`, and never `git checkout` a file to undo a
  bump (protocol §7.4).
- NEVER add a second library for a job an installed one already does
  (`lessons.md`, "Don't duplicate libraries for the same purpose").
- NEVER add an exact-version override. Range, capped, commented, with its GHSA id.
- NEVER drop a held package silently — reason and unblock condition, or it will
  be re-evaluated from scratch next quarter.
