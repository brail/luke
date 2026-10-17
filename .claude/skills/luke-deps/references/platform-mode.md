# Platform mode — platform integrity and architecture drift

Companion to `.claude/skills/luke-deps/SKILL.md`, read in full by `platform` mode
before it acts.

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
   - **is a forbidden package manager actually in use?** `npm install`,
     `npm run`, `yarn` in an executable workflow — a script, a hook, a
     Dockerfile, a CI step — is drift. Raw occurrence is only an
     **investigation trigger** (protocol §8): the same strings in a migration
     note, a quoted example, or prose explaining what not to do are not
     violations. The deterministic checker owns the lockfile half of this
     (a tracked `yarn.lock`); the textual half needs the context you have and
     it does not
   - is a declared policy inert — configured but with no effect?
   - is an installed tool not actually wired into the config that would run it?
   - does a task-graph edge still correspond to a real artifact dependency?
   - is a lifecycle commitment (Node LTS, override expiry, held decision) overdue?
   - is a platform version duplicated as prose anywhere it can drift?

The agent runtime contract is **not** re-checked here: `check-skill-integrity`
owns the frontmatter invariants, and `claude plugin validate` does not apply (it
expects a plugin manifest this repo does not have). When a change depends on
Claude Code runtime semantics, inspect the installed runtime deliberately; never
make CI depend on the Claude CLI.

## Report

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
