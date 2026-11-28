# Luke - Operational Tuning

Operational reference for the API's runtime protections whose behavior is
configurable, or differs from what their names suggest — the password policy,
rate limiting, idempotency and error responses — and for five operator tasks:
signing in when LDAP is unreachable, ending maintenance without the web, email
deliverability, the reverse proxy's network and the release build's repository
variables. Security headers and
the health and readiness probes are documented in the
[API documentation](apps/api/README.md); session revocation is decided in
[ADR-052](docs/decisions/052-session-revocation-pushed-and-one-sign-out-signal.md),
which supersedes ADR-048 (itself superseding ADR-039).

## Contents

- [Password policy](#password-policy)
- [Rate limiting](#rate-limiting)
- [Idempotency](#idempotency)
- [Error responses](#error-responses)
- [Signing in when LDAP is unreachable](#signing-in-when-ldap-is-unreachable)
- [Ending maintenance without the web](#ending-maintenance-without-the-web)
- [Email deliverability](#email-deliverability)
- [Reverse proxy](#reverse-proxy)
- [Release build variables](#release-build-variables)
- [Purging a test brand or season](#purging-a-test-brand-or-season)
- [Restore drill on the RC](#restore-drill-on-the-rc)
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

The seed (`db:seed`, and `db:bootstrap` through it) writes a `rateLimit` row with
production values for `login`, `passwordChange`, `passwordReset`,
`configMutations` (20) and `userMutations` (10), so on a seeded database those
buckets hold those values in development too. No settings page edits the row,
and the generic `config.*` writers refuse its prefix: it is changed in the
database.

Consequences of that resolution:

- **Each bucket's entry is validated on its own.** An entry that fails the schema —
  a non-positive `max`, an unknown `keyBy`, a `timeWindow` in another format or
  unit (`1x`, `2d`), of zero (`0m`) or with a numeral too long to compute — leaves
  only its own bucket on the default, and the warning names the bucket. A JSON
  syntax error, or a value that is not an object, leaves every bucket on its
  default, with a warning. A key that names no bucket is ignored.
- **`keyBy` must suit the endpoint.** Omitted, it means `ip`. `userId` on a
  bucket whose endpoint has no session (`login`, `passwordReset`,
  `pendingEmail`), or `username` on any bucket but `loginByUsername`, leaves the
  bucket unable to derive its key: every request through it fails with
  `INTERNAL_SERVER_ERROR` (`Rate limit check failed`).
- **`loginByUsername` is always keyed by the submitted username**, lower-cased,
  whatever its `keyBy` says: an override changes only its `max` and
  `timeWindow`.
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
| `navSyncTrigger` | user and NAV entity | 10m | 1 | 1 |
| `exportGeneration` | user | 1m | 10 | 100 |
| `googleOAuthExchange` | IP | 15m | 10 | 100 |

`auth.login` applies two buckets to the same attempt: `login` by IP and
`loginByUsername` by the submitted username, so a password spray spread across
many addresses is still limited per account. The other public endpoints that
verify the account's current password pair an IP bucket with the same
`loginByUsername` bucket, so their attempts count against the account's login
limit: `auth.submitPendingEmail` (`pendingEmail`) and `auth.resendVerification`
(`passwordReset`). `me.changeEmail`, which asks a signed-in user for the current
password, applies `login` by IP and `userMutations` by user, and counts against
the same `loginByUsername` bucket: a mistyped password on the profile page uses
up the account's login attempts.

Only the IP bucket is answered as a rate limit before the password is proven:
`TOO_MANY_REQUESTS` with `retryAfterSeconds` in the error data, which the web
turns into a `429` with `Retry-After`. A full `loginByUsername` bucket answers
a public endpoint like a wrong password (`UNAUTHORIZED`, the one sign-in refusal
text), so a sprayer cannot tell which accounts it has reached; the
`AUTH_LOGIN_FAILED` audit row records it as `rate_limited_username`. On
`me.changeEmail`, signed in, it is `TOO_MANY_REQUESTS`.

`integrations.google.exchangeOAuthCode`, which checks the
OAuth `state`, pairs `googleOAuthExchange` by IP with `configMutations` by
account.

### Store

- In memory and per process: one map per bucket, holding at most 999 keys —
  the insert that brings a map to 1,000 evicts its earliest key.
- A **fixed** window starts at a key's first request and restarts once it has
  elapsed. It does not slide.
- When a map is full, the key inserted earliest is evicted, whether or not it is
  still active: eviction follows insertion order, not recent use. With 1,000 or
  more distinct keys on one bucket within a window, a counter can be dropped
  before its window ends.
- Expired entries are removed every 60 seconds.
- Counters are not shared between processes, which is one of the reasons
  [ADR-011](docs/decisions/011-single-instance-scaling-constraint.md) keeps the
  API single-instance.

### Global limiter

A second limiter runs before tRPC on every route but file serving and the
season-calendar exports, which have their own: `@fastify/rate-limit`
with `apps/api/src/lib/globalRateLimit.ts` ([ADR-051](docs/decisions/051-request-limits-per-user-and-per-address-in-three-lanes.md)).
A request whose bearer authenticates counts for its user, in one of three lanes:
`essential` (profile, token refresh, sign-out: 60 a minute), `background`
(heartbeat, SSE ticket: 30) and everything else (300); any other request counts
for its address (100). The numbers are the `rateLimit.global` AppConfig key;
development multiplies them by 20 and exempts the loopback addresses
(`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). File serving, `GET /uploads/:bucket/*`, is out
of it: every picture on a page is one request, and a photo-heavy collection
layout spent the whole budget on one uncached load. The only caller of that
route is the web's authenticated `/api/uploads` proxy, and responses carry a
private, immutable one-year cache; the residual is that a signed-in user can
download files without a rate ceiling. An invalid `rateLimit.global` falls back to the
defaults; the limits are read in the background (the defaults until the first
read, the last values read when a read fails), and a revocation check slower
than one second keys the request by its signed identity; and `skipOnError` lets requests through when the
limiter's store fails. Its 429 carries `Retry-After` and its own body —
`{ error, message, code: 'TOO_MANY_REQUESTS', retryAfterSeconds, traceId }`,
`retryAfterSeconds` being the time left in the window — and no `error.data.code`.
Each refusal is one `warn` line, `Global rate limit exceeded`, with the lane, the
user id or address, the method and the procedures. `retryAfterSeconds` of a
per-procedure limit is the whole window instead.

The web waits as long as that header asks. Its tRPC fetch (`apps/web/src/lib/trpcFetch.ts`)
turns the limiter's body into a tRPC `TOO_MANY_REQUESTS` error with `retryAfterSeconds`
from `Retry-After`, so the login page shows a throttled sign-in, not wrong credentials. A query
retries a 429 once, after that wait plus up to a second (a wait longer than a minute shows the
error instead), and never another 4xx; a mutation never retries. The token
refresh skips its next attempt until the wait is over (30 s at least, 5 minutes at most), and a
429 never signs the user out. The heartbeat and the SSE ticket fail offline instead of queuing,
and give up after 15 s. When the network comes back, a tab refetches its stale queries once,
after a random wait of up to 5 s; the SSE reconnect backs off with jitter.

A tRPC batch is one request to this limiter, whatever the number of calls in
it. The tRPC adapter refuses a batch of more than `TRPC_MAX_BATCH_SIZE` calls
(`@luke/core`, 20) with a 400, before any procedure runs, and the web's links
split at the same number, so a busy page sends a second request instead.

---

## Idempotency

Mutations that chain `withIdempotency()` accept an `Idempotency-Key` header
carrying a UUID v4: `auth.login`, `me.changePassword`, `config.set`,
`config.update`, `config.setMultiple`, `users.create`, `users.update`, and the
creates a repeat would duplicate (#248), listed in `KEYED_CREATES` in
`apps/api/test/idempotentCreates.integration.spec.ts`. The web sends those
creates with one key per user action (`useIdempotentAction`,
`apps/web/src/lib/idempotencyKey.ts`): a retry after a lost answer replays the
first result instead of creating again, and a refusal by the procedure itself
(which stores nothing) ends the action, so the next submit is a new one. A call with a key travels alone, not in
a tRPC batch (`apps/web/src/lib/trpcLinks.ts`). Queries are never deduplicated.

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
  still reach the `tRPC error` log line, whole with the stack for an unexpected
  one (`INTERNAL_SERVER_ERROR`), less the arguments a Prisma error renders
  ([API documentation](apps/api/README.md#hardening--shutdown-semantics)).
- A tRPC error a REST route lets through to the API's error handler (the
  calendar exports do) answers the same way: the code's own status, and in
  production its message for a 4xx only. Any other error keeps its HTTP status
  with the generic text. The upload routes still answer their errors
  themselves, mapping only `BAD_REQUEST`, `NOT_FOUND` and `FORBIDDEN`.

Clients and operators branch on `error.data.code` and `error.data.httpStatus`,
never on the message text. A `SERVICE_UNAVAILABLE` also says why in
`error.data.unavailableReason` (`maintenance` or `auth_unavailable`,
`SERVICE_UNAVAILABLE_MESSAGES` in `@luke/core`); the web shows that reason's
text, and a neutral one for a 503 without a reason, such as a proxy's page:

| Condition | `error.data.code` | HTTP |
|---|---|---|
| Rate limit exceeded | `TOO_MANY_REQUESTS` | 429 |
| Sign-in refused before the password is proven: wrong password, unknown user, full per-account bucket, a check LDAP could not complete — one text for all, the cause only in the audit row | `UNAUTHORIZED` | 401 |
| No valid sign-in strategy stored (the same answer for every account), a login whose password the directory verified and whose user record could not be written, or a signed-in password check LDAP could not complete — see the [API documentation](apps/api/README.md#ldap-resilience-and-authentication-fallback); reason `auth_unavailable` | `SERVICE_UNAVAILABLE` | 503 |
| A signed-in call during maintenance, for a role that cannot bypass it; reason `maintenance` | `SERVICE_UNAVAILABLE` | 503 |
| Login with a proven password during maintenance, for a role that cannot bypass it (message `MAINTENANCE_ACTIVE`) | `FORBIDDEN` | 403 |
| Idempotency key reused with a different input, or a request with the same key still in progress (each with an Italian message the web shows as is, and `data.idempotency`: `conflict` or `inFlight`) | `CONFLICT` | 409 |
| Too many idempotent requests in progress | `TOO_MANY_REQUESTS` | 429 |
| Idempotency key that is not a UUID v4 | `BAD_REQUEST` | 400 |
| A settings test (LDAP, mail, NAV, storage, Google) or the NAV preview that the external system refused | `PRECONDITION_FAILED` | 412 |
| A verification email the mail server did not accept | `PRECONDITION_FAILED` | 412 |

A refused settings test answers a fixed text the admin can act on; the external
system's own error is never in the answer, only in a warning log line of its own
(for example `LDAP connection test: bind failed`, `SMTP test failed`, `NAV preview
failed`, `NAV connection test failed` with its `step` and `detail`, `S3 test failed`,
`Google Workspace test connection failed`). A failed verification email answers one
fixed text that says nothing about the account; the mail server's error is in the
`EMAIL_VERIFICATION_SENT` failure audit row and the `Verification email send failed`
log line. A database failure while reading the storage settings stays a server
error.

A backup restore that fails for any reason other than a refusal written for the
admin (a `RestorePreconditionError`, a 412 with its own text) answers a 500 with
a fixed text, masked in production like any 5xx: the dump or restore tool's output, a driver error or a local path
reaches only the `tRPC error` log line, as the error's cause. A failed safety
snapshot points to its row in the backup list. A configuration batch save or
import (`config.setMultiple`, `config.importJson`) keeps the text of a refusal
the app wrote for one key, and names any other failure with a fixed text, the
error in the `Configuration item not saved` log line.

Failure text the server stores and shows only to administrators is intended:
the error of a backup record in the backup list, the NAV and Google sync status,
and the scheduled-sync failure notifications.

A `BAD_REQUEST` from a failed input parse also carries `error.data.zodIssues` —
every issue as `{ path, message }`, the path in full (`data.retailMultiplier`),
where the message keeps only the first; a 5xx never carries it.

Rate-limit errors also carry `error.data.retryAfterSeconds` — the bucket's whole
window, not the time left; the idempotency 429 does not. Their message is a
generic `Troppe richieste. Riprova più tardi.`: a 4xx reaches every client, so
the bucket and its limit are logged instead (`Rate limit exceeded`, with
`routeName`, `key` — the client IP or the account —, `max`, `windowMs`). A `requirePermission` refusal likewise reads
`Accesso negato`. Every Resource:Action or section refusal — `requirePermission`,
`withSectionAccess`, a manual `can()`/`hasPermission()` guard,
`requireSessionWithPermission` on a raw route — writes the same `Permission
denied` warning, with `traceId`, `userId`, `userRole` and either
`requestedPermissions`/`deniedPermissions` or `section`. Brand-scope, ownership and
last-admin refusals do not write it.

The [global limiter](#global-limiter)'s 429 has its own body, code
`TOO_MANY_REQUESTS`, and no `error.data.code`; the web's tRPC fetch gives it one.

---

## Signing in when LDAP is unreachable

Under `ldap-only`, a directory outage refuses every login that has no local
path. The sign-in page shows only the generic refusal; the administrators get
an in-app notice (`Verifica LDAP non riuscita`, at most once every six hours),
and the `AUTH_LOGIN_FAILED` rows say `ldap_unavailable`. In order:

1. **An administrator with a LOCAL credential signs in with it.** Under
   `ldap-only` that path is always open to administrators (the break-glass rule in
   the [API documentation](apps/api/README.md#ldap-resilience-and-authentication-fallback));
   the login is audited as `provider: 'local'` and notifies the administrators.
   An administrator whose account bucket is full (`loginByUsername`, ten
   attempts in fifteen minutes) sees the same generic refusal even with the
   right password: wait for the window to pass.
   That administrator can then switch the strategy to `local-first` with
   `Salva strategia` in the `Strategia di autenticazione` card of the LDAP
   settings page, until the directory is back.
2. **No administrator knows a local password.** From a shell in the API
   container, `node dist-scripts/scripts/grant-local-access.js --username
   <administrator>` issues a single-use reset link;
   [Recovering administrator access](apps/api/README.md#recovering-administrator-access)
   explains its checks and why the printed link is a credential.
3. **Nobody can sign in to change the strategy.** `auth.strategy` is read on
   every login, so changing the row restores the local fallback to every user
   with a LOCAL credential; it gives nobody a password. The strategy has no
   default: when the row is missing or holds an invalid value, every sign-in is
   refused as unavailable (audit reason `strategy_unavailable`, administrators
   notified) and the LDAP settings page shows no strategy. The statement below
   writes the row whether or not it exists:

   ```sql
   INSERT INTO app_configs (id, key, value, "isEncrypted", "updatedAt")
   VALUES (gen_random_uuid(), 'auth.strategy', 'local-first', false, now())
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "isEncrypted" = false, "updatedAt" = now();
   ```

   The statement writes no audit row. Record it in the incident notes, and once
   an administrator can sign in, save the strategy again from the LDAP settings
   page so that the audit log carries the strategy in force.

Users who exist only in the directory wait for it either way. Prevention is the
setup requirement in the API documentation: before choosing `ldap-only`, make
sure at least one administrator can log in locally.

A certificate the client refuses over `ldaps://` is an outage of the same kind:
the service bind fails, the rows say `ldap_unavailable` and `/readyz` reports
`ldap` as failed. `Test Connessione` names the reason — a certificate no trusted
authority issued, a host name the certificate does not carry, or one expired or
not yet valid. A directory whose certificate no public CA issued (self-signed, or
from an enterprise CA) is trusted by pasting its certificate, or the CA's, into
`Certificati attendibili` on the LDAP settings page; the URL must use a host name
the certificate carries. Verification cannot be turned off, by setting or by
`NODE_TLS_REJECT_UNAUTHORIZED`. Change the URL or the certificate with an
administrator who can sign in locally at hand, then run `Test Connessione`.

---

## Ending maintenance without the web

A maintenance window never ends by itself. During one, a signed-out visitor
sees no maintenance screen at all — the state needs a session (ADR-042) — and
reaches the login form and the password reset page as usual; a signed-in user
who cannot bypass maintenance sees the lock screen, which links to the form
(`Accesso amministratori`) and signs out (`Esci`). Signing out works in every
state, maintenance included: `/logout` is the address to give a user stuck on
any page, and it clears the browser session even when the API refuses to end
the sessions on the server (ADR-048). An administrator signs in there and ends the window
from the banner. When no browser reaches the form — the web container
down, the proxy misrouted — end it through the API from inside its container:

1. Open a shell in the API container: `docker exec -it luke-api-1 sh` (the name
   `docker ps` shows for the `api` service).
2. Read an administrator's credentials, **one line at a time**: a `read` takes
   the next line it receives as its answer, so pasted together the first one
   answers itself with the second. The password is read without echo and
   reaches `node` through its environment, never its arguments, so it stays out
   of the shell history and of `ps`:

   ```sh
   read -rp 'Username: ' LUKE_USERNAME
   ```

   ```sh
   read -rsp 'Password: ' LUKE_PASSWORD; echo
   ```

3. Sign in and end the window; this block can be pasted whole:

   ```sh
   export LUKE_USERNAME LUKE_PASSWORD
   node --input-type=module -e '
   const call = async (path, input, token) => {
     const response = await fetch(`http://127.0.0.1:3001/trpc/${path}`, {
       method: "POST",
       headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
       body: JSON.stringify(input),
     });
     const body = await response.json();
     if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error?.data?.code}`);
     return body.result.data;
   };
   const { token } = await call("auth.login", { username: process.env.LUKE_USERNAME, password: process.env.LUKE_PASSWORD });
   console.log(await call("maintenance.mode.end", {}, token));
   '
   unset LUKE_USERNAME LUKE_PASSWORD
   ```

   The output ends the window with `status: 'INACTIVE'`. The login is an ordinary
   one — rate limited and audited as `AUTH_LOGIN` — and ending the window writes
   its own audit row. The account needs `maintenance:mode_manage`, which only
   `admin` holds. The image has no `curl`; `node` is the client.

---

## Email deliverability

Password-reset and verification links leave through the SMTP server set on the
mail settings page ([Transactional email](apps/api/README.md#transactional-email)).
In production the domain of `smtp.from` needs:

- an **SPF** record that authorizes that SMTP server to send for it;
- **DKIM** signing, configured on the SMTP service;
- a **DMARC** policy — optional, recommended against spoofing.

Without them the links tend to land in spam or be rejected. The test email on
the mail settings page checks delivery end to end.

---

## Reverse proxy

The reverse proxy (Nginx Proxy Manager, a container on the same host) reaches
each stack's web service over an external network that only the two of them
share: `luke-proxy` for production, `luke-rc-proxy` for the RC. The web
publishes no host port, and the proxy forwards by container name —
`http://luke-web-1:3000`, `http://luke-rc-web-rc-1:3000` — which depends on
the stack names `luke` and `luke-rc`. The proxy is on neither stack's `edge`
or `data` network, so it never reaches apps/api, postgres or the storage, and
apps/api keeps trusting only its `edge` subnet (`LUKE_TRUSTED_PROXY_CIDR`).

Create each network and connect the proxy once per host, before the stack's
first deploy, which stops while its network is missing:

```bash
docker network create luke-proxy
docker network connect luke-proxy nginx-proxy-manager
```

The network outlives the stack, so recreating the stack keeps the connection.
Recreating the proxy's own container drops it: connect it again, or declare
both networks as `external` in the proxy's own stack so that its deploy
restores them.

A manual `docker network connect` can still put the proxy on an `edge` or
`data` network. After any change to the proxy, list its networks: its own,
`luke-proxy`, `luke-rc-proxy`, and none ending in `_edge` or `_data`.

```bash
docker inspect nginx-proxy-manager --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

---

## Release build variables

`release.yml` builds the web image with two arguments: `INTERNAL_API_URL`, the
API service of the channel (`http://api:3001`, or `http://api-rc:3001` for an rc
tag), which the `next.config.js` rewrites are generated from, and `APP_VERSION`.
No public hostname or scheme is baked: the browser calls the API on the page's
own origin. The rewrites forward `/trpc`, `/download` and `/api/sse` to the
API, and a route handler streams `/upload` to it on the runtime
`INTERNAL_API_URL`. A new hostname, or the switch to HTTPS, needs no new
image: set the stack's `PUBLIC_HOSTNAME` (`RC_PUBLIC_HOSTNAME`), `PUBLIC_SCHEME`
and `COOKIE_SECURE`, the application base URL in the mail settings
(`app.baseUrl`, the origin of the links in emails), and, with Google connected,
register the new redirect URI (`docs/google-calendar-setup.md`). The repository
variables `PUBLIC_HOSTNAME` and `RC_PUBLIC_HOSTNAME` are no longer read; keep them until 3.1.0 is
on `main`, whose 3.0 workflow still reads them for a hotfix.

Web images before 3.1.0-rc.1 bake `http://<hostname>`: after the switch to
HTTPS, rolling the web back to one of them brings mixed content back.

---

## Purging a test brand or season

A real brand or season comes from NAV. One created only in Luke, for a test, can be purged: deleted
with everything under it — layouts with their groups, rows, quotations and revisions, season
calendars with their planning groups and events, merchandising plans, parameter sets, a brand's
team brand scopes or a season's vendor closure periods, and then the brand or season itself. A
season's purge takes that data for every brand. Only an administrator can purge (`*:*`), and only an
entity with no NAV link that was deactivated first: deactivate, then purge, as two separate steps. In
the admin page, `Elimina con i dati` on such a row shows what the purge would delete and asks for the
entity's name.

Nothing proves the data is test data: being inactive and NAV-free is the whole test. `Scollega da NAV`
leaves a real brand or season in exactly that state, so after an unlink it can be purged at once.

It runs in one transaction with one audit entry (`BRAND_PURGE` or `SEASON_PURGE`, with the counts):
a failure anywhere deletes nothing. It is refused while data of another brand or season uses one of
its planning groups or parameter sets.

After the commit, each on its own and logged when it fails, it removes the brand logo, the row
pictures and the merchandising images that no surviving record names, the Google copies of the
events, and the Google calendars Luke created for the season calendars. What it does not remove:

- revision pictures in the immutable bucket, shared across brands by checksum
  ([storage-immutable-bucket.md](docs/storage-immutable-bucket.md)); the audit entry counts them;
- a Google copy written by a sync already running, and an exported ICS imported elsewhere;
- history with no foreign key: notifications, links, sales data matched by code.

---

## Restore drill on the RC

Before every minor release (X.Y.0), its RC restores a fresh production backup and proves it usable.
A backup nobody has restored is a hope: the drill is the only run of the emergency flow — production
backup, `.lukebak` export, import on another instance, restore — on real data (#200).

The RC then holds production's configuration, and the restore neutralizes none of it yet: encrypted
credentials fail only because the RC's master key differs, while plaintext settings, a credential an
earlier release stored in plaintext or an anonymous LDAP bind would work against production
([rc-prod-clone.md](docs/rc-prod-clone.md#known-limitations)). So the drill runs with the RC API cut
off from everything outside its stack. Its volumes are the RC's own; nothing in the RC stack mounts
production's.

From 3.1 on, a production backup that holds two user addresses differing only by case, or one
outside printable ASCII, does not restore: the restore replays migration
`20261116150000_user_email_normalized`, which refuses on them (`docs/upgrade-3.0-to-3.1.md`, step 2).

**Before.** In Portainer, stack `luke-rc` → environment: `LUKE_RC_EGRESS_OFF=true`, then update the
stack. The `edge` network, the API's only way out, becomes internal (`docker-compose.rc.yml`). A
Compose version that keeps an existing network unchanged will not apply it: stop the stack, run
`docker network rm luke-rc_edge`, deploy it again. Then check from the host, with a TCP probe run by
the API's own Node, so a missing tool or a stopped container cannot read as isolation:

```sh
probe() { docker exec luke-rc-api-rc-1 node -e "const s=require('net').connect({host:process.argv[1],port:+process.argv[2],timeout:5000});s.on('connect',()=>{console.log('OPEN');process.exit(0)});s.on('timeout',()=>{console.log('closed (timeout)');process.exit(1)});s.on('error',e=>{console.log('closed ('+e.code+')');process.exit(1)})" "$1" "$2"; }
docker network inspect luke-rc_edge --format '{{.Internal}}'   # true
probe seaweedfs-rc 8333    # OPEN — the probe runs and reaches the stack
probe 1.1.1.1 80           # closed
probe <NAV host> 1433      # closed — production's systems are on the LAN, not only the internet
probe <LDAP host> 389      # closed
probe <SMTP host> <port>   # closed
```

Use the hosts production's settings name. Do not start unless the first probe is `OPEN` and every other
one `closed`.

**Drill.**

1. From a workstation, `pnpm rc:clone` ([rc-prod-clone.md](docs/rc-prod-clone.md#usage)): a fresh
   production backup (database only, as the script creates it), export, import on the RC, restore.
   Never with `--restore-files`: step 4's safety snapshot holds the database only and cannot take
   production's files back off the RC. Note the backup's size and the time of each step.
2. Leave maintenance on. Do not restart `api-rc` from here until step 4: after the restore the
   storage settings are production's, and the API reaches the RC's own storage only through the
   provider it already holds.
3. Check, signed in as an administrator:
   - sign-in works;
   - record counts of a few key tables against production (users, collection rows, calendar
     events, parameter sets);
   - the collection layout, calendar and pricing pages open with production's data;
   - the settings pages mark the credentials this instance cannot read;
   - the import of a large package succeeded (#197).
4. Restore the safety snapshot the restore took first (`Manutenzione` → `Backup & Restore`, the entry
   marked `Snapshot di sicurezza`). It must complete; then the storage and mail settings pages show
   the RC's own values again.

If `api-rc` restarted before step 4 (a crash, a host reboot), it now reads production's storage
settings and cannot open the snapshot. Keep egress off, save the RC's own storage settings again
(`Impostazioni` → `Storage`, the SeaweedFS of this stack), then do step 4.

**After.** Only once step 4 completed and the settings show the RC's values: `LUKE_RC_EGRESS_OFF=false`,
update the stack, end maintenance. Until then the RC holds production's configuration, and opening
the network would let its schedulers act on production.

**Record.** Each drill leaves a record outside this repository, since it holds production sizes and
counts; the drill's issue gets only the outcome. Template:

```text
Restore drill — <date>
Production version / RC version:
Isolation checked (network internal, no egress): yes / no
Backup: scope, size, id
Time: backup / export / import / restore / snapshot restore
Checks: sign-in, record counts (table: production / RC), pages, unreadable credentials, large import
Outcome: passed / failed
Problems (one issue each):
```

The restore will neutralize production's configuration by itself on a non-production instance in a
later release; until then the network switch is the drill's protection.

---

## Related documentation

- [README.md](README.md) - Main project documentation
- [API documentation](apps/api/README.md) - API reference, security headers, health and readiness checks, LDAP resilience, [recovering administrator access](apps/api/README.md#recovering-administrator-access) when nobody can sign in, and local tracing
- [Frontend documentation](apps/web/README.md) - Includes the client data-refresh standard after mutations
- [NAV integration](docs/nav-integration.md) - Master-data sync, the order-portfolio and KIMO replicas, and their schedules
