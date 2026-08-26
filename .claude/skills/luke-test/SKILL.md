---
name: luke-test
description: >
  Generates and updates tests for the Luke monorepo based on what actually
  changed. Picks the right tier (unit vs integration), the right helpers, and
  writes assertions on invariants rather than on snapshots of current behavior.
  Use after implementing a feature or fixing a bug, before committing.
  Scoping: default = diff vs merge-base. /luke-test apps/api | --since <ref>
---

# Luke Test Writer

Writes and updates tests for changed code. Unlike the audit skills, this one
**modifies files** — but only test files, never application code.

If, while working, it turns out the code under test has a bug, **don't fix
it**: flag it and write the test that exposes it, marking it `.fails` or
`.todo` with a comment explaining why. The decision to change the behavior
belongs to the user.

**Read `.claude/skills/luke-shared/audit-protocol.md` first** and apply the
sections its applicability table assigns to `/luke-test`: §1 scoping
(default: diff vs merge-base) and §7 concurrent sessions — you're a skill
that writes files, so §7.2 applies to you.

---

## 1. Tier map

The project has three tiers. Picking the wrong tier is the costliest mistake:
a unit test that touches the database ends up in the wrong project and fails
in CI.

| Tier            | Membership                                            | Config                                  |
| --------------- | ------------------------------------------------------ | ---------------------------------------- |
| **Unit**        | everything that does **not** match `*.integration.spec.ts` | `apps/api/vitest.config.ts`             |
| **Integration** | `apps/api/test/**/*.integration.spec.ts`                | `apps/api/vitest.integration.config.ts` |
| **Smoke E2E**   | `apps/web/tests/smoke/*.smoke.spec.ts`                  | `apps/web/playwright.config.ts`         |

Membership is **the file name**, not a list. There used to be a hand-written
list (`test/integration-specs.ts` <!-- skill-check-ignore -->), removed: a
list has an asymmetric failure mode — a missing entry is noticed right away,
but a stale entry after a rename isn't, and a suite can silently drop out of
the run.

Choice rule: **does it need a real Prisma table?**

- No → unit. Mock `ctx.prisma` with only the methods used.
- Yes → integration: name the file `<name>.integration.spec.ts` and you're in.

Commands:

```bash
pnpm test                          # unit
pnpm test:integration:local        # integration: starts the container and passes TEST_DATABASE_URL
pnpm --filter @luke/web test:e2e   # smoke, with the app stack running
```

Without `TEST_DATABASE_URL` the suite **fails**, it doesn't skip: that's
intentional — a green job with zero tests run is worse than a red job.
Values and explicit shape live in `docker-compose.test.yml`.

**Procedure coverage**: the integration suite has a gate that checks which
tRPC procedures are _actually invoked_ (`test/procedure-coverage.ts`). If you
add a procedure without a test, `pnpm test:integration` fails and prints the
entry to paste in. Don't work around it by declaring it uncovered without
reason: the gate rejects placeholder reasons.

---

## 2. Existing helpers — use these, don't reinvent them

**`apps/api/test/helpers.ts` is the single barrel: its export list _is_ the
test API. Read it there.**

This section used to list the signatures one by one and drifted: it cited
`hasTestDatabase()` months after its removal and `teardownTestDb(prisma)` <!-- skill-check-ignore -->
after the parameter had disappeared. It duplicated the codebase, and a
duplicate always rots. The fix isn't a fresher duplicate.

The modules under `test/helpers/` (`database`, `logger`, `testContext`,
`storageTestHelper`) are all re-exported from the barrel — partly because
that re-export is what makes identically-named exports collide at compile
time. If you add an export to a helper module, add it to the barrel too.

Three rules that the code itself doesn't make obvious:

1. **Never `new PrismaClient()` directly**: in Prisma 7 the constructor
   doesn't accept a URL, it needs the adapter — and a client without an
   adapter points at the development database.
2. **Missing `TEST_DATABASE_URL` = the suite fails, never skips.**
   `describe.skipIf` on database availability is forbidden: it reports the
   job green with zero tests run, which is worse than a red job. That's why
   `hasTestDatabase()` was removed instead of fixed. <!-- skill-check-ignore -->
3. **No database teardown hook.** Disconnection happens once per file, in
   the global setup (`test/setup.ts`), and isolation is by truncation.
   `teardownTestDb()` was the no-op that outlived its own callers <!-- skill-check-ignore -->: it
   was removed along with them. Don't reintroduce it.

---

## 3. Writing rules

All of these come from real breakages that already happened in this project.

### 3.1 Assert invariants, not numbers

A hardcoded count is a time bomb: it breaks the moment an action is added,
and the failure looks like a regression when it's just a stale test.

```ts
// ✗ breaks the moment `audit` gains an action
expect(auditPerms.length).toBe(2);

// ✓ derives from the source of truth
for (const [resource, actions] of Object.entries(VALID_RESOURCE_ACTIONS)) {
  expect(permissions.filter(p => p.startsWith(`${resource}:`)).length).toBe(
    actions.length + 1
  );
}
```

### 3.2 Go through the public surface, not internals

tRPC middlewares (`requirePermission`, `withSectionAccess`) return a
`MiddlewareBuilder`, not a callable function. Test them through a real
procedure — it's the production path and survives tRPC upgrades.

```ts
const probeRouter = router({
  probe: publicProcedure
    .use(requirePermission('brands:create'))
    .query(() => 'ok'),
});
await expect(probeRouter.createCaller(ctx).probe()).resolves.toBe('ok');
```

### 3.3 Mocks must be as complete as the path under test

A partial mock doesn't make the test fail: it makes it fail **for the wrong
reason**. A `logger: {}` turned an expected `FORBIDDEN` into
`INTERNAL_SERVER_ERROR`, masking what was actually going on.

Before writing a mock, follow the execution path and include **every**
method it will touch — including the ones hit by the middlewares along the
way (`ctx.logger`, `ctx.prisma.appConfig` for `getRbacConfig`, etc.).

### 3.4 Recurring timers: never `runAllTimersAsync`

On a scheduler with `setInterval`, "run all timers" doesn't terminate by
definition — vitest aborts after 10,000 iterations.

```ts
// ✗ infinite loop
vi.advanceTimersByTime(60_000);
await vi.runAllTimersAsync();

// ✓
await vi.advanceTimersByTimeAsync(60_000);
```

### 3.5 Never write tautological tests

A test that asserts "the code does what the code does," written by reading
the implementation, gives coverage without giving guarantees — and it's
worse than no test, because it looks like protection.

Before every assertion, ask yourself: **what plausible bug would make this
test fail?** If you can't answer, don't write it. Derive the expectation
from the contract (Zod schema, type, a CLAUDE.md rule, required behavior),
not from the function body.

---

## 4. What to test per type of change

| Change                        | Minimum required test                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| New tRPC procedure              | Permission granted/denied for admin, editor, viewer, anonymous                                     |
| New field on a Zod schema       | Valid input accepted, invalid input rejected with the right message                                 |
| New RBAC rule / section         | The three sources (`sectionEnum`, `SECTION_TO_PERMISSION`, `SECTION_ACCESS_DEFAULTS`) stay in sync |
| Mutation                        | `withAuditLog`/`logAudit` produces the expected audit row                                          |
| Multi-table write                | Transaction rollback leaves state consistent                                                        |
| New rate-limited route          | Present in `RATE_LIMIT_CONFIG`, `DEFAULTS` and `RateLimitConfigSchema` (see `lessons.md`)           |
| Bug fix                         | The test fails on the pre-fix code — actually verify this, don't assume it                          |

---

## 5. Output

1. Tests written or updated, with paths.
2. The actual result of `pnpm test` (and `pnpm test:integration` if touched).
   Report the output, not a paraphrase.
3. If the coverage gate asked to update `test/procedure-coverage.ts`, say so
   and show the changed entry.
4. What you did **not** cover and why — an honest list is worth more than
   inflated coverage.
5. Test files from other live sessions you left alone (§7.2), if any. Leave
   the line blank if the set was empty: it's not a section to pad.
