---
name: luke-full
description: >
  Full health assessment of the Luke codebase. Orchestrates five read-only
  phases in sequence: platform integrity (/luke-deps platform), architectural
  compliance (/luke-audit), runtime correctness (/luke-bugs), application
  security (/luke-security) and QA adequacy (/luke-test assess), then
  synthesizes them into a categorical health state with an owner per finding.
  Use before a release, after a long vibe coding period, or for a periodic
  full health check. Scoping: /luke-full apps/api | --since <ref> | --full
context: fork
agent: general-purpose
background: false
disallowed-tools: Edit, Write, NotebookEdit
---

# Luke Full Audit — Orchestrator

A complete health assessment of the Luke codebase, across five read-only
phases. Do NOT modify any file.

**Orchestrate and synthesize. Never invent a sixth checklist of your own** — if
a check belongs to no phase below, it belongs in the skill that owns that
domain, not here (`.claude/skills/luke-shared/governance-map.md`).

**Read `.claude/skills/luke-shared/audit-protocol.md` first**, and
`.claude/skills/luke-shared/result-contract.md` for the footer this skill emits.

Every phase is read-only. Two are modes chosen precisely because they do not
write: `/luke-deps platform` assesses the platform without upgrading anything,
and `/luke-test assess` reports what evidence is missing without creating it.
**Never invoke `/luke-test write` from here**, and never `/luke-deps apply`.

Scope: resolve it per §1 of the shared protocol and pass it unchanged to the
phases that take one, so every report covers exactly the same set of files.
Phase 0 is the exception: `/luke-deps platform` reads the repository's own
configuration, which has no diff scope.

`/luke-full` is the case where `--full` makes the most sense: before a release
you want the absolute state, not the delta since the last session. The
default still stays the diff — ask for confirmation before launching an
unrequested full scan.

---

## Execution Plan

Run the five phases **sequentially**, in this order. Pass the scoped path
($ARGUMENTS) to each skill where it takes one. Each forked skill declares
`background: false`, so waiting is a property of the runtime and not just an
instruction here (audit-protocol §6.1).

### Phase 0 — Platform & Toolchain

Invoke: `Skill(luke-deps) platform`

Read-only. Takes no diff scope: its input is the repository's own configuration.
Runs first because a platform failure explains application findings that follow
— a version skew reported as four mysterious type errors is one finding, not
four.

### Phase 1 — Architectural Compliance

Invoke: `Skill(luke-audit) $ARGUMENTS`

### Phase 2 — Runtime Correctness

Invoke: `Skill(luke-bugs) $ARGUMENTS`

### Phase 3 — Application Security

Invoke: `Skill(luke-security) $ARGUMENTS`

Findings escalated by Phase 2 are re-derived here, not inherited.

### Phase 4 — QA Adequacy

Invoke: `Skill(luke-test) assess $ARGUMENTS`

Read-only. Answers whether the changed surface has evidence behind it. A missing
required tier is a QA GAP, and a QA GAP is a finding — it is what "the tests
passed" cannot tell you.

---

## Final Synthesis Report

After all five phases complete, produce this unified executive summary:

```
═══════════════════════════════════════════════════════════
  LUKE FULL AUDIT REPORT
  Scanned: <path or 'full monorepo'>
  Date: <today>
═══════════════════════════════════════════════════════════

## Health

| Phase                 | Severities (each skill's own scale) | Status |
|-----------------------|-------------------------------------|--------|
| /luke-deps platform   | P0 n · P1 n · P2 n                  | ...    |
| /luke-audit           | HIGH n · MEDIUM n · LOW n           | ...    |
| /luke-bugs            | CRITICAL n · HIGH n · MEDIUM n      | ...    |
| /luke-security        | CRITICAL n · HIGH n · MEDIUM n      | ...    |
| /luke-test assess     | QA GAP n · residual risk X          | ...    |

Severities stay in each skill's own vocabulary — `/luke-audit` has no CRITICAL,
`/luke-security` has no LOW, `/luke-deps` counts P0/P1/P2, `/luke-test` reports
QA GAPs. Do not translate them into a shared scale; the differences are real.

**Overall: <HEALTHY | HEALTHY WITH KNOWN GAPS | ACTION REQUIRED | RELEASE BLOCKED>**

Suppressed by baseline: N

### How the state is decided

Evaluated top to bottom; the first matching rule wins. Only **CONFIRMED**
findings count — a `NEEDS DECISION` is a question for the user, not a defect,
and it never moves the state on its own.

| State                        | When                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| **RELEASE BLOCKED**          | any confirmed CRITICAL (bugs/security) or P0 (platform), **or** a required gate that ran and failed |
| **ACTION REQUIRED**          | any confirmed HIGH or P1, **or** a QA GAP whose residual risk is HIGH                                    |
| **HEALTHY WITH KNOWN GAPS**  | no confirmed HIGH or above, but QA GAPs, baseline suppressions or open `NEEDS DECISION` items exist       |
| **HEALTHY**                  | none of the above                                                                                          |

There is deliberately **no numeric score**. The previous
`100 − (CRITICAL×20 + HIGH×10 + …)` produced a two-digit number out of counts an
LLM produced, which moved when findings were grouped differently rather than
when the code changed. A state that says which rule fired is auditable; `82/100`
is not. Do not reintroduce a score, a percentage or a grade.

**"A required gate that ran and failed"** means exactly that: a gate applicable
to this scope, executed, and red — `pnpm check:drift`, a failing suite, a red
`typecheck:test`. A tier that was *not required* for the scope, or required and
*not executed*, is not a failure. The first is a correct SKIPPED, the second is
a QA GAP, and neither blocks a release by itself. Reporting an unexecuted tier
as a red gate would make every partial run look like an emergency.

A state is not a verdict on the release: it is a statement about evidence. Say
which rule fired and which finding triggered it.

## 🔴 Release blockers
Every CONFIRMED blocker across all five phases — CRITICAL (bugs/security) or P0
(platform) — as: file:line · severity · remediationOwner · one-line fix.
If none: ✅ No blockers.

## 🟠 Action required
Every CONFIRMED HIGH or P1, same shape. A QA GAP with HIGH residual risk belongs
here too, owned by /luke-test.
If none: ✅ Nothing requiring action.

## 🟡 Backlog
Counts of MEDIUM/LOW/P2 by category. No detail — it is in the phase reports.

## ❓ Needs decision
Findings whose status is NEEDS DECISION, with the question each one poses.
These are **not** queued for remediation by anyone: they are yours to answer.
If none: ✅ Nothing awaiting a decision.

## Patterns & Observations
2-3 sentences on recurring themes across all findings.
E.g. "Error propagation is the dominant issue — 4 of 6 HIGH findings
involve errors being swallowed in catch blocks."

## Promotion to rule (consolidated)
Merge the "Promotion to rule" sections from the phases, deduplicating them. If
the same class emerges from two skills, propose it once.
This section is the report's most valuable output: it converts LLM findings
into deterministic checks that make the next report shorter.

## Recommended Next Session Focus
One specific area to address first, based on finding density and severity.
```

---

## Synthesis rules

- **Deduplicate across phases.** The same `file:line` reported by two skills is
  one finding: keep the higher severity and record both in `source`. A platform
  failure that explains application findings is reported once, in Phase 0, with
  the downstream symptoms named.
- **Every finding carries an owner pair.** `domainOwner` is the skill that owns
  the invariant; `remediationOwner` is who should act — derived from
  `governance-map.md` §3, never from severity. A platform finding is remediated
  by `/luke-deps`, a QA GAP by `/luke-test`, docs drift by `/luke-docs`, and
  application code by `/luke-fix`.
- **Do not invent findings to fill a table cell.** A phase with nothing to say
  reports `✅ No findings`.
- **Emit the structured footer** defined in
  `.claude/skills/luke-shared/result-contract.md`, so `/luke-fix` can route
  without re-reading five reports. The footer records the synthesis; it is not a
  second place health is computed.

## Structured footer

Close the report with the result contract's JSON block. It carries per-finding
`status` and `evidence` alongside the ownership pair, because those are what
keep a `NEEDS DECISION` or a QA GAP from being queued as an executable fix.
