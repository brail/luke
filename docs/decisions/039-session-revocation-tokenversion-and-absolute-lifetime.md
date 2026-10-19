# ADR-039 — Server-Side Session Revocation with tokenVersion and an Absolute Session Lifetime

## Status

Accepted

## Context

[ADR-019](019-tokenversion-session-revocation.md) was the record of how Luke revokes sessions: a `tokenVersion` counter and an `isActive` flag on `User`, compared on every request, behind a process-local cache. Its mechanism holds, but four things it decided or left open have changed:

- A session had no bound beyond the 8-hour lifetime of each API token, and `auth.refreshToken` re-minted that token for as long as the web session kept refreshing it.
- Signing out was the web's alone: Auth.js `signOut()` ended the browser session and left the API token to its expiry.
- A cache fill could store a read that began before an invalidation; ADR-019 recorded this under Observed gaps.
- An event stream (SSE) was authenticated when it opened and not afterwards.

The owner decided that signing out ends every session of the user, that a session lives at most 12 hours from its login however often it is refreshed, and that signing out follows maintenance mode like every other own-data endpoint. Three alternatives were set aside: ending only the current session, which needs a session identifier the tokens do not carry; an idle timeout and a configurable lifetime, which can follow without changing this decision; and a sign-out exempt from maintenance, which would be a second authenticated builder outside the maintenance guard, the arrangement [ADR-029](029-resource-action-permissions-one-builder-logged-refusals.md) removed and [ADR-038](038-resource-action-permissions-grants-follow-section-visibility.md) kept removed.

The change is to what the record decides, so it supersedes ADR-019 as a whole rather than appending errata to it ([ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md)). ADR-019 remains as the historical record.

## Decision

A session is revoked on the server, by changing what the API compares each token against: the user's `tokenVersion` and `isActive`. Independently of any revocation, a session ends 12 hours after its login.

### The check

- `createToken` in `apps/api/src/lib/auth.ts` signs the API token with the user's `tokenVersion` and the session's `authTime` — the Unix time, in seconds, of the login the session descends from — as claims. `authTime` is a required parameter, so no caller starts a new session by accident: `authenticateUser` (`apps/api/src/services/auth.service.ts`, the LOCAL and LDAP login) passes the time of the login, and `auth.refreshToken` passes the bearer's own. The token's `exp` is 8 hours after signing, or `authTime` plus the absolute lifetime when that comes first. The NextAuth session carries the `tokenVersion` claim.
- The absolute lifetime is `SESSION_ABSOLUTE_LIFETIME_SECONDS` in `packages/core/src/schemas/auth.ts`, 12 hours. It is a constant, not configuration.
- `createUserSession` in `apps/api/src/lib/auth.ts`, where a bearer becomes a session, refuses a token whose `authTime` is missing, not a finite number, ahead of the clock by more than the JWT clock tolerance (5 seconds), or at or past `authTime` plus the absolute lifetime, whatever its `exp` says.
- `verifyTokenVersion` in `apps/api/src/lib/tokenVersionCache.ts` accepts a token only when its `tokenVersion` equals the user's current value and the user is active. It rejects a token without the claim and a user that no longer exists.
- `authenticateRequest` in `apps/api/src/lib/auth.ts` builds the session for a request through `createUserSession` and then performs the version check, so tRPC procedures and raw Fastify routes both treat a revoked or expired session as unauthenticated. `authMiddleware` in `apps/api/src/lib/trpc.ts` deliberately repeats the version check for contexts built by hand rather than from a request, such as tests and internal jobs; such a context carries no bearer, and the lifetime does not apply to it.
- `isActive` is a second revocation state: deactivating a user rejects their tokens even when `tokenVersion` is unchanged.

### The refresh

`auth.refreshToken` re-reads the user and re-mints the API token with the role and version it reads. It refuses, with `UNAUTHORIZED`, a session without `authTime`, an inactive or missing user, and a version that is no longer the bearer's: a refresh that passed authentication before a revocation committed cannot mint a token at the new version. The new token keeps the bearer's `authTime`, so refreshing never extends a session past its absolute lifetime.

### Signing out

- `auth.logout` increments the caller's `tokenVersion`, invalidates the cache and writes an `AUTH_LOGOUT` audit row. It ends every session of the user, the one it is called from included.
- It is a `selfProcedure`, so maintenance mode applies to it as to every own-data endpoint: during an active window, a user who cannot bypass maintenance is refused and stays signed in.
- The web's sign-out button (`AppSidebar`) calls it before Auth.js `signOut()`. It signs out when the call succeeds or answers `UNAUTHORIZED` — the session is already revoked or expired, and nothing is left to end with it. On any other answer it stays signed in and tells the user, so the button can be pressed again. The automatic sign-outs (`useSessionVerification`, `HeartbeatTicker`, the force-logout route, the password change and `me.revokeAllSessions`) do not call it: their sessions are already revoked or expired.

### The API cache

- `verifyTokenVersion` caches each user's `tokenVersion` and `isActive` in a process-local map. An entry lives for `security.tokenVersionCacheTTL`, between 10 and 600 seconds and 60 seconds by default; the TTL setting itself is re-read every five minutes.
- Every runtime write that revokes sessions must invalidate the cache: `invalidateTokenVersionCache` for one user, `clearTokenVersionCache` after a bulk change.
- Each invalidation advances a process-local counter. A fill stores its read only if the counter has not moved since the read began, so no cache entry outlives an invalidation that happened after its read started. A verification already reading when an invalidation lands still answers from its own read, as a request that arrived a moment earlier would; the next verification reads again. The counter is shared by every user: a fill that loses the race against another user's invalidation skips one cache write. `getRbacConfig` in `packages/core/src/server/rbacConfig.ts` guards its own cache the same way.
- The cache is local to one API process, so invalidation and the latency below hold only on the single instance [ADR-011](011-single-instance-scaling-constraint.md) requires.

### Event streams

- `notifications.getSseTicket` issues a single-use ticket, valid for 60 seconds, that carries the caller's session: `userId`, `tokenVersion` and `authTime`. It refuses a session without the last two.
- The SSE route (`apps/api/src/routes/sse.ts`) checks that session with `isSseSessionLive` — the absolute lifetime and `verifyTokenVersion` — when the stream opens, answering 401 before any stream exists, and then every 30 seconds, counted from the end of one check to the start of the next, so checks never overlap; each successful check is followed at once by a heartbeat. A refused check ends the stream; a check that fails is logged and ends it too, rather than becoming an unhandled rejection. A timer of its own ends the stream at `authTime` plus the absolute lifetime, without a database read.
- Ending a stream clears both timers and removes it from the push pool before it is ended, so a push landing in between writes nothing. A check that resumes after the stream closed writes nothing.

### The web application

- The NextAuth `jwt` callback in `apps/web/src/auth.ts` delegates the check to `auth.refreshToken`. An `UNAUTHORIZED` answer — a revocation, an inactive user, or a session past its absolute lifetime — ends the NextAuth session. The callback records each check attempt for 30 seconds per user, whatever its outcome, so at most one refresh per user runs in that window; an `UNAUTHORIZED` answer clears the record.
- `useSessionVerification` calls `me.get` on mount, every 10 seconds, and on focus or visibility change; `HeartbeatTicker` calls `users.heartbeat` every 60 seconds. Both sign the user out on `UNAUTHORIZED`.
- There is no Next.js middleware or proxy check, and no proxy entry point: a middleware check raced the token refresh and forced false logouts (`a0346fd`).

### Latency

- After a revoking write commits and invalidates the API cache, every verification that starts afterwards rejects the revoked token. One already in flight answers from its earlier read and cannot store it.
- If a writer omitted the invalidation, the API could keep accepting the token until the cache entry expires, up to the configured TTL.
- The absolute lifetime takes effect on the request that reaches it, with no write and no cache involved.
- The NextAuth layer detects the revocation on the next `jwt` callback after its own 30-second validation cache expires. That cache does not delay the API's rejection.
- The client can also sign the user out on the next 10-second verification call, the next focus or visibility verification, or the next 60-second heartbeat, whichever comes first.
- An open event stream ends at the first heartbeat check that starts after the revocation commits: about one interval plus two check durations at worst. It ends at the absolute lifetime on time.

### Revocation triggers

Runtime triggers in the API, each followed by cache invalidation:

- **Self revoke:** `auth.logout` and `me.revokeAllSessions` increment the caller's `tokenVersion`.
- **Other-user revocation:** `users.revokeUserSessions` increments the target user's `tokenVersion`. It requires `users:update`, which only `admin` holds, and it blocks revoking the caller's own sessions but otherwise permits revoking any other user's sessions, including an administrator's.
- **Password change or reset:** `me.changePassword` and `auth.confirmPasswordReset` increment it.
- **Role, active-state or identity change:** `users.update` increments it when the role, the active state, the password or a field only an administrator may change is modified; `users.softDelete` sets `isActive` to `false` and invalidates the cache without incrementing, relying on the active-state check.
- **Local-access revocation:** `users.revokeLocalAccess` increments it.
- **Account deletion:** `users.hardDelete` deletes the user row and invalidates that user's cache entry, so a previously cached valid identity does not survive until the cache TTL expires.
- **Maintenance bulk logout:** `forceLogoutNonAdmins` in `apps/api/src/lib/maintenanceMode.ts` increments every non-admin user's `tokenVersion` and clears the cache. The maintenance scheduler and `maintenance.mode.activateNow` call it when the maintenance window is set to `forceLogout`; the start of `maintenance.backup.restore` always calls it.
- **Re-assertion after restore:** the `finally` block of `maintenance.backup.restore` calls `forceLogoutNonAdmins` again after `pg_restore`.

Outside the runtime triggers:

- **One-time database upgrade:** `packages/db/prisma/migrations/20260515000000_company_structure/migration.sql` increments every user's `tokenVersion` when it is applied. In the normal deployment path it runs before the API starts, while the process-local cache is empty, and the backup migration bridge runs it against a temporary database. This records that migration only; it does not require future migrations to invalidate sessions.
- **Bootstrap:** `seedAdminUser` in `apps/api/prisma/seed.ts` can set an existing admin's `isActive` back to `true` without incrementing `tokenVersion`. It is a bootstrap and one-off path, not an enforced runtime revocation path, and its risk is recorded under Observed gaps. Creating a user with `isActive: true` is not a transition.

## Consequences

- Every user signs in again at least every 12 hours, however active. A token signed before this record carries no `authTime` and is refused, so the deployment that introduces it signs every user out once.
- Signing out ends the user's sessions in every browser and device, not only the current one. Ending one session alone would need a session identifier in the tokens.
- A new token issuance path must decide where its session starts: `createToken` requires `authTime`.
- Revoking sessions still takes two operations that nothing couples: the database write and the cache invalidation. A new revoking path that omits the second leaves revoked tokens accepted until the cache entry expires.
- On more than one API instance, an invalidation would reach only the instance that performed the write (ADR-011), and the event stream checks would read each instance's own cache.

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- A backup restore can undo revocations and deactivations. `pg_restore` in `maintenance.backup.restore` can roll back both `tokenVersion` and `isActive` to the backup's values, and the `finally` block re-increments only non-admin token versions before clearing the cache. Admin session revocations made after the backup can therefore be undone. Account deactivations made after the backup can also be undone: non-admin sessions are revoked again by the final increment, but their deactivation is not restored.
- `seedAdminUser` reactivates an existing admin without incrementing `tokenVersion` or invalidating a running API's cache. Run against a populated database, it can make tokens issued before that admin's deactivation valid again, for as long as they have not expired and their session is within its absolute lifetime.
- The NextAuth session lifetime is fixed in `apps/web/src/auth.shared.ts` (8 hours, refreshed every 4); `security.session.maxAge` and `security.session.updateAge` are registered in `AppConfigRegistry` but nothing reads them.
- Comments have drifted from the mechanism: the comment on `verifyTokenVersion` gives the JWT lifetime as 7 days, and `apps/api/src/lib/jwt.ts` keeps a `'7d'` default that is unused, because `createToken`, its only caller, always supplies a lifetime.
