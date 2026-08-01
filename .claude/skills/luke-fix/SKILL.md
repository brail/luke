---
name: luke-fix
description: >
  Incremental fix-verify loop for the Luke codebase. Runs an audit, takes the
  highest-severity finding, proposes a fix, applies it after confirmation, then
  re-runs the audit to verify no regressions were introduced. Repeats until no
  HIGH or CRITICAL findings remain.
  Use after vibe coding sessions to systematically fix audit findings.
  Optional: specify which audit to run — /luke-fix audit | bugs | security | full
  Default: runs /luke-audit (architectural compliance).
argument-hint: "[audit|bugs|security|full] [path]"
disable-model-invocation: true
---

# Luke Fix-Verify Loop

You are running an incremental fix-verify loop on the Luke codebase.
At each iteration: find → propose → confirm → fix → verify → repeat.

**Read `.claude/skills/luke-shared/audit-protocol.md` first** and apply the
sections its applicability table assigns to `/luke-fix`: §1 scoping and §7
concurrent sessions. You modify application code, not test files, so §7.2 and
§7.4 are the ones that bite.

## Configuration

Parse $ARGUMENTS to determine which audit to use:

- `audit` or empty → use Skill(luke-audit)
- `bugs` → use Skill(luke-bugs)
- `security` → use Skill(luke-security)
- `full` → use Skill(luke-full)

Store the chosen audit skill as AUDIT_SKILL for use throughout the loop.
Store the scope path if provided as a second argument (e.g. `/luke-fix bugs apps/api`).

---

## Loop

### Iteration Start

**Step 1 — Run audit**
Invoke AUDIT_SKILL (with scope if provided).
Parse all findings. Build a prioritized list:

1. CRITICAL findings (sorted by file path for reproducibility)
2. HIGH findings
3. MEDIUM findings
4. Stop — do not auto-process LOW findings

If the list is empty: print the completion message (see below) and stop.

---

**Step 2 — Pick next finding**
Take the first unresolved finding from the prioritized list.
Skip any finding that was already attempted in a previous iteration
(track attempted findings by file:line across iterations).

If all findings have been attempted: print the completion message and stop.

---

**Step 3 — Present finding and proposed fix**

Show this to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Iteration N  |  Remaining: X CRITICAL, Y HIGH, Z MEDIUM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[SEVERITY] — <finding title>
File: `path/to/file.ts:line`
Problem: <one sentence explanation>

Proposed fix:
<show the exact code change as a diff or before/after>

Options:
  [Y] Apply fix and continue
  [S] Skip this finding (mark as known, move to next)
  [E] Edit the proposed fix before applying
  [Q] Quit loop (keep changes made so far)
```

**Wait for user response before proceeding.**
Do not apply any change without explicit confirmation.

---

**Step 4 — Handle response**

**Y (Apply)**:

- If the file is in another live session's ledger (§7.2), **do not apply**:
  mark the finding `skipped — file owned by another session`, say so, and move
  to the next finding. The loop continues.
- Apply the fix to the file, then append its path to your ledger (§7.1)
- Run the minimal verification for this finding type:
  - TypeScript error? → `pnpm --filter <app> typecheck` on the affected file
  - Prisma schema? → check schema syntax only, do not run migration
  - React hook? → no automated check, note it for manual testing
  - ESLint violation? → `pnpm --filter <app> lint <file>`
- If verification fails: show the error, revert the change — **by undoing your own
  Edit, never with `git checkout`/`git restore` on the file** (§7.4) — mark finding
  as "attempted/failed", move to next
- If verification passes: mark finding as "fixed", continue to Step 5

**S (Skip)**:

- Mark finding as "skipped — user decision"
- Go back to Step 1 (re-run audit to get fresh list)

**E (Edit)**:

- Show the proposed fix as editable text
- Wait for user to provide the corrected fix
- Apply the corrected fix
- Run verification as in Y
- Continue to Step 5

**Q (Quit)**:

- Print the session summary and stop

---

**Step 5 — Re-verify with full audit**

After applying a fix, re-run AUDIT_SKILL scoped to the **affected file(s) only**
(not the full codebase — keep it fast).

Check:

1. The original finding is gone ✅
2. No new CRITICAL or HIGH findings appeared in the same file ✅

If a new finding appeared in the fixed file:

- Show it immediately: "⚠️ Fix introduced a new issue:"
- Offer to fix it in the same iteration or queue it for next

Go back to Step 1 for the next iteration.

---

## Completion Message

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Luke Fix Loop — Session Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Fixed:   N findings
Skipped: N findings
Failed:  N findings (reverted)
Remaining MEDIUM/LOW: N (not auto-processed)

Files modified:
  - path/to/file.ts (N fixes)
  - path/to/other.ts (N fixes)

Suggested next step:
  Run /luke-full for a complete health check before committing.
  Then: show diff → ask "Ready to commit?" → wait for approval.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Hard Rules

- NEVER apply a fix without explicit user confirmation (Y, E)
- NEVER batch-apply multiple fixes without re-running the audit in between
- NEVER run `git commit` — that is the user's decision
- NEVER revert with `git checkout`/`git restore` on a file: it discards the other
  session's uncommitted work and the user's, not just yours (§7.4)
- NEVER process MEDIUM or LOW findings automatically — present them in the
  completion summary only
- If the same file is fixed 3+ times in one session, warn:
  "⚠️ This file has been modified 3 times — consider reviewing the full file
  before continuing."
