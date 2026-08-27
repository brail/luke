# Verification matrix — what each dependency can silently break

Companion to `.claude/skills/luke-deps/SKILL.md` §3 and §4.

A package listed here is **never verified by types plus unit tests alone**. The
last column is the level-4 proof: the thing you actually run, whose failure mode
no compiler and no CI job in `.github/workflows/ci.yml` would surface.

Not exhaustive by design. A package absent from this table is not proven safe —
it is unproven. If a bump on an unlisted package breaks something in a way the
ladder missed, add the row.

---

## Tier 1 — security-load-bearing

A regression here is a vulnerability, not a bug. Level 4 is mandatory.

| Package                                                                       | Invariant at risk                                                              | Why levels 0–3 miss it                                                                                                                                                                                           | Level-4 proof                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fastify`, `@fastify/rate-limit`                                              | client IP resolution → per-attacker rate-limit buckets (CLAUDE.md rules 12–13) | 5.12 kept the numeric `trustProxy` option's _type_ and stopped honoring its _value_, failing closed to untrusted. The existing suite stubbed `req.ip` on a fake context and never exercised fastify's resolution | HTTP-level inject with real `X-Forwarded-For` chains — see `apps/api/test/ratelimit.integration.spec.ts` and the shared definition in `apps/api/src/lib/trustProxy.ts`. Assert a spoofed hop does **not** become `req.ip` |
| `argon2`                                                                      | password hashing and verification                                              | 0.45 renamed the exported options type; a compile-clean call can still hash with different parameters                                                                                                            | Real round trip: hash, verify correct password → true, verify wrong password → false. `apps/api/src/lib/password.ts`, `apps/api/src/lib/backup/crypto.ts`                                                                 |
| `jsonwebtoken`, `next-auth`                                                   | session issuance, token verification, cookie flags                             | signature and claim-validation defaults change between majors without changing call signatures                                                                                                                   | Issue a token, verify it, then verify a tampered one fails. Check cookie attributes on a real login response                                                                                                              |
| `ldapts`                                                                      | the four `auth.strategy` modes and the circuit breaker                         | connection and TLS defaults shift silently; unit tests mock the client                                                                                                                                           | Real bind against the configured directory, plus a forced-failure path to confirm the breaker still opens                                                                                                                 |
| `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` | presigned URL validity, bucket scoping, preserved `Content-Type`               | SDK majors change default checksum and signing behavior; a wrong-but-well-typed request 200s in the mock                                                                                                         | Upload → fetch by presigned URL → assert bytes and `Content-Type` survive                                                                                                                                                 |
| overrides in `pnpm-workspace.yaml`                                            | the advisory the override exists to close                                      | nothing checks that an override still resolves to a patched version                                                                                                                                              | `pnpm why <pkg>` plus `pnpm security:deps` exit code                                                                                                                                                                      |

## Tier 2 — runtime behavior

Same shape, different behavior. Level 3 minimum, level 4 where noted.

| Package                                                | Invariant at risk                                                                                                | Proof                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@fastify/multipart`                                   | upload streaming under `files: 1`; a second part can tear down the first mid-read (`Premature close`, 200 → 500) | the multipart-heavy suite, `apps/api/test/brandLogo.routes.integration.spec.ts` — a full integration run, not a filtered one                                                                                                   |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` | migration application and schema/migrations agreement                                                            | `prisma migrate deploy` from scratch + `prisma migrate diff --exit-code`, as the `migrations` job in `.github/workflows/ci.yml` runs them. Workflow: `docs/prisma-migration-workflow.md`. Keep the whole family on one version |
| `mssql`                                                | NAV sync: the `tedious` driver, pool behavior, and the 60s request timeout                                       | a real sync run against NAV via `packages/nav/src/client.ts`; assert batching and timeout still hold                                                                                                                           |
| `sharp`                                                | native binary per platform/arch; the asset derivative pipeline                                                   | derivative generation on a real image. Do **not** validate with a local `docker build` (`lessons.md`) — check the base image, `allowBuilds` and `overrides` statically, then let the release workflow be the gate              |
| `@opentelemetry/*`, `@fastify/otel`, `@grpc/grpc-js`   | the SDK actually registering; a dead exporter is invisible                                                       | boot `apps/api` and confirm spans are produced — `apps/api/src/instrument.ts`. The deprecated `@opentelemetry/instrumentation-fastify` was never _outdated_, only abandoned                                                    |
| `@trpc/server`, `@trpc/client`, `@trpc/react-query`    | wire format and router typing across `apps/api`, `apps/web`, root                                                | bump the family together, then `cd apps/api && npx tsc -b` before typechecking `apps/web` — otherwise web still sees the old shape                                                                                             |
| `zod`                                                  | every schema in `packages/core/src/schemas` and therefore every tRPC input                                       | full unit suite plus one real invalid-input rejection through a live procedure                                                                                                                                                 |
| `pdfmake`, `exceljs`                                   | export output                                                                                                    | generate one real file and open it. Never add a second library for the same job (`lessons.md`)                                                                                                                                 |
| `googleapis`, `ical-generator`                         | calendar sync and ICS output                                                                                     | a real ICS generation; auth path against Google if credentials are configured                                                                                                                                                  |

## Tier 3 — build and tooling

Failure is loud, but usually _after_ commit.

| Package                                                          | Watch for                                                                            | Proof                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `next`, `react`, `react-dom`, `eslint-config-next`               | build output, typed routes, RSC boundaries                                           | `pnpm --filter @luke/web build` plus the Playwright smoke project (`apps/web/tests/smoke`)                                                                                                                   |
| `typescript`, `@typescript-eslint/*`                             | peer ranges gate the whole toolchain                                                 | read the peer range before bumping either. TS 7 was held in `308256f` because `@typescript-eslint` capped below it and type-aware linting depends on a stable programmatic API                               |
| `eslint`, `eslint-plugin-import-x`, `eslint-plugin-luke`         | flat-config resolution; a plugin that stops loading fails **open**, not red          | after the bump, confirm the custom rules still fire on a deliberately bad line — a lint that reports nothing is not the same as a clean repo (`lessons.md`, "A new lint rule must be probed on a bait file") |
| `vitest`                                                         | config resolution across the unit and integration projects                           | check the **test count**, not the exit code. A runner that discovers zero tests exits green                                                                                                                  |
| `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `autoprefixer` | generated CSS, theme variables                                                       | visual check of one page; confirm CSS-variable colors still resolve                                                                                                                                          |
| `turbo`                                                          | task graph and cache correctness                                                     | one clean run with the cache disabled; stale-cache symptoms look like source bugs                                                                                                                            |
| `recharts`                                                       | shadcn's chart component is CLI-managed and lags the library                         | held in `308256f`: the registry entry was not updated for v3, and hand-patching a CLI-managed component is the wrong trade. Unblocks when the shadcn registry ships a v3 chart entry                         |
| `@radix-ui/*`                                                    | only ever bumped as the version shadcn expects — never imported directly (CLAUDE.md) | shadcn component smoke check                                                                                                                                                                                 |

---

## Cross-cutting checks

**ESM-only packages in a CJS app.** `apps/api` is CJS. An ESM-only major
(`p-limit` 7) works through Node's `require(esm)` interop, stable since Node
22.12 and well under the current base image — but _works at import time_ is not
_works_. Exercise the imported function end-to-end. If interop is unavailable,
the failure is a runtime `ERR_REQUIRE_ESM`, invisible to typecheck.

**Peer ranges before majors.** `pnpm install` output names the conflict. Read
it — a peer warning accepted today is the toolchain wedged tomorrow.

**Type-only packages** (`@types/*`) still change behavior indirectly: a stricter
`@types/node` can force real code edits (`58ee16e`). Bump them with their
runtime counterpart, not separately.

**The family rule.** Some packages only make sense in lockstep: the prisma
family, the `@trpc/*` family, `react` + `react-dom` + their types,
`@opentelemetry/*`. Bumping one alone is a version-skew bug with a clean
typecheck.
