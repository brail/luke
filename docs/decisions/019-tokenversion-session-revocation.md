# ADR-019 — Server-Side Session Revocation with tokenVersion

## Status

Accepted

## Context

[ADR-009](009-tokenversion-session-invalidation.md) introduced a `tokenVersion` counter on `User`, carried in tokens and compared on each request, so that sessions can be revoked before their tokens expire. The counter is still how Luke revokes sessions, but the mechanism ADR-009 describes around it no longer holds. One of its four verification layers, a Next.js middleware, was removed (`a0346fd`); the other layers are not independent, because both web layers depend on the API check. Its "5min" cache is a configurable TTL. Its claim that incrementing the counter is sufficient is wrong, because every increment must also invalidate the API cache. Its list of triggers names `auth.changePassword`, which does not exist, and omits most of the current ones.

This record supersedes ADR-009 and states the mechanism in force today. ADR-009 remains, translated, as the historical record of the original decision.

## Decision

A session is revoked on the server, by changing what the API compares each token against: the user's `tokenVersion` and `isActive`.

### The check

- `createToken` in `apps/api/src/lib/auth.ts` signs the API token with the user's `tokenVersion` as a claim and an 8-hour lifetime. The NextAuth session carries the same claim.
- `verifyTokenVersion` in `apps/api/src/lib/tokenVersionCache.ts` accepts a token only when its `tokenVersion` equals the user's current value and the user is active. It rejects a token without the claim and a user that no longer exists.
- `authenticateRequest` in `apps/api/src/lib/auth.ts` performs the check while it builds the session for a request, so tRPC procedures and raw Fastify routes both treat a revoked token as unauthenticated. `authMiddleware` in `apps/api/src/lib/trpc.ts` deliberately repeats the check for contexts built by hand rather than from a request, such as tests and internal jobs.
- `isActive` is a second revocation state: deactivating a user rejects their tokens even when `tokenVersion` is unchanged.

### The API cache

- `verifyTokenVersion` caches each user's `tokenVersion` and `isActive` in a process-local map. An entry lives for `security.tokenVersionCacheTTL`, between 10 and 600 seconds and 60 seconds by default; the TTL setting itself is re-read every five minutes.
- Every runtime write that revokes sessions must invalidate the cache: `invalidateTokenVersionCache` for one user, `clearTokenVersionCache` after a bulk change.
- The cache is local to one API process, so invalidation and the latency below hold only on the single instance [ADR-011](011-single-instance-scaling-constraint.md) requires.

### The web application

- The NextAuth `jwt` callback in `apps/web/src/auth.ts` delegates the check to `auth.refreshToken`, which re-reads the user, rejects an inactive or missing user, and re-mints the API token. An `UNAUTHORIZED` answer ends the NextAuth session. The callback caches a successful check for 30 seconds per user.
- `useSessionVerification` calls `me.get` on mount, every 10 seconds, and on focus or visibility change; `HeartbeatTicker` calls `users.heartbeat` every 60 seconds. Both sign the user out on `UNAUTHORIZED`.
- There is no Next.js middleware check. `apps/web/src/proxy.ts` is a passthrough, because a middleware check raced the token refresh and forced false logouts (`a0346fd`).

### Latency

- After a revoking write commits and invalidates the API cache, a verification that reads the post-revocation database state rejects the revoked token. A verification that was already in flight when the write committed can store the pre-revocation state back into the cache, as described under Observed gaps.
- If a writer omitted the invalidation, the API could keep accepting the token until the cache entry expires, up to the configured TTL.
- The NextAuth layer detects the revocation on the next `jwt` callback after its own 30-second validation cache expires. That cache does not delay the API's rejection.
- The client can also sign the user out on the next 10-second verification call, the next focus or visibility verification, or the next 60-second heartbeat, whichever comes first.

### Revocation triggers

Runtime triggers in the API, each followed by cache invalidation:

- **Self revoke:** `me.revokeAllSessions` and `auth.logoutAll` increment the caller's `tokenVersion`.
- **Other-user revocation:** `users.revokeUserSessions` increments the target user's `tokenVersion`. It requires `users:update`, which `editor` holds, and it blocks revoking the caller's own sessions but otherwise permits revoking any other user's sessions, including an administrator's.
- **Password change or reset:** `me.changePassword` and `auth.confirmPasswordReset` increment it.
- **Role, active-state or identity change:** `users.update` increments it when the role, the active state, the password or a field only an administrator may change is modified; `users.softDelete` sets `isActive` to `false` and relies on the active-state check without incrementing.
- **Local-access revocation:** `users.revokeLocalAccess` increments it.
- **Account deletion:** `users.hardDelete` deletes the user row and invalidates that user's cache entry, so a previously cached valid identity does not survive until the cache TTL expires.
- **Maintenance bulk logout:** `forceLogoutNonAdmins` in `apps/api/src/lib/maintenanceMode.ts` increments every non-admin user's `tokenVersion` and clears the cache. The maintenance scheduler and `maintenance.mode.activateNow` call it when the maintenance window is set to `forceLogout`; the start of `maintenance.backup.restore` always calls it.
- **Re-assertion after restore:** the `finally` block of `maintenance.backup.restore` calls `forceLogoutNonAdmins` again after `pg_restore`.

Outside the runtime triggers:

- **One-time database upgrade:** `packages/db/prisma/migrations/20260515000000_company_structure/migration.sql` increments every user's `tokenVersion` when it is applied. In the normal deployment path it runs before the API starts, while the process-local cache is empty, and the backup migration bridge runs it against a temporary database. This records that migration only; it does not require future migrations to invalidate sessions.
- **Bootstrap:** `seedAdminUser` in `apps/api/prisma/seed.ts` can set an existing admin's `isActive` back to `true` without incrementing `tokenVersion`. It is a bootstrap and one-off path, not an enforced runtime revocation path, and its risk is recorded under Observed gaps. Creating a user with `isActive: true` is not a transition.

## Consequences

- Revoking sessions takes two operations that nothing couples: the database write and the cache invalidation. A new revoking path that omits the second leaves revoked tokens accepted until the cache entry expires.
- On more than one API instance, an invalidation would reach only the instance that performed the write (ADR-011).

### Observed gaps

These deviations exist when this record is accepted. They are recorded as follow-ups; this record does not endorse them.

- A backup restore can undo revocations and deactivations. `pg_restore` in `maintenance.backup.restore` can roll back both `tokenVersion` and `isActive` to the backup's values, and the `finally` block re-increments only non-admin token versions before clearing the cache. Admin session revocations made after the backup can therefore be undone. Account deactivations made after the backup can also be undone: non-admin sessions are revoked again by the final increment, but their deactivation is not restored.
- `seedAdminUser` reactivates an existing admin without incrementing `tokenVersion` or invalidating a running API's cache. Run against a populated database, it can make tokens issued before that admin's deactivation valid again, for as long as they have not expired.
- Invalidation can be undone by a verification already in flight. On a cache miss, `verifyTokenVersion` reads the user row and then stores the result. If a revoking write commits and calls `invalidateTokenVersionCache` or `clearTokenVersionCache` while that read is in progress, the verification completes afterwards and stores the pre-revocation `tokenVersion` and `isActive` back into the cache. The revoked token is then accepted until that stale entry reaches the configured TTL. Invalidation only deletes entries; there is no generation, epoch or other guard against stale repopulation.
- Code from earlier designs remains. `useSessionInvalidation` has no importers and opens an `EventSource` on `/api/session-events`, and `apps/web/next.config.js` still rewrites `/session-events`, although the API serves no such route.
- Comments have drifted from the mechanism: `SessionVerification` says the hook polls every 30 seconds, although it polls every 10; the comment on `verifyTokenVersion` gives the JWT lifetime as 7 days; and `apps/api/src/lib/jwt.ts` keeps a `'7d'` default that is unused, because `createToken`, its only caller, supplies 8 hours.
