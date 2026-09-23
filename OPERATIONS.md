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
2. **Environment** — `LUKE_RATE_LIMIT_<BUCKET>_MAX`, `_WINDOW` and `_KEY_BY`, with
   the bucket name upper-cased (for example `LUKE_RATE_LIMIT_LOGINBYUSERNAME_MAX`).
   Consulted only when AppConfig yields no valid policy for that bucket; a
   variable left unset takes the default.
3. **Defaults** — `RATE_LIMIT_POLICY_DEFAULTS` in
   [`apps/api/src/lib/rateLimitPolicy.ts`](apps/api/src/lib/rateLimitPolicy.ts).

Consequences of that resolution:

- **The AppConfig value is validated as a whole.** If any entry fails the schema —
  a non-positive `max`, an unknown `keyBy` — no bucket takes its AppConfig
  override, and every bucket falls through to the environment or the default. A
  JSON syntax error has the same effect. The syntax error is logged as a warning;
  the schema failure is not. A time window with an invalid format affects only its
  own bucket, and is logged.
- **Omitting `keyBy` keys the bucket by IP.** For `loginByUsername`, which exists
  to limit attempts per account across many addresses, that silently removes the
  protection it is there for.
- **The environment tier sits outside the bootstrap-only environment policy** in
  `CLAUDE.md`; [ADR-018](docs/decisions/018-runtime-configuration-and-bootstrap-environment.md)
  records it as an observed gap. Its values are not validated, while AppConfig
  entries are. Prefer AppConfig.

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
many addresses is still limited per account.

### Store

- In memory and per process: one map per bucket, holding at most 1,000 keys.
- A **fixed** window starts at a key's first request and restarts once it has
  elapsed. It does not slide.
- When a map is full, the key inserted earliest is evicted, whether or not it is
  still active. The source comment calls this LRU, but eviction follows insertion
  order. With more than 1,000 distinct keys on one bucket, a counter can be
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
- **Failed mutations are stored too.** The middleware stores whatever the
  procedure returned, and tRPC hands a failure to the middleware as a result
  rather than an exception. A retry with the same key and the same input within
  five minutes therefore returns the same error without running the mutation
  again. To retry a failed operation, use a new key.
- **Requests still in flight are not deduplicated.** The result is stored only
  after the mutation completes, so two concurrent requests carrying the same key
  both execute. Preventing a second submission while the first is running is the
  client's job — for example, by disabling the submit control until the mutation
  settles.

The store is in memory and per process: at most 1,000 entries, a five-minute
TTL, expired entries removed every minute. When full it evicts the entry
inserted earliest; as with the rate-limit store, the source comment says LRU but
eviction follows insertion order. Entries are not shared between processes
(ADR-011).

Implementation: [`idempotencyTrpc.ts`](apps/api/src/lib/idempotencyTrpc.ts) and
[`idempotency.ts`](apps/api/src/lib/idempotency.ts).

---

## Error responses

In production the tRPC error formatter replaces **every** error message with
`Internal server error` ([`error.ts`](apps/api/src/lib/error.ts)). Clients and
operators must rely on `error.data.code` and `error.data.httpStatus`, not on the
message:

| Condition | `error.data.code` | HTTP |
|---|---|---|
| Rate limit exceeded | `TOO_MANY_REQUESTS` | 429 |
| Idempotency key reused with a different input | `CONFLICT` | 409 |
| Idempotency key that is not a UUID v4 | `BAD_REQUEST` | 400 |

Rate-limit errors also carry `error.data.retryAfterSeconds`. Outside production
the messages are readable, for example
`Rate limit exceeded for login. Max 5 requests per 1 minute(s).`

---

## Related documentation

- [README.md](README.md) - Main project documentation
- [API documentation](apps/api/README.md) - API reference, security headers, health and readiness checks, LDAP resilience and local tracing
- [Frontend documentation](apps/web/README.md) - Includes the client data-refresh standard after mutations
- [Archived setup snapshot](docs/archive/SETUP_STATUS.md) - Historical setup and roadmap; not current operating guidance
