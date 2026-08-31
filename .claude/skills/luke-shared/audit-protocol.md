# Luke Audit Protocol — shared rules

Protocol shared by all `luke-*` skills: `/luke-audit`, `/luke-bugs`,
`/luke-security`, `/luke-full`, `/luke-test`, `/luke-fix`, `/luke-docs`,
`/luke-deps`.
Every skill reads it before starting; the specific checks stay in each
skill's own file.

**This file says _how_ a skill works. Its companion
`.claude/skills/luke-shared/governance-map.md` says _which skill decides_** —
ownership, the owner/consumer boundary rule, and the authority order between a
user decision, an Accepted ADR, a manifest and generated documentation. Read it
when a finding could belong to two skills, when adding a check, or when routing
a finding to a remediator.

## Applicability

Not every section applies to every skill: §2, §3 and §5 assume the skill
produces _findings_, and `/luke-test`, `/luke-fix`, `/luke-docs` don't produce any.

This table is the single place where applicability is written. It used to
live in the line each skill used to point here, and every skill had invented
a different version of it: four said "apply it" with no qualification,
`/luke-test` cited only §1, `/luke-fix` and `/luke-docs` didn't point here at
all — despite writing files.

| §   | Rule                               | Applies to                                                                                             |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Diff scoping                       | all except deps — its input is the registry, not the diff; a path argument there is a workspace filter |
| 2   | Baseline                           | audit, bugs, security, full                                                                            |
| 3   | Escalation to a deterministic rule | audit, bugs, security, full, deps                                                                      |
| 4   | `lessons.md` as a check input      | audit, bugs, security, full, deps                                                                      |
| 5   | Score honesty                      | audit, bugs, security, full                                                                            |
| 6   | No fan-out                         | whoever declares `agent: Explore`                                                                      |
| 7   | Concurrent sessions                | all — §7.2 only for those who write files (test, fix, docs, deps)                                      |
| 8   | Constraint vs heuristic            | audit, bugs, security, deps — anyone whose checklist turns a pattern into a finding                    |

---

## 1. Scoping — default on the diff, not the monorepo

A full-monorepo scan produces the same findings on every run, costs a lot,
and gets run rarely. The goal is the opposite: low cost, used every session.

**Resolution order is normative, not incidental. Parse before you look at
git** — an invocation that ran a git diff command before checking
`$ARGUMENTS` has already gotten this wrong, whatever it does next.

1. Read the **bound invocation arguments** — the value the invoking `SKILL.md`
   substituted into its own `$ARGUMENTS` placeholder. Not this literal token:
   **this file is read as a reference, so its own `$ARGUMENTS` is never
   substituted** and carries no caller state. Every skill that resolves scope
   binds the value in its own body first, on its own line, before reasoning
   about it. Do not run any git diff command before this step.

   A skill first parses any skill-specific **mode or action** it defines; the
   remaining portion is the scope selector. For the scope-only audit
   specialists and `/luke-full`, the whole bound value is the selector. For a
   mode-bearing skill such as `/luke-test`, `assess` is parsed first and the
   remainder is the selector. **A scope selector is never a materialized
   arbitrary file list** — it is one of the deterministic forms below, so
   every skill derives the same set from the same repository state.
2. If the remaining selector carries an explicit form, resolve it and **stop**
   — never fall through to the default derivation below once one of these
   matched:

   | Form                   | Behavior                           |
   | ---------------------- | ----------------------------------- |
   | `--full`               | whole monorepo, explicit            |
   | `--since <ref>`        | files changed relative to `<ref>`   |
   | `<path>`               | just that path, recursive           |
   | `<path> --since <ref>` | intersection of the two             |

3. Only when the bound selector is empty — no explicit form present — derive
   the default set below.
4. **An explicit `--full` is itself the user's confirmation.** Never ask a
   second time before running it, and never recompute the default diff first
   "to check" — that recomputation, followed by asking anyway, is precisely
   the failure this order exists to prevent.
5. The default (empty) path may escalate to a full scan only by asking first
   — see below. This asking requirement is scoped to that one path; it is not
   a general policy about `--full` invocations, and it never re-applies once
   an explicit selector already matched in step 2.

### Deriving the default (empty bound selector only)

```bash
# current development branch (develop-*), fallback to main
BASE=$(git branch -r --list 'origin/develop-*' | sort -V | tail -1 | sed 's|origin/||' | xargs)
BASE=${BASE:-main}
git diff --name-only "$(git merge-base HEAD "$BASE")"...HEAD
git diff --name-only HEAD          # uncommitted changes
git ls-files --others --exclude-standard  # new untracked files
```

Merge the three lists. If the result is empty, say so and stop — don't fall
back to a full scan without asking.

**Context beyond the diff**: still read the source-of-truth files
(`CLAUDE.md`, `lessons.md`, schemas in `packages/core/src/schemas/`) and the
files directly imported by the changed ones. The diff limits _what you
report_, not _what you read_.

---

## 2. Baseline — report only what's new

File: `.luke-audit-baseline.json` at the project root. If it doesn't exist,
treat it as empty (no suppression).

```json
{
  "version": 1,
  "entries": [
    {
      "key": "luke-audit:apps/api/src/lib/foo.ts:raw-sql-outside-nav",
      "reason": "DISTINCT ON query not expressible in Prisma, documented exception in CLAUDE.md",
      "addedAt": "2026-07-29"
    }
  ]
}
```

`key` = `<skill>:<relative path>:<rule slug>`. **Never include the line
number**: it drifts on every edit and would make the suppression useless.

Rules:

1. Compute the `key` for every finding before reporting it.
2. If the `key` is in the baseline, **do not report it** in the report body.
3. At the end of the report, show only the count: `N findings suppressed by baseline`.
4. **Never write** the baseline file yourself. Propose the lines to add in a
   separate block; it's the user's decision what to accept.

The point: a finding that keeps resurfacing on every run and gets ignored
every time teaches people to ignore the report. Either it gets fixed, or it
gets explicitly accepted.

---

## 3. Escalation to a deterministic rule — mandatory

**The most important rule in this protocol.**

A finding produced by an LLM is a weak control: non-deterministic, costly,
and only rediscoverable if someone runs the skill. A semgrep or eslint rule
is free, repeatable, and runs in CI on every push.

On every run, before the final report:

1. Group findings by class (same rule, different files).
2. For every class with **≥2 occurrences**, or already present in a previous
   report, evaluate whether it's expressible as a syntactic pattern.
3. If so, **propose the rule** instead of just listing the occurrences:
   - purely syntactic pattern → `.semgrep/rules/<name>.yml`
   - requires the type checker or the TypeScript AST → `packages/eslint-plugin-luke/rules/<name>.js`
4. Include the written rule, ready to paste, and the command to verify it.

Report footer, always present:

```
### Promotion to rule

| Finding class | Occurrences | Proposed level | File |
|---|---|---|---|
| ... | N | semgrep / eslint | .semgrep/rules/....yml |

<complete rule, ready to paste>
```

If no class is promotable: `No promotable class in this run.`

**Control hierarchy** — every finding should be pushed as high as possible:

1. Impossible to get wrong (types, Prisma schema, DB constraints)
2. Automatically blocked (eslint, semgrep, CI tests)
3. Deterministically flagged (drift check, osv-scanner)
4. Found by an LLM ← **starting state, not the end state**

---

## 4. lessons.md as a check input

`lessons.md` at the root logs regressions already paid for — including the
one that caused the v1.9.1 hotfix (drift between `RATE_LIMIT_CONFIG`,
`DEFAULTS` and `RateLimitConfigSchema`). It must be **read on every run** and
used as a checklist:

1. Read `lessons.md`.
2. For every lesson with a mechanically verifiable shape, check that the code
   in scope doesn't violate it.
3. If a lesson is expressible as a semgrep/eslint rule and isn't yet, include
   it in the "Promotion to rule" section (§3).

`lessons-archive.md` (also at the root) holds lessons already fully covered
by a deterministic check — do **not** read it here. Reading it on every run
would defeat its purpose: it exists precisely so that a lesson a machine
already blocks on every push stops costing tokens on every audit too. See
its own header for the archival policy.

A lesson nobody checks is documentation, not a control.

---

## 5. Score honesty

If the skill produces a score, it must be computed **only on new findings**
(post-baseline). A score that includes accepted findings isn't comparable
across runs and drops for reasons unrelated to the code just written.

Always show, next to the score, the number of suppressed findings.

---

## 6. Agent capability — no fan-out in Explore skills

`/luke-audit`, `/luke-bugs` and `/luke-security` declare `agent: Explore` in
their frontmatter. **An Explore agent doesn't have the Agent tool**: it
cannot invoke subagents.

The three skills used to contain "Run 3 agents in parallel" with three
detailed briefs. It was never executed: every `luke-*` report ever read was
produced by a single sequential pass over the three checklists. A declared
and never-happening fan-out is the same class of defect this protocol exists
to find — only, inside the protocol itself.

**Rule: a skill with `agent: Explore` must not contain instructions to invoke
subagents.** Verified by `tools/scripts/check-skill-integrity.ts`, which runs
in CI.

The fan-out shouldn't be restored by switching to `agent: general-purpose`.
The three skills open with "Read-only. Do NOT modify any file", and today
that constraint is guaranteed **by the agent type**, which has no write
tools. Switching to `general-purpose` to unlock subagents would hand Write
and Edit to read-only skills: a structural invariant downgraded to a prose
instruction, in exchange for a parallelism that never existed.

The fan-out already exists at the right granularity: `/luke-full` (`agent:
general-purpose`) orchestrates the three skills via `Skill()`, each in its
own forked context — three different jobs, not three slices of the same
checklist.

**Trade-off**: the three areas do run in a single context, so on `--full`
scope the context can run out. The default scope is the diff, so this only
bites on explicit `--full`. If it happens, the answer is `/luke-full`, not
resurrecting the fan-out.

### 6.1 Execution contract — declared, never inherited from a default

Every forked skill declares `context`, `agent` and `background` explicitly.

Claude Code's skill frontmatter makes `background` optional, and a fork
**defaults to running as a background agent that reports back as a task
notification instead of blocking the turn**. `/luke-full` tells itself to wait
for each child to finish before starting the next: under that default the
children would not block and the instruction would be a promise the runtime
does not keep — the same defect as the fan-out above, in a different field.
So every Luke fork sets `background: false`.

`disallowed-tools: Edit, Write, NotebookEdit` on the read-only skills removes
the **direct file-editing tools** while the skill is active. Be precise about
what that buys:

- it is **structural** for `/luke-full`, which runs on `general-purpose` and
  would otherwise hold Edit and Write with only prose to stop it;
- it is **defense in depth** for the three `Explore` skills, whose agent type
  already lacks those tools;
- it is **not a filesystem sandbox**. A skill that still has `Bash` can write
  through it. The claim is "the direct write tools are gone", not "the
  filesystem is immutable". Do not restate it more strongly anywhere.

`tools/scripts/check-skill-integrity.ts` enforces the **declaration**, not the
enforcement: it verifies the fields are present and mutually consistent. That
the runtime honors them is Claude Code's contract, read from its frontmatter
schema — not independently proven here.

A skill that writes files (`/luke-docs`) declares `background: false` for the
same reason and carries **no** write restriction: background edits fall outside
the invoking session's checkpoints, which is precisely what a writer must not do.

---

## 7. Concurrent sessions

Two Claude Code sessions on the same repo share the working tree, the test
database, and the cache: they're different processes on the same resources,
with no arbiter.

The observed symptom is a skill that **stops** when it finds files it didn't
write, treats them as an anomaly, and interrupts the work. Those are files
from another live session. The right response isn't to stop: it's to
recognize them, leave them alone, and continue.

### 7.1 Identity and discovery

`$CLAUDE_CODE_SESSION_ID` is the session's identity. It stays the same across
subagents (`/luke-full` invoking the three audit skills shares its own), and
therefore also across successive skills within the same work turn.

Every session already has a scratchpad dir named after it; sibling sessions
are adjacent directories. No new registry to invent:

```bash
SESSIONS_ROOT=$(dirname "$(find /private/tmp/claude-* -maxdepth 2 -type d \
  -name "$CLAUDE_CODE_SESSION_ID" 2>/dev/null | head -1)")
LEDGER="$SESSIONS_ROOT/$CLAUDE_CODE_SESSION_ID/scratchpad/luke-written.txt"

# Files written by sessions still alive (ledger touched in the last 30 minutes)
find "$SESSIONS_ROOT" -maxdepth 3 -name luke-written.txt -mmin -30 \
  -not -path "*/$CLAUDE_CODE_SESSION_ID/*" -exec cat {} +
```

Liveness is the ledger's mtime, not a heartbeat or a PID: the skill can run
inside a subagent with its own PID, and a heartbeat protocol would be new
infrastructure for a fact the filesystem already records.

**An old ledger binds no one.** This is deliberate: files written by
yesterday's session must stay editable today, otherwise the second run of
`/luke-test` on the same tests would refuse to update them.

### 7.2 Ledger and file ownership — only for skills that write

1. Append to `$LEDGER` the path of **every** file you write, one per line,
   right after writing it.
2. On startup, compute the set of files from live sessions other than your own.
3. A file in that set **doesn't get rewritten**: you can still read it as
   context, avoid duplicating its content, and list it in the output as
   `owned by another session, not touched`. **This is not an error and does
   not interrupt the work.**
4. A file in **your own** session's ledger is yours, even if written by a
   previous skill: modify it normally.

The set is empty when you're running alone, and every path stays identical
to today.

### 7.3 Shared, non-partitionable resources

There's only one test database: fixed port `5434`, fixed name, and isolation
between tests is a `TRUNCATE` of every table. Two integration runs in
parallel wipe each other's fixtures, and the failure looks like a product
bug. `fileParallelism: false` serializes inside one vitest process, not
across processes.

- Before launching integration tests: if `pgrep -f vitest` finds someone
  else's run, wait or skip the step — and say so in the output.
- Never `pnpm test:db:down`: it deletes the volume out from under another
  session's run.

### 7.4 Revert — never with git

Restoring a file after a failed change is done **by undoing your own Edit**,
never with `git checkout` or `git restore` on the file.

The git command can't tell your change apart from the rest: it throws away
the other session's uncommitted work too, and the user's. It's destructive
even in a single session; concurrency just makes it more likely.

---

## 8. Constraint, heuristic, investigation trigger

Every item in a skill's checklist is one of three things, and which one it is
decides whether a pattern match is already a finding.

| Class                     | Meaning                                                            | Finding from a pattern match alone? |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| **Constraint**            | the project or an Accepted ADR says this must not happen           | yes, when the evidence is unambiguous |
| **Heuristic**             | often a defect, but needs contextual proof                         | no                                  |
| **Investigation trigger** | a cheap search that locates code worth reading                     | no                                  |

Examples, to calibrate:

- `array.forEach(async ...)` — close to a syntactic constraint, and promotable
  to semgrep/eslint (§3).
- `findMany` inside a loop — investigation trigger for N+1. Proof is the query
  count against a realistic row count, not the shape.
- `findMany` without `select` — heuristic. It is a defect only if the extra
  fields can cross a trust boundary or reach a log.
- `npm install` appearing in a file — investigation trigger. Actual use in an
  executable workflow is drift; a migration note, a quoted example, or prose
  explaining what not to do is not.

### 8.1 A skill may summarize a normative rule, never strengthen it

If the source carries exceptions, the skill either reproduces the exceptions or
— better — **points at the source and does not restate the rule at all**. A
second copy of an exception list is a second thing to keep in sync, and it will
not be kept in sync.

This is not hypothetical: `luke-audit` carried "raw SQL outside
`packages/nav/src/`" flat, while `CLAUDE.md` had documented exception classes
all along. Every legitimately excepted call site was a false positive waiting to
be reported, and false positives on a blocking rule get the rule disabled
within a week (`lessons.md`).

### 8.2 A pattern is not a defect until its precondition holds

`useState` seeded from a prop is only stale if the component stays mounted;
a conditionally rendered dialog remounts and the seeding is correct. Check the
call site before naming it a bug (`lessons.md`, "A grep is evidence about text,
not about the thing you are claiming").

### 8.3 Disagreeing with a rule is not licence to reinterpret it

A skill that believes a project rule is too broad reports it as
`NEEDS DECISION` alongside its findings, and **keeps enforcing it meanwhile**.
The rule's author is the authority on the rule; the skill is the authority on
what the code does. Silently narrowing a constraint because it seems excessive
is how a control disappears without anyone deciding to remove it.
