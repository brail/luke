# Evaluate mode — technology decision assessment

Companion to `.claude/skills/luke-deps/SKILL.md`, read in full by `evaluate` mode
before it acts.

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
