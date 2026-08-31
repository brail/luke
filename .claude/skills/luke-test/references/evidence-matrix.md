# Evidence matrix — what proves a change correct

Companion to `.claude/skills/luke-test/SKILL.md`. Named for what it decides:
`luke-deps` already owns a `verification-matrix.md`, and that one maps a
*dependency* to the invariant it can silently break. This one maps a *change*
to the evidence that would catch it being wrong.

The question is never "which test command can I run". It is:

> What deterministic evidence is sufficient to consider this change correct?

---

## 1. The tiers

Four, and they do not substitute for each other. Two of them are expensive for
different reasons, which is why they stay separate.

| Tier                       | Proves                                                      | Cost   | Command                        |
| -------------------------- | ----------------------------------------------------------- | ------ | ------------------------------ |
| **lint**                   | syntactic and project-rule violations                       | free   | `pnpm lint`                    |
| **production typecheck**   | the application source is type-coherent                     | cheap  | `pnpm typecheck`               |
| **test typecheck**         | the test corpus has not rotted away from the code it tests  | cheap  | `pnpm typecheck:test`          |
| **unit (Node)**            | pure logic: mapping, formatting, calculation, schema shape  | fast   | `pnpm test`                    |
| **component (browser)**    | React behavior in a real DOM: focus, portals, events, forms | medium | the browser project (see §5)   |
| **integration (Postgres)** | wire and persistence behavior against a real database       | slow   | `pnpm test:integration:local`  |
| **E2E (Playwright)**       | a critical flow through the whole running application       | slowest| `pnpm --filter @luke/web test:e2e` |

**Integration and E2E are not the same tier.** Integration proves a procedure
against a real database and a real wire format with no browser; E2E proves a
user-visible flow through the running stack. Collapsing them because both are
slow loses the cheaper, more precise one first.

**Component and E2E are not the same tier either.** A component test enumerates
state combinations in milliseconds; E2E proves they compose into a flow. Using
E2E to enumerate component states is the standard way to end up with a slow
suite that still misses the states.

## 2. Selection by change

The minimum, not the maximum. Add a tier when the failure mode demands it.

| Change                                  | Required evidence                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Pure TS utility / mapping               | typecheck (prod + test as applicable) + unit                                     |
| Zod schema or shared contract           | typecheck + unit covering a valid and an invalid input, with the message         |
| Interactive React component or hook     | test typecheck + **component**. Unit alone cannot see focus, portals or events   |
| Presentational component, no behavior   | typecheck. A snapshot of markup is not evidence                                  |
| tRPC procedure, no DB shape change      | typecheck + unit on the permission matrix                                        |
| tRPC procedure touching the database    | + **integration** — the procedure-coverage gate will demand it anyway            |
| Prisma schema / migration               | integration + the migration jobs (`prisma migrate deploy`, `migrate diff`)       |
| Auth, session, rate limiting            | integration **at the HTTP level** — a stubbed `req.ip` proves nothing (`lessons.md`) |
| Multi-table write                       | integration proving rollback leaves state consistent                             |
| Critical user flow                      | selected E2E, and only the flow that changed                                     |
| Bug fix                                 | a regression test **proven red on the broken code**, then green on the fix       |
| Dependency bump                         | not this skill — `luke-deps` §4 verification ladder                              |

## 3. Result model

Every assessment ends in one of these, per tier and overall.

| Result       | Meaning                                                            |
| ------------ | ------------------------------------------------------------------ |
| **PASS**     | the tier ran and was green                                         |
| **FAIL**     | the tier ran and was red                                           |
| **SKIPPED**  | deliberately not run, **with the reason stated**                   |
| **QA GAP**   | the tier is *required* by the change and does not exist            |

A QA GAP is never an implicit PASS. It is the honest name for "nothing here
could have caught this", and it carries a residual risk:

| Residual risk | When                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **LOW**       | every required tier ran green; gaps are on paths that cannot corrupt or expose |
| **MEDIUM**    | a required tier is missing, but the change is reversible and observable |
| **HIGH**      | a required tier is missing on auth, money, data integrity or destructive paths |

`PASS WITH QA GAP` is a legitimate verdict. `PASS` when a required tier is
absent is not.

## 4. Two failure modes this matrix exists to prevent

**A green runner that ran nothing.** Missing `TEST_DATABASE_URL` makes the
integration suite *fail*, deliberately, rather than skip — a green job with zero
tests is worse than a red one. Apply the same suspicion everywhere: check the
**test count**, not just the exit code. A runner that discovers no tests exits
zero (`lessons.md`, and `luke-deps`' matrix row for `vitest`).

**A green gate that was the wrong gate.** `.husky/pre-push` once printed eight
green tasks and the branch still broke CI, because `typecheck` alone covers only
the build graph — `test/`, `scripts/` and `prisma/` reach `tsc` solely through
`typecheck:test`. Before trusting a gate, read what it actually runs. The count
of green tasks says nothing about which tasks they were.

## 5. Where the tiers live

Membership is decided by **file naming and project config**, never by a
hand-maintained list: a list has an asymmetric failure mode, where a missing
entry is noticed immediately but a stale one after a rename is not, and a whole
suite silently drops out of the run.

| Tier        | Membership                                        | Config                                   |
| ----------- | ------------------------------------------------- | ---------------------------------------- |
| unit (api)  | anything not matching `*.integration.spec.ts`     | `apps/api/vitest.config.mts`             |
| integration | `apps/api/test/**/*.integration.spec.ts`          | `apps/api/vitest.integration.config.mts` |
| unit (web)  | pure modules under `apps/web/src/lib/`            | `apps/web/vitest.config.mts`             |
| component   | web browser specs, own project and script         | added by the platform cycle              |
| E2E         | `apps/web/tests/smoke/*.smoke.spec.ts`            | `apps/web/playwright.config.ts`          |

The component tier deliberately keeps its own config and script so that
`pnpm test` stays the fast Node tier: the local loop and `.husky/pre-push` must
not have to provision a browser.
