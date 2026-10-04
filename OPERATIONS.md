# Luke - Operational Tuning

Operational reference for three runtime protections of the API whose behavior is
configurable, or differs from what their names suggest: the password policy,
rate limiting and idempotency. Security headers and the health and readiness
probes are documented in the [API documentation](apps/api/README.md); session
revocation is decided in [ADR-019](docs/decisions/019-tokenversion-session-revocation.md).

## Contents

- [Password policy](#password-policy)
- [Rate limiting](#rate-limiting)
- [Idempotency](#idempotency)
- [Error responses](#error-responses)
- [Related documentation](#related-documentation)

---

## Password policy

AppConfig persists values as strings: password-policy flags use `"true"` and
`"false"`, not JSON booleans. The authoritative keys and validation rules live
in [AppConfigRegistry](packages/core/src/schemas/config.ts).

`security.password.minLength` accepts integers from 8 to 128. Writes through
`saveConfig` reject values outside that range. When reading an absent or invalid
stored value, `getPasswordPolicy` falls back to the corresponding field of
`DEFAULT_PASSWORD_POLICY`; for minimum length that default is 12. A stored
value below 8 therefore falls back to 12 rather than being clamped to 8.
See [the configuration reader](apps/api/src/lib/configManager.ts).

The special-character requirement uses the explicit `PASSWORD_SPECIAL_CHARS`
allowlist in [the shared password schema](packages/core/src/schemas/password.ts).
A tilde, backtick or space does not satisfy that requirement; this does not
mean those characters are forbidden elsewhere in a password.

---

## Rate limiting

Each rate limit is a named bucket. The API resolves a bucket's policy from the
first source that yields a valid one:

1. **AppConfig** — the `rateLimit` key, a JSON object keyed by bucket name. Each
   entry is `{ "max": <positive integer>, "timeWindow": "<n>s" | "<n>m" | "<n>h",
   "keyBy": "ip" | "userId" | "username" }`, and `keyBy` defaults to `"ip"` when
   omitted. The schema is `RateLimitConfigSchema` in
   [`packages/core/src/schemas/appConfig.ts`](packages/core/src/schemas/appConfig.ts).
2. **Defaults** — `RATE_LIMIT_POLICY_DEFAULTS` in
   [`apps/api/src/lib/rateLimitPolicy.ts`](apps/api/src/lib/rateLimitPolicy.ts).

Consequences of that resolution:

- **The AppConfig value is validated as a whole.** If any entry fails the schema —
  a non-positive `max`, an unknown `keyBy` — no bucket takes its AppConfig
  override, and every bucket falls through to its default. A
  JSON syntax error has the same effect. The syntax error is logged as a warning;
  the schema failure is not. A time window with an invalid format affects only its
  own bucket, and is logged.
- **Omitting `keyBy` keys the bucket by IP.** For `loginByUsername`, which exists
  to limit attempts per account across many addresses, that silently removes the
  protection it is there for.
- **There is no environment tier.** `LUKE_RATE_LIMIT_<BUCKET>_*` variables were
  read until 2026-09-27 without validation (a non-numeric maximum disabled the
  limit) and sat outside the bootstrap-only environment policy in `CLAUDE.md`;
  they are now ignored.

### Buckets

Code defaults at the time of writing; the source of truth is
`RATE_LIMIT_POLICY_DEFAULTS`. "Development" means `isDevelopment()` is true.

| Bucket | Keyed by | Window | Max | Max in development |
|---|---|---|---:|---:|
| `login` | IP | 1m | 5 | 5 |
| `loginByUsername` | username | 15m | 10 | 10 |
| `passwordChange` | user | 15m | 3 | 3 |
| `passwordReset` | IP | 15m | 3 | 3 |
| `configMutations` | user | 1m | 20 | 100 |
| `userMutations` | user | 1m | 10 | 100 |
| `brandMutations` | user | 1m | 10 | 100 |
| `sectionAccessSet` | user | 1m | 20 | 100 |
| `pendingEmail` | IP | 15m | 10 | 100 |
| `ldapTest` | user | 15m | 3 | 100 |
| `companyStructureMutations` | user | 1m | 30 | 100 |
| `navSyncTrigger` | user | 10m | 1 | 1 |
| `exportGeneration` | user | 1m | 10 | 100 |

`auth.login` applies two buckets to the same attempt: `login` by IP and
`loginByUsername` by the submitted username, so a password spray spread across
many addresses is still limited per account. `auth.submitPendingEmail`, which
also takes a password, pairs `pendingEmail` by IP with the same
`loginByUsername` bucket: its attempts count against the account's login limit.

### Store

- In memory and per process: one map per bucket, holding at most 1,000 keys.
- A **fixed** window starts at a key's first request and restarts once it has
  elapsed. It does not slide.
- When a map is full, the key inserted earliest is evicted, whether or not it is
  still active: eviction follows insertion order, not recent use. With more than 1,000 distinct keys on one bucket, a counter can be
  dropped before its window ends.
- Expired entries are removed every 60 seconds.
- Counters are not shared between processes, which is one of the reasons
  [ADR-011](docs/decisions/011-single-instance-scaling-constraint.md) keeps the
  API single-instance.

---

## Idempotency

Mutations that chain `withIdempotency()` accept an `Idempotency-Key` header
carrying a UUID v4: `auth.login`, `me.changePassword`, `config.set`,
`config.update`, `config.setMultiple`, `users.create` and `users.update`.
Queries are never deduplicated.

- **The header is optional.** Without it the mutation runs with no protection.
- **Same key and same input within five minutes:** the stored result is returned
  and the mutation does not run again. The request is identified by a SHA-256
  hash of the method, the procedure path and the serialized input.
- **Same key, different input:** `CONFLICT` (HTTP 409).
- **A key that is not a UUID v4:** `BAD_REQUEST` (HTTP 400).
- **Only successes are stored.** tRPC hands a failure to the middleware as a
  result (`ok: false`) rather than an exception, and the middleware stores only
  `ok: true`. A retry with the same key after a failure runs the mutation again,
  whatever its input: a failed request leaves nothing to conflict with.
- **A request still in progress holds its key.** The key is reserved before the
  mutation runs, so a second request with the same key while the first is still
  running gets `CONFLICT` (HTTP 409) — same input or not — and is never executed;
  retry once the first has answered. The reservation lasts until that request
  settles, however long it takes: it does not expire, and a client disconnect
  does not end it.
- **Keys belong to the caller.** A key is filed under the session user, so two
  users never share one: neither replays the other's result nor is blocked by it.
  `auth.login`, which has no session yet, uses one anonymous scope.
- **Too many requests in progress:** with 1,000 reservations held, a request
  with a new key gets `TOO_MANY_REQUESTS` (HTTP 429); a stored result is still
  replayed and a running key still answers `CONFLICT`.

The store is in memory and per process: at most 1,000 stored results, a
five-minute TTL, expired entries removed every minute. When full it evicts the
result inserted earliest, as the rate-limit store does; reservations are kept
apart and never evicted. Nothing is shared between processes (ADR-011) and
everything is lost on restart, so this is not durable exactly-once execution: a
mutation that commits just before a crash, before its result is stored, runs
again when retried.

Implementation: [`idempotencyTrpc.ts`](apps/api/src/lib/idempotencyTrpc.ts) and
[`idempotency.ts`](apps/api/src/lib/idempotency.ts).

---

## Error responses

The tRPC error formatter ([`error.ts`](apps/api/src/lib/error.ts)) decides which
message reaches the client:

- A 4xx (`error.data.httpStatus` below 500) keeps its message in every
  environment: it is written for the caller.
- A failed input validation is a `BAD_REQUEST` whose message is the first Zod
  issue's text, not the list of every issue.
- A 5xx, including any error a procedure did not expect, reads
  `Internal server error` in production. The original message and its cause
  still reach the `tRPC error` log line.

Clients and operators branch on `error.data.code` and `error.data.httpStatus`,
never on the message text:

| Condition | `error.data.code` | HTTP |
|---|---|---|
| Rate limit exceeded | `TOO_MANY_REQUESTS` | 429 |
| Login that LDAP could not complete — which failures count is in the [API documentation](apps/api/README.md#ldap-resilience-and-authentication-fallback) | `SERVICE_UNAVAILABLE` | 503 |
| Idempotency key reused with a different input, or a request with the same key still in progress | `CONFLICT` | 409 |
| Too many idempotent requests in progress | `TOO_MANY_REQUESTS` | 429 |
| Idempotency key that is not a UUID v4 | `BAD_REQUEST` | 400 |

A `BAD_REQUEST` from a failed input parse also carries `error.data.zodIssues` —
every issue as `{ path, message }`, the path in full (`data.retailMultiplier`),
where the message keeps only the first; a 5xx never carries it.

Rate-limit errors also carry `error.data.retryAfterSeconds` — the bucket's whole
window, not the time left; the idempotency 429 does not. Their message is a
generic `Troppe richieste. Riprova più tardi.`: a 4xx reaches every client, so
the bucket and its limit are logged instead (`Rate limit exceeded`, with
`routeName`, `key` — the client IP or the account —, `max`, `windowMs`). A `requirePermission` refusal likewise reads
`Accesso negato`, the requested permissions going to the `Permission denied` log
line; an `adminProcedure` refusal reads the same and logs nothing (ADR-026,
observed gaps).

A second, global limiter runs before tRPC (`@fastify/rate-limit` in
`apps/api/src/server.ts`: 100 requests per minute per IP in production, not
configurable through the `rateLimit` key). Its 429 has its own body —
`{ statusCode, error, message, retryAfter }` — and no `error.data.code`.

---

## Related documentation

- [README.md](README.md) - Main project documentation
- [API documentation](apps/api/README.md) - API reference, security headers, health and readiness checks, LDAP resilience, [recovering administrator access](apps/api/README.md#recovering-administrator-access) when nobody can sign in, and local tracing
- [Frontend documentation](apps/web/README.md) - Includes the client data-refresh standard after mutations
- [Archived setup snapshot](docs/archive/SETUP_STATUS.md) - Historical setup and roadmap; not current operating guidance
