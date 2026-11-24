# ADR-051 — Request Limits: Per User and Per Address, in Three Lanes

## Status

Accepted

## Context

The API's global limiter (`@fastify/rate-limit` in `apps/api/src/server.ts`) counted every request
per client address, at a number written in the code: 100 a minute, 2,000 in development. Every user
behind one address shared it, and so did each user's essential calls: on 2026-11-10 a user's
reconnecting browser spent it, and the profile, the token refresh and the sign-out were refused for
the rest of the minute (#239). Measured on the 3.1.0-rc.3 candidate, an idle tab sends about 10
requests a minute through its timers, 6 when hidden. Its refusal reached the client as an internal
error, without the seconds to wait, and was logged as a failed request.

Reference practice limits authenticated traffic per identity, and per address only where there is no
identity (GitHub's REST API, for example). Per-procedure limits, the credential buckets of
`lib/ratelimit.ts` among them, are a separate layer and are not changed here.

The owner decided (#239, 2026-11-24) that the numbers live in AppConfig with bounds. The design was
reviewed (Codex, nine findings applied and verified).

## Decision

- **Keys.** A request whose bearer authenticates is counted for its user. It authenticates through
  `requestSession` (`apps/api/src/lib/auth.ts`), the check `authenticateRequest` uses, run once per
  request and shared by both: signature, expiry, absolute lifetime and revocation. Any other request is counted for its client
  address (`ip:`, IPv6 grouped by /64), whatever token it carries. A revoked, expired or tampered
  token therefore never spends its former owner's buckets.
- **Three lanes per user.** The lane is decided on the request path, query string ignored:
  - `essential`: every procedure in the path is in `ESSENTIAL_PROCEDURES` (`me.get`,
    `auth.refreshToken`, `auth.logout`);
  - `background`: every procedure is in `BACKGROUND_PROCEDURES` (`users.heartbeat`,
    `notifications.getSseTicket`);
  - `normal`: anything else, including a batch that mixes lanes and any path the rule does not
    recognise.

  Both lists live in `@luke/core` (`packages/core/src/net/url.ts`), and a test fails when a listed
  procedure is not mounted. The web sends these procedures unbatched (`splitLink` on `sendsUnbatched`),
  so a page's other calls never pull them into the normal lane. Background traffic cannot spend the essential lane. A client that floods
  one essential procedure can still exhaust that lane: each lane is finite on purpose.
- **Numbers.** They come from the AppConfig key `rateLimit.global`
  (`GlobalRateLimitSchema`, `packages/core/src/schemas/appConfig.ts`). The window is fixed at one
  minute.

  | Field | Default | Bounds |
  | --- | --- | --- |
  | `perUser` | 300 | 60–10,000 |
  | `perIp` | 100 | 30–10,000 |
  | `essentialPerUser` | 60 | 30–1,000 |
  | `backgroundPerUser` | 30 | 10–1,000 |

  The schema is strict, and the bounds apply both when the key is written and when it is read.
  - An invalid stored value falls back to the defaults with a warning (`getConfigOrDefault`).
  - The limits are served from memory and refreshed in the background (every 2 seconds at most):
    the defaults apply until the first read completes, and a failed read keeps the last values read.
    A slow or failed database therefore never makes a request wait on the limiter or fail, health
    probes included.
  - The revocation check of the key waits at most one second. If it fails or is slower, the request
    is counted for the identity its signed bearer names.
  - Development multiplies every limit by 20 and exempts the loopback addresses.
- **The refusal.** A refused request gets 429 with `Retry-After`. Its body is
  `{ error, message, code: 'TOO_MANY_REQUESTS', retryAfterSeconds, traceId }`, and
  `retryAfterSeconds` is the same time left as the header. The body never names the address. The
  limiter logs the refusal once, at `warn`, with the lane, the user id or the address, the method and
  the procedures. It never logs the query string, which carries a GET's input.
- **Upload routes.** The four upload and export routes keep their own buckets
  (`rateLimitKeyFromRequest`, keyed `u:` or `ip:`). That key checks only the signature, so a revoked
  token that has not expired still keys its user's upload bucket. This residual is accepted: the
  handler refuses the request.

## Consequences

- Users behind one address no longer share a budget, and a user's own background traffic cannot
  lock out the profile, the refresh or the sign-out.
- The lanes are separate quotas: a user's ceiling is their sum (390 a minute by default), not 300.
- A client holding valid tokens of several users gets several quotas. The limit is per identity, not
  an aggregate per client.
- `rateLimit.global` has no product writer: it is outside the configuration router's prefixes, as
  `rateLimit` is. A change today is a seed or database operation.
- Opening the SSE stream carries a ticket, not a bearer, so it is counted per address.
- The counters are per process ([ADR-011](011-single-instance-scaling-constraint.md)), unchanged.
- Later identity and authorization work keeps these interface points:
  - an extended session check (user status, authorization version) applies to the limiter by
    construction;
  - limits for Internet exposure are a change to `rateLimit.global`.
