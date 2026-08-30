---
name: luke-full
description: >
  Full enterprise audit of the Luke codebase. Orchestrates all three audit skills
  in sequence: architectural compliance (/luke-audit), runtime bug detection
  (/luke-bugs), and security vulnerabilities (/luke-security).
  Use before a release, after a long vibe coding period, or for a periodic
  full health check. Scoping: /luke-full apps/api | --since <ref> | --full
context: fork
agent: general-purpose
background: false
disallowed-tools: Edit, Write, NotebookEdit
---

# Luke Full Audit — Orchestrator

You are running a complete enterprise-grade audit of the Luke codebase.
This orchestrates three specialized skills in sequence. Do NOT modify any file.

**Read `.claude/skills/luke-shared/audit-protocol.md` first.**

Scope: resolve it per §1 of the shared protocol and pass it unchanged to the
three skills, so that the three reports cover exactly the same set of files.

`/luke-full` is the case where `--full` makes the most sense: before a release
you want the absolute state, not the delta since the last session. The
default still stays the diff — ask for confirmation before launching an
unrequested full scan.

---

## Execution Plan

Run the three skills below **sequentially** in this order.
Pass the scoped path ($ARGUMENTS) to each skill if provided.

### Step 1 — Architectural Compliance

Invoke: `Skill(luke-audit) $ARGUMENTS`

Wait for completion before proceeding.

### Step 2 — Runtime Bug Detection

Invoke: `Skill(luke-bugs) $ARGUMENTS`

Wait for completion before proceeding.

### Step 3 — Security Vulnerabilities

Invoke: `Skill(luke-security) $ARGUMENTS`

Wait for completion before proceeding.

---

## Final Synthesis Report

After all three skills complete, produce this unified executive summary:

```
═══════════════════════════════════════════════════════════
  LUKE FULL AUDIT REPORT
  Scanned: <path or 'full monorepo'>
  Date: <today>
═══════════════════════════════════════════════════════════

## Overall Health Score

| Skill              | CRITICAL | HIGH | MEDIUM | LOW | Score  |
|--------------------|----------|------|--------|-----|--------|
| /luke-audit        |    N     |  N   |   N    |  N  | xx/100 |
| /luke-bugs         |    N     |  N   |   N    |  N  | xx/100 |
| /luke-security     |    N     |  N   |   N    |  N  | xx/100 |
| OVERALL            |    N     |  N   |   N    |  N  | xx/100 |

Score formula: 100 − (CRITICAL×20 + HIGH×10 + MEDIUM×3 + LOW×1), floor 0.
Calculated ONLY on new findings (post-baseline, §2 and §5 of the protocol).
Report alongside it: `Suppressed by baseline: N`.

## 🔴 Must Fix Before Next Release
List every CRITICAL finding across all three skills with file:line and one-line fix.
If none: ✅ No blockers.

## 🟠 Fix This Sprint
List every HIGH finding across all three skills with file:line and one-line fix.
If none: ✅ No high-priority issues.

## 🟡 Backlog
Count of MEDIUM and LOW findings by category. No detail — just counts.
Full details are in each skill's individual report above.

## Patterns & Observations
2-3 sentences on recurring themes across all findings.
E.g. "Error propagation is the dominant issue — 4 of 6 HIGH findings
involve errors being swallowed in catch blocks."

## Promotion to rule (consolidated)
Merge the "Promotion to rule" sections from the three skills, deduplicating
them. If the same class emerges from two skills, propose it once.
This section is the report's most valuable output: it converts LLM findings
into deterministic checks that make the next report shorter.

## Recommended Next Session Focus
One specific area to address first, based on finding density and severity.
```

---

## Scoring Guide

Formula (already in the report template): 100 − (CRITICAL×20 + HIGH×10 + MEDIUM×3 + LOW×1), floor 0.

- A score ≥ 85 = healthy for enterprise use.
- A score < 70 = do not release without addressing HIGH findings.
- A score < 50 = stop feature work, address CRITICAL findings first.

Notes:

- /luke-audit has no CRITICAL severity (max is HIGH) and /luke-security has no LOW —
  fill those cells with 0, don't invent findings to populate them.
- The three skills overlap on security-adjacent checks (e.g. IDOR appears in both
  /luke-bugs area 3 and /luke-security). If the same file:line issue is reported by
  two skills, count it ONCE in the synthesis (keep the higher severity).
