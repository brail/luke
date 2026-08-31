# Luke governance map — who owns what

Companion to `.claude/skills/luke-shared/audit-protocol.md`. The protocol says
_how_ a skill works; this file says _which skill decides_.

Read it when a finding could plausibly belong to two skills, when adding a check
to a skill, or when an orchestrator has to route a finding to a remediator.

## Why it exists

The problem was never a shortage of rules. It was that the same class of fact
lived in several places with no owner: `CLAUDE.md` carried stack facts,
`luke-audit` carried stack checks, `luke-deps` carried upgrade mechanics, CI and
the Dockerfiles carried tool versions again. One person holding the whole system
in their head can survive that. Several agents cannot: each reads a different
subset and treats whichever copy it saw as authoritative.

`CLAUDE.md` said `Next.js 15` while `apps/web/package.json` was on 16. Nothing
was broken and nothing was lying — the fact simply had no owner, so both copies
were equally believable.

---

## 1. Ownership

| Skill            | Owns                                                                                  | Explicitly does NOT own                                | Writes?              | Primary proof                                    |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------- | ------------------------------------------------ |
| `luke-deps`      | platform, dependency graph, toolchain, supply chain, technology evaluation             | feature architecture, application exploits             | review no / apply yes | platform checker + verification matrix           |
| `luke-audit`     | application architecture compliance with `CLAUDE.md` and Accepted ADRs                 | package freshness, toolchain lifecycle                 | no                   | source inspection + promotion to a deterministic rule |
| `luke-bugs`      | runtime and logic correctness                                                          | style, version policy, systematic exploit hunting      | no                   | reproducible scenario + regression test proposal |
| `luke-security`  | exploitable application security                                                       | dependency freshness and advisories                    | no                   | attack scenario + security regression proof      |
| `luke-test`      | verification adequacy: which evidence a change needs, whether it exists, what it proved | application fixes, test-toolchain versions             | `write` mode only    | real test execution + QA GAP reporting           |
| `luke-fix`       | controlled application remediation                                                     | platform, docs and test remediation                    | yes, after approval  | re-audit + `luke-test` verification              |
| `luke-docs`      | README, JSDoc, Prisma field docs, ADR index                                            | architectural decisions, platform policy               | docs and comments only | docs integrity checker                         |
| `luke-full`      | orchestration and synthesis                                                            | any checklist of its own                               | no                   | child skill reports                              |

## 2. The boundary rule

**If two skills check the same invariant, one is the owner and the other is a
consumer.**

A consumer may _report_ the owner's finding when it is relevant to its own — it
may not maintain a second copy of the check. A second copy is not redundancy: it
is two definitions that drift apart, each maintained as though the other were
authoritative. That is the same failure the audit-log allowlist produced when a
second filter was stacked in front of the first "for safety" (`lessons.md`).

Worked example: **workspace dependency version alignment**.

- owner: `luke-deps`, via `.claude/skills/luke-deps/references/platform-policy.md`
  and the platform checker;
- consumer: `luke-audit` may cite a platform failure that explains an application
  finding, but must not carry its own alignment scan.

## 3. Where a finding goes

| Finding                                                     | Owner           |
| ----------------------------------------------------------- | --------------- |
| exact framework/tool version, version drift, family skew    | `luke-deps`     |
| Node / pnpm / Docker base / GitHub Actions lifecycle        | `luke-deps`     |
| TypeScript / ESLint / Turbo / Prisma toolchain health       | `luke-deps`     |
| package-manager policy, release-age, overrides, advisories  | `luke-deps`     |
| mechanical correctness of a CI or security gate             | `luke-deps`     |
| application code violating `CLAUDE.md` or an Accepted ADR   | `luke-audit`    |
| race, stale state, N+1, null crash, broken cleanup          | `luke-bugs`     |
| auth bypass, IDOR, injection, token weakness, data exposure | `luke-security` |
| missing or inadequate verification for a change             | `luke-test`     |
| test runner or browser-provider version compatibility       | `luke-deps`     |
| README / JSDoc / Prisma doc / ADR index drift               | `luke-docs`     |

Two boundaries that are easy to get wrong:

- **Security gate plumbing vs security semantics.** "The Semgrep chain is
  fail-open" is `luke-deps` — it is a property of the runner. "Semgrep has no
  rule for this recurring injection pattern" is `luke-security` proposing a
  promotion.
- **Bug with security impact.** `luke-bugs` reports it and escalates; it does not
  run a parallel exploit hunt. The escalation shape is defined in
  `.claude/skills/luke-bugs/SKILL.md`.
- **QA strategy vs QA toolchain.** "this change has no component-level
  coverage" is `luke-test`. "the browser provider no longer supports the
  installed Vitest" is `luke-deps`. A skill that owns strategy must not start
  picking runner versions, and one that owns versions must not decide what is
  adequately tested.

`luke-bugs` and `luke-security` may prescribe the regression evidence a finding
requires; `luke-test` owns implementing and executing it. `luke-fix` cannot call
a behavior-bearing fix proven on lint and typecheck alone — see §5.

## 4. Authority order

Canonical here. Do not restate it in a skill; link to this section.

```
explicit current user decision
    > Accepted / superseding ADR  +  the stable CLAUDE.md constitution
    > executable manifests and configuration, for observed technical facts
    > generated README / JSDoc descriptive material
    > historical lessons
```

This is **not** a claim that prose outranks executable reality. It separates
**normative decisions** from **observed facts**:

- "which version of Prisma is installed?" — the manifest wins, always;
- "do we deliberately run a single instance with process-local state?" — ADR 011
  is normative until a human supersedes it.

So when code contradicts an Accepted ADR, that is **architectural drift to
report**, not evidence the ADR expired. Two explanations exist — the decision was
superseded and nobody updated the ADR, or the implementation drifted from a still
valid decision — and no agent can pick between them. Report an
`ADR/CODE CONFLICT` and let the user decide.

`luke-audit` loads only the Accepted ADRs relevant to its scope, not all of them
on every diff.

## 5. Deduplications

Recorded so a removal has a written spec, and so nothing is deleted on the
strength of an agent's judgement alone.

**A duplicate is only removed once its new owner actually performs the check.**
A half-removed duplicate is worse than either state: the check disappears from
the skill that had it while the new owner has not implemented it yet. Where the
invariant is still semantic, the row says so — "moved" is not the same claim as
"now deterministic".

### Done

| Was duplicated                                    | Removed from  | Owner now       | Enforcement                                                                 |
| ------------------------------------------------- | ------------- | --------------- | --------------------------------------------------------------------------- |
| dependency version mismatch across manifests      | `luke-audit`  | `luke-deps`     | **deterministic** — P1 in `tools/scripts/check-platform-integrity.ts`        |
| `npm install` / `yarn` in an executable workflow  | `luke-audit`  | `luke-deps`     | **semantic** — `/luke-deps platform` §10; the checker only sees a tracked foreign lockfile (P3), never the textual half |
| systematic IDOR / rate-limit / secret-exposure hunt | `luke-bugs` | `luke-security` | **semantic** — handoff via `Security escalation: YES`; no deterministic owner |
| raw-SQL exception list restated in the skill      | `luke-audit`  | `CLAUDE.md`     | **normative source** — the skill points at the policy instead of copying it  |

The `requirePermission` + non-transactional write case stayed in `luke-bugs`
rather than moving: it is a check-then-act race whose defect is the missing
atomicity, not an attacker primitive.

### Pending

| Duplicate                                | Remove from | Owner after       | Cycle |
| ---------------------------------------- | ----------- | ----------------- | ----- |
| `luke-full` numeric 0–100 health score   | `luke-full` | categorical state | 4B    |
| ADR `Status` mutation without a decision | `luke-docs` | user decision     | 4B    |

### Known limit

One-owner-per-invariant is **not itself machine-enforced**. `check:drift`
validates paths, symbols and execution contracts; it does not understand what a
checklist item means, so nothing stops a future edit from reintroducing a
duplicate. The control here is this file plus review — level 4, honestly
labelled.
