# Lessons Log

Rules born from corrections received during development. Every time Claude
gets corrected, it adds a rule here to avoid repeating the mistake
(see CLAUDE.md → Rules of engagement).

Format: `## <rule in one line>` under the right category, with context,
root cause and fix. New categories allowed when needed.

---

## TypeScript & Next.js

### `as any` forbidden — use `as Route` for redirects with typedRoutes

With `typedRoutes: true` in `next.config.js`, `redirect()` requires a `Route`
type. For paths valid at runtime but not in the static manifest (e.g. route
group `(app)`), use:

```typescript
import type { Route } from 'next';
redirect('/app/dashboard' as Route);
```

Never `as any` — violates strict mode. Pattern already used in `NotificationDropdown.tsx`.

### Bare `crypto.randomUUID()` in a client component crashes outside a secure context

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

---

## Prisma & PostgreSQL

### Soft-delete + slug uniqueness: use a PostgreSQL partial index

When a model has soft-delete (`isActive: Boolean`) and a slug that must stay
unique among active records, the correct solution is a **PostgreSQL partial
unique index**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "company_functions_slug_active_key"
  ON "company_functions"("slug") WHERE "isActive" = true;
```

Prisma doesn't support partial indexes in its DSL — it has to be added by
hand in the migration SQL. Remove `@unique` from the slug in schema.prisma
and add `@@index([slug])` for queries.

In the router, add an explicit guard in `create` (distinguishes
active-slug vs. deactivated-slug with a clear message) and a `restore`
procedure with an anti-collision check.

**DB-agnostic alternative** (if the DB ever changes): on soft-delete, null
out the slug and save it in `slugOriginal`. `NULL != NULL` in SQL → `@unique`
works across every DB. For now this is over-engineering: the project is
locked to PostgreSQL.

### `prisma migrate deploy` on the local dev DB can get stuck on drift with `db push`

The workflow for new migrations uses `db push` (port 5432) — this does NOT
write to `_prisma_migrations`. If `migrate deploy` was run on the same DB in
the past, it can fail halfway through, leaving a row with
`finished_at = NULL` that blocks every subsequent deploy.

Full diagnosis and fix: `docs/prisma-migration-workflow.md` → Troubleshooting.
Rule: never `resolve --applied` without having verified that the DB actually
reflects that state.

---

## tRPC & Fastify

### tRPC 11.18 + Fastify: UNSUPPORTED_MEDIA_TYPE / Unable to transform

**Problem**: upgrading tRPC 11.8→11.18 introduces the JSONL streaming
protocol (`trpc-accept: application/jsonl`). Both `httpBatchLink` and
`httpBatchStreamLink` throw runtime errors.

**Root cause**: tRPC 11.18 adds an `isDataStream()` check — it throws
`UNSUPPORTED_MEDIA_TYPE` if a procedure returns an object with `Promise` or
`AsyncIterable` values on a non-streaming path. The Fastify custom
content-type parser interferes with `incomingMessageToRequest`.

**Fix**: use `httpBatchStreamLink` (imported from `@trpc/client`, not
`@trpc/react-query`) + add an explicit `trpc-accept: application/jsonl`
header in the client's custom headers. Investigate which procedure returns
non-awaited Promise-valued fields.

---

## Dependencies

### Don't duplicate libraries for the same purpose

If a library is already installed in the project (e.g. `pdfmake`), use it —
never add another one that does the same thing (e.g. `pdfkit`). Always check
`package.json` before installing new dependencies.

---

## Rate Limiting

### New rate-limited route: update BOTH maps (drift = runtime crash)

Rate limiting lives in two separate maps that must stay in sync:

- `RATE_LIMIT_CONFIG` in `apps/api/src/lib/ratelimit.ts` — consumed by `withRateLimit(routeName)`.
- `DEFAULTS` in `apps/api/src/lib/rateLimitPolicy.ts` — consumed by `resolveRateLimitPolicy()` (cascade AppConfig → ENV → default).

`withRateLimit('foo')` calls `resolveRateLimitPolicy('foo')`: if `foo` exists
only in `RATE_LIMIT_CONFIG` but NOT in `DEFAULTS`, `DEFAULTS[routeName]` is
`undefined` → `def.max` throws
`Cannot read properties of undefined (reading 'max')` at runtime (not at
compile time: the cast at the call site hides the drift from TypeScript).

**Rule**: every new rate-limited route must be added in THREE places, kept
in sync:
1. `RATE_LIMIT_CONFIG` (`ratelimit.ts`)
2. `DEFAULTS` (`rateLimitPolicy.ts`) — **mandatory, otherwise a crash**
3. `RateLimitConfigSchema` (`packages/core/src/schemas/appConfig.ts`) — `.optional()` field, otherwise an AppConfig/ENV override is silently ignored by the resolver.

Real regression: `navSyncTrigger` missing from `DEFAULTS` → NAV vendor sync
crashing in production (hotfix v1.9.1).

### A `keyBy: 'ip'` bucket on a server-to-server call is silently useless

**Problem**: a Strix pentest against RC reports `/api/auth/callback/credentials`
with no observable throttling (18 attempts, all `200 OK`, no `429`).

**Root cause**: `auth.login` already had `withRateLimit('login')` (5/60s,
`keyBy: 'ip'`), but `apps/web/src/auth.ts` calls `auth.login`
**server-to-server** (direct fetch to `INTERNAL_API_URL`, doesn't go through
the reverse proxy). Without explicitly forwarding the original client's IP,
`ctx.req.ip` on apps/api always resolves to the same internal address (the
web container) for **any** user — a bucket shared by the whole app instead
of being per-attacker. On top of that, NextAuth v5 always responds `200`
when `authorize()` returns `null`, so even a limiter that does trigger is
invisible from the outside: the pentest's observation doesn't prove the
protection is missing, it only proves the signal doesn't cross that boundary.

**Rule**: a `keyBy: 'ip'` bucket added on an endpoint also reachable via a
server-to-server call (not just browser→proxy→api) must always come with
(1) explicit forwarding of the real IP on that internal call and (2) a test
that demonstrates *per-attacker* behavior — a test on the config's shape
isn't enough. See `apps/api/test/ratelimit.integration.spec.ts`, describe
`blocks valid credentials too`, and CLAUDE.md → Development Patterns #12/#13.

### Login endpoint: an IP bucket alone doesn't stop password-spray

A `keyBy: 'ip'` bucket stops an attacker hammering a single IP, but not a
spray distributed across many IPs against a single account. Login (and
every credential-verification endpoint) must **always** have a second
`keyBy` bucket on identity (username/account) in addition to the IP one.
Pattern: `login` + `loginByUsername` in `apps/api/src/lib/ratelimit.ts` —
the second bucket is checked directly inside `authenticateUser()`
(`auth.service.ts`), not via `withRateLimit()`, because the key (username)
lives in the procedure's input, not in `ctx`.

## Pentest / External Security

### Strix (or other) scans must be pointed ONLY at real deployed hostnames

**Problem**: a Strix scan against `http://host.docker.internal:3000` reported
"development mode information disclosure" (stack trace, absolute paths,
`next-devtools` exposed).

**Root cause**: the scanner was running inside a Docker container on the
same machine as the developer; `host.docker.internal` is the Docker Desktop
alias that resolves to the host — it simply reached the local `pnpm dev`
(`next dev`, dev mode by design), not a real environment. Verified:
Dockerfile/every `docker-compose*.yml`/CI always build `next build` +
`next start` with `NODE_ENV=production`; no real deploy path can ever serve
dev mode.

**Rule**: a security scan must **always** be pointed at a genuinely deployed
hostname (`rc.luke.febos.local`, prod domain), never at
`localhost`/`host.docker.internal`. A "development mode disclosure" against
either of these is a false positive by construction, not a finding to triage.

## Integration Tests

### Test file order is neither alphabetical nor stable

Vitest has its own sequencer: two runs on different machines can execute
files in a different order. Any suite that assumes "another one has already
created the tables" or "another one has already cleaned the data" works
**by accident**.

Real regression: the `integration` CI job failed on its very first run with
40 red tests, while it had been passing locally for months. Two causes, both
invisible on an already-populated database:

- `resetTestData()` memoized the table list **even when empty**. On a
  database with no schema the query returned zero rows, they got memoized,
  and from then on the function was a silent no-op for the rest of the
  file: tests ran without isolation and collided on fixed-code data.
- four suites built fixtures with `createTestPrismaClient()` in `beforeAll`,
  before any `ensureTestSchema()`.

**Rules**:

1. An integration suite gets its client **only** from `setupTestDb()` or
   `createTestContext()` — never from `createTestPrismaClient()` directly.
   Both guarantee the schema and truncate.
2. Never memoize an empty result if empty is a transient state: either
   guarantee the precondition before computing it, or don't memoize it.
3. An isolation helper that fails to isolate must **throw**, not proceed:
   tests without isolation pass green and prove nothing.
4. Before declaring an integration suite green, run it at least once against
   a pristine database (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).
   A development DB accumulates state that masks ordering dependencies.

## CI / Security Gates

### A `schedule` job only runs if the workflow exists on the default branch

GitHub runs `schedule` triggers using the workflow files from the **default
branch**, not the branch where the file was written. A `cron` on a workflow
that only lives on a development branch never fires, and produces no error:
there's simply no execution at all.

Real regression: `security.yml` had `osv-push` with
`continue-on-error: true` ("report-only on pushes") and a blocking
`osv-weekly`, with the comment *"the weekly failure is the real signal"*.
But `security.yml` only existed on `develop-2.1`, never on `main`: across 24
workflow executions, zero came from `schedule`. The only job that ran was
deliberately non-blocking, and the blocking one had no file to run from. 24
known vulnerabilities went unnoticed — 3 critical (CVSS 9.1) in
`next-auth`/`@auth/core`, including an authentication bypass via homoglyphs
in email normalization.

**Rules**:

1. Before relying on a `schedule` for a check, verify the workflow is on the
   default branch: `git ls-tree --name-only origin/main .github/workflows/`.
2. Check that it actually fired at least once:
   `gh run list --workflow <name> --limit 30 --json event -q '.[].event' | sort | uniq -c`.
   Zero `schedule` events means the gate doesn't exist.
3. `continue-on-error: true` on a security job must be paired with a gate
   that actually blocks, and that gate must be verified in execution — not
   just written.
4. A workflow that shows `success` doesn't mean its jobs passed:
   `continue-on-error` masks the failure at the run level. Look at the jobs:
   `gh run view <id> --json jobs -q '.jobs[] | "\(.conclusion)\t\(.name)"'`.

### pnpm `overrides` can pin a vulnerable version

`pnpm-workspace.yaml` contained `brace-expansion@1: '1.1.16'` and similar,
added to deduplicate. When GHSA-mh99-v99m-4gvg came out (range `<= 5.0.7`,
fix only in 5.0.8) the override kept forcing the vulnerable version, and
`pnpm update` couldn't do anything about it: the override wins.

**Rule**: an override that pins an **exact** version is debt with an
expiry date. If you pin, pin a range (`'>=x.y.z'`) and review the overrides
on every `pnpm security:deps` finding.

### Negations in `.gitignore` don't reach inside an excluded directory

`.gitignore` contained `.claude/`. Adding `!.claude/skills/**` below that
line **would not** have worked: a pattern that excludes a directory makes
git skip traversing it entirely, and no negation inside it can re-include
anything. The fix would have been written, committed, and silently inert —
with the skills still outside git.

The correct form excludes the **content** one level below, because `*`
doesn't match `/`:

```gitignore
.claude/*
!.claude/skills/
!.claude/hooks/
!.claude/settings.json
.claude/settings.local.json
```

**Rules**:

1. To re-include something inside an ignored directory, exclude `dir/*`,
   never `dir/`.
2. Always verify with the **exit code**, not the output:
   `git check-ignore -v` prints the rule even when it's a negation (prefixed
   `!`), so "it printed something" doesn't mean "it's ignored". Use
   `git check-ignore -q <file>` — 0 = ignored, 1 = trackable.
3. Final cross-check: `git add -An <dir>` lists exactly what would be staged.

### A skill with `agent: Explore` cannot invoke subagents

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

### A test that starts from a sub-router skips composition

`brand.integration.spec.ts` used `brandRouter.createCaller(ctx)`. But
`router({ brand: brandRouter })` does **not** preserve `brandRouter`:
`createRouterFactory` rebuilds an aggregate from it, and the imported
sub-router keeps its own separate `_def.procedures` map. The test was
therefore exercising a path production never takes — production always
enters through `appRouter`.

Found by the procedure-coverage gate, which measures invocations against
`appRouter`: the best-tested router in the repo showed up as 7/7 not invoked.

**Rule**: in tRPC tests, build the caller from `appRouter` and descend to
the namespace (`appRouter.createCaller(ctx).brand`), never from the
imported sub-router. Call-site shape stays identical.

### A checker that reads local state passes locally and fails in CI

`check-skill-integrity.ts` checked the existence of paths cited by the
skills. `luke-docs` cites `.planning/ROADMAP.md`, which `.gitignore`
excludes: it exists on the disk of whoever's working, not in a clean
checkout. Green locally, red on the first push — inside the very script
written to catch checks that read the wrong world.

**Rule**: a verification script must only make claims about what the repo
actually contains. If a path is excluded from git, its existence isn't a
verifiable fact: `git check-ignore -q -- <path>` (exit 0 = ignored) and skip it.

It took **three red CI runs**, and each relapse added one more detail.

1. *Applying the rule halfway.* `check-docs-integrity.ts` used it to choose
   which files to read (`git ls-files`), `check-skill-integrity.ts` didn't
   use it at all. After fixing the second one, the first kept checking the
   **link targets** that were ignored. A rule shared by two scripts belongs
   in one single place — now `tools/scripts/lib/gitPaths.ts`.
2. *The trailing slash.* A directory-only pattern (`docs/access-porting/`)
   only matches if git can establish the path is a directory. When the path
   **doesn't exist** — the exact case at stake here — it can't, and it needs
   to be passed with the slash. `path.resolve()` strips it:

   ```
   docs/access-porting    → exit 1, doesn't match
   docs/access-porting/   → exit 0, matches
   ```

3. *Verifying where it can't fail isn't verifying.* The first two fixes
   were declared green by running on the development disk, which has the
   gitignored files. Reproducing a clean checkout is one line:

   ```bash
   git worktree add --detach /tmp/clean HEAD   # by construction, no ignored files
   ```

Corollary: before declaring a new check green, ask *what files am I reading
that a clean clone wouldn't have* — and then actually try it on a clean
clone, instead of answering from memory.

---

### A new lint rule must be probed on a bait file, not on the repo

Wrote `brand-scope-required.yml`, ran it on `apps/api/src`, zero findings,
declared done. Wrong three times in a row, and each time the zero looked
like proof it worked.

1. *Invalid YAML.* The pattern contained an unquoted
   `{ ..., brandId: $Z, ... }`, and the colon breaks the scalar. Semgrep
   responded `invalid configuration file found` on stderr and exited **0**:
   the command looked like it passed and the rule wasn't running at all.
2. *A `pattern-not` that doesn't exclude.* With
   `<... assertBrandAccess(...) ...>` semgrep also flagged procedures that
   were already correctly guarded. `metavariable-pattern` changed nothing.
   `pattern-not-regex`, textual on the matched region, worked.
3. *A literal alternative instead of the family.* `assertBrandAccess` as an
   exact string kept flagging code guarded by `resolveRowBrandAccess`.
   Needed `BrandAccess`.

Points 2 and 3 are the worst variant: **false positives on a blocking
rule**. A rule that flags correct code gets disabled within a week, so it's
worse than not having one.

**Rule**: before considering a semgrep rule finished, probe it on a bait
file that contains *both* cases — the vulnerable one and the already-fixed
one — and it must give exactly 1 finding and 0. Zero findings on the real
repo doesn't distinguish "no violation" from "the rule isn't running".

```bash
mkdir -p /tmp/probe/apps/api/src/routers && $EDITOR /tmp/probe/.../bad.ts
cd /tmp/probe && semgrep --config <rule> .    # expected: 1 finding, on the broken case
```

Corollary that paid off immediately: as soon as the rule started actually
working it found five procedures in `merchandisingPlan.ts` and
`phaseAlert.ts` that neither the audit nor the plan had enumerated.

---

### `vi.mock` doesn't always intercept: assert on the effect, not on the spy

In the company logo test, `vi.mock('../src/storage', ...)` never reached the
import of `deleteObjectByKey` done by `routers/company.ts` — not with that
specifier nor with `'../src/storage/index.js'`. The router called the real
function, the best-effort `catch` swallowed it, and the spy stayed at zero
calls. Diagnosed only by putting `(fn as any)._isMockFunction` inside a
temporary throw.

**Rule**: when a module mock doesn't intercept, before fighting resolution
it's worth asking whether the effect is observable elsewhere.
`deleteObjectByKey` also deletes the `FileObject` row, so

```ts
expect(await prisma.fileObject.findUnique({ where: { id } })).toBeNull();
```

is shorter than fighting the mock **and** stronger: it proves the real
function ran, not that a stub was called.

Only applies when the effect is real and observable. If the collaborator is
genuinely external (network, SMTP), the mock remains the only way and has
to be made to work.

### A `cd dir && command` changes the cwd for the commands that follow too

After `cd apps/api && npx tsc -b`, the bash cwd stayed `apps/api/` for the
next command (`grep -r apps/api ...`), which then searched
`apps/api/apps/api` — a nonexistent path, silenced by `2>/dev/null`, and the
"0 matches" result got read as "cleanup complete". Reported back to the user
"apps/api: 0 leftovers, work complete" when in reality ~30 files remained
with untranslated Italian comments — discovered only because the user
manually opened `server.ts` and found Italian comments in it.

**Rule**: never `cd dir && command`. Use `(cd dir && command)` in a
subshell, or pass the path directly to the tool (`npx tsc -b apps/api`), or
return to root immediately after. Every verification check that follows a
`cd`-containing command must use absolute paths, not paths relative to the
assumed cwd — especially before declaring a piece of work "complete" to the
user.

---

## Release / Docker

### Never build the Docker image locally to "validate before commit"

A hotfix plan (image resizing via `sharp`) included as a mandatory step a
local `docker build` of the full Dockerfile to verify the native binary
before commit. The user stopped it: **Docker builds are "GitHub online
stuff"** — they happen in CI (`.github/workflows/release.yml` → build+push
to `ghcr.io` on tag), not on the development machine. The local attempt also
exposed why it's the wrong path: building the entire monorepo inside Docker
Desktop (limited resources compared to the host machine) went OOM in the
`tsc` phase of `@luke/api`, a failure completely unrelated to the native
binary that was supposed to be checked — noise, not signal.

**Rule**: don't propose/run a local `docker build` as a pre-commit
validation step. The real build (and the only place where a dependency's
native binary like `sharp` actually gets verified) is the CI pipeline
triggered by the `vX.Y.Z` tag push. To de-risk native dependencies before
commit, check statically instead (Dockerfile base image, `pnpm-workspace.yaml`
overrides/allowBuilds, target arch in `docker/build-push-action`) and then
trust CI as the real gate.

## Branch management

### A `develop-X.Y` merged into `main` is dead — never reactivate it

During the `deepmerge-ts` hotfix (GHSA-ggr8-5vv4-36mx) I had proposed also
porting the fix to `develop-2.1`, treating it as an active integration
branch. The user corrected this: `develop-2.1` is dormant — its last commit
(`31ed3cb`, 2026-08-09) is the merge-into-main, and `main` has since
accumulated further commits that never landed on that branch (`ca71324` CI
notify, `603662a` deepmerge fix, `6598c41`/`e43f66c`/`f416c52` sharp/vitest,
`416b918`/`4e55e5f` OOM export fix). Not a valid backport target.

Correction to this same note (2026-08-25): the first draft listed "storage
validation" and "migration script" among these commits — wrong, verified
with `git branch -a --contains <hash>`: those two commits only live on
orphaned remote branches (`hotfix/deepmerge-ts-dos`,
`ci/security-failure-notification`), never on `main` nor on `develop-2.1`.
Before citing specific commits in a lesson, verify their branch membership
with `--contains`, don't trust reconstructing it from memory of the graph.

**General rule — `develop-X.Y` lifecycle**: born cut from `main`, receives
the cycle's features, dies the moment it's merged into `main` (release).
From there it's single-use: it's not reopened, not backported onto, not
treated as "still in development" just because the branch still exists in
`git branch -a`. The next cycle opens a new `develop-(X+1)`, cut from an
updated `main` — never from the same `develop-X.Y` resurrected. Before
proposing a backport onto a `develop-*` branch, check with
`git log --oneline develop-X..main` (and vice versa) whether it's still
aligned or abandoned after merge: a branch stuck at an old merge commit is
stale by default, not the other way around. The dead branch should then be
deleted (local + remote) as soon as its successor is cut — see CLAUDE.md §
Versioning & Release for the steps (update `branches` in
`ci.yml`/`security.yml`, delete the previous one; `dependabot.yml` isn't
involved, it always targets the default `main`).
