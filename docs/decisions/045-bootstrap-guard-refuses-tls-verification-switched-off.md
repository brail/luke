# ADR-045 — Bootstrap Guard Refuses TLS Verification Switched Off

## Status

Accepted

## Context

[ADR-018](018-runtime-configuration-and-bootstrap-environment.md) describes `assertEnvPolicy`, the first
step of the API's start, as a denylist of variable names: a variable that matches no pattern in
`FORBIDDEN_ENV_PATTERNS` passes.

`NODE_TLS_REJECT_UNAUTHORIZED` matches no pattern. Set to `0`, it makes Node skip TLS certificate
verification for every client that sets no `rejectUnauthorized` of its own: in apps/api, among
others, SMTP, S3 storage and the Google APIs. The LDAP clients set `rejectUnauthorized: true` explicitly
(`ldapClientOptions`, #281) and keep verifying. Nothing in the repository sets the variable; a
deployment could, and nothing would say so (#283).

## Decision

- **A value check beside the names.** `assertEnvPolicy` (`apps/api/src/lib/envPolicy.ts`) also
  refuses `NODE_TLS_REJECT_UNAUTHORIZED` when its value is exactly `0`, the only value with which
  Node turns verification off (`getAllowUnauthorized` in Node's `lib/internal/options.js`). Any other
  value, the empty string included, keeps Node verifying and passes without a warning.
- **The same posture as the names.** In production the API server refuses to start: the guard throws
  `EnvPolicyError` and `start()` exits 1, with a message that names the variable and the remedy
  (remove it, configure trusted certificates). Outside production it logs a warning.
- **The names stay a denylist.** `FORBIDDEN_ENV_PATTERNS` and ADR-018's rule for them are unchanged.

Owner decision #103 a, 2026-11-21: refuse at boot, over a log warning or leaving it.

## Consequences

- A production deployment that sets the variable to `0` stops starting. None is known. The variable
  was never in the permitted list of `CLAUDE.md` "Env Policy", so this is not a breaking change of a
  supported contract.
- The guard covers the API server's start only. `entrypoint.sh` runs `prisma migrate deploy` before
  it, and the `db:*` scripts and seeds have their own entry points; none of them pass through it.
- apps/web runs no equivalent check (ADR-018); its server-side fetches read the same variable. The
  follow-up is tracked in #283.
- `apps/api/test/envPolicy.spec.ts` covers the function; `apps/api/test/envPolicyBoot.spec.ts` starts
  the server in production with the variable set and expects exit 1.

## Errata

Appended under [ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md); the sections above are unchanged.

- **2026-11-22 — Decision, the value check, and Consequences, "apps/web runs no equivalent check".** As of the commit that adds this entry, the check and its message are `tlsVerificationOffProblem` in `@luke/core` (`packages/core/src/runtime/tlsVerification.ts`), which `assertEnvPolicy` calls; apps/api's behaviour is unchanged. apps/web now refuses the same value at its server start ([ADR-046](046-web-server-refuses-tls-verification-switched-off.md)).
