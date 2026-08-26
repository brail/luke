# Lessons Archive

Lessons moved out of `lessons.md` once they became fully covered by a
deterministic check (an ESLint/semgrep rule, or a blocking CI/pre-push
script) — control-hierarchy level 1 or 2 in `.claude/skills/luke-shared/audit-protocol.md`
§3. At that point an LLM audit re-checking the pattern by reading prose is
pure overhead: the machine already blocks it on every push, with or without
this file being read.

**Not read by the `luke-*` audit skills** — that's the whole point. This file
exists for human/historical reference only, so `lessons.md` stays a working
checklist instead of a monotonically growing one. `lessons.md` keeps a
one-line pointer to each entry archived here.

---

## Bare `crypto.randomUUID()` in a client component crashes outside a secure context

`settings/collection-control/page.tsx` called `crypto.randomUUID()` directly
to generate React keys for `BandSetEditor`. In production, on a host reached
over plain HTTP (not HTTPS/localhost), the Web Crypto API doesn't expose
`randomUUID` — `TypeError: crypto.randomUUID is not a function`, the whole
page replaced by the `app/error.tsx` error boundary. The correct pattern
already existed in two places in the repo (`lib/trpc.tsx`,
`CollectionRowDrawer.tsx`) but hadn't been applied here: known bug, known
fix, simply not reused.

Fixed in place with the fallback already used elsewhere:

```ts
crypto.randomUUID?.() || Math.random().toString(36).substring(2) + Date.now().toString(36)
```

but an inline fix doesn't prevent recurrence — explicitly asked to
**promote to a rule** instead of just patching the file. Created
`@luke/no-bare-client-random-uuid` in `packages/eslint-plugin-luke/rules/`:
flags non-optional `crypto.randomUUID()` in any file with a `'use client'`
directive at the top (Server Components run in Node, where the API is
always available — the rule ignores them by construction, checking
`Program.body[0]`). Wired into `eslint.config.mjs` scoped to
`apps/web/src/**`, error level.

**Rule**: a runtime bug caused by an API the code uses in exactly one place
"by mistake" while it's already handled correctly elsewhere must be closed
with an enforced ESLint rule, not just a fix at the call site — the next
bare `crypto.randomUUID()` must be blocked at commit time, not discovered in
production from a generic error with no stack trace visible to the user.

**Archived 2026-08-26**: fully enforced by `@luke/no-bare-client-random-uuid`
(error level, `apps/web/src/**`). Nothing left for an audit to manually check.

---

## A skill with `agent: Explore` cannot invoke subagents

`luke-audit`, `luke-bugs` and `luke-security` declared `agent: Explore` and
contained "Run 3 agents in parallel" with three detailed briefs. The Explore
agent has every tool **except** Agent: the fan-out never happened, and
silently degraded to a single pass. No error, no signal — just reports
produced in a way different from what was declared, for months.

The fix isn't switching to `agent: general-purpose`: those skills are
read-only, and today the constraint is guaranteed by the agent type, which
has no write tools. Unlocking subagents would have handed them Write and
Edit, downgrading a structural invariant to a prose instruction.

**Rules**:

1. Before writing orchestration instructions in a skill, verify the
   declared agent type has the Agent tool.
2. Verified by `tools/scripts/check-skill-integrity.ts`, blocking in CI.
3. Applies in general: an instruction the runtime can't execute doesn't
   fail, it gets ignored. It's the most silent form of inert control.

**Archived 2026-08-26**: fully enforced by `tools/scripts/check-skill-integrity.ts`
(blocking in CI and pre-push). Nothing left for an audit to manually check.
