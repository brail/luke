# ADR-009 — TokenVersion Multi-Layer Session Invalidation

## Status

Superseded by [019 — Server-Side Session Revocation with tokenVersion](019-tokenversion-session-revocation.md)

## Context

JWTs are stateless by design: once issued, a token is valid until its natural expiry (8h) even if the user is banned, changes password, or an admin revokes their sessions. This creates a window of uncontrolled access of up to 8 hours.

The requirement was: immediate invalidation (< 1s) in all of these scenarios:
- Admin revokes a user's sessions
- User changes password
- Hard logout (`auth.logoutAll`)
- Admin disables an account

A JWT blocklist approach introduces overhead on every request and cleanup complexity. The session-token-in-DB approach requires a query for every authenticated call.

## Decision

Introduction of `tokenVersion` — an integer counter on `User` — verified at 4 independent layers.

### Base mechanism

`tokenVersion` is baked into the JWT at issuance. On every protected request, the server compares `jwt.tokenVersion` with `user.tokenVersion` from the DB (with a 5min per-request cache). If they diverge → 401.

To invalidate all of a user's sessions: `user.tokenVersion += 1`. All previously issued tokens become invalid immediately.

### 4 verification layers

| Layer | Where | Trigger |
|-------|------|---------|
| **API Middleware** | `apps/api/src/lib/permissions.ts` | Every protected tRPC call |
| **NextAuth Callback** | `apps/web/src/app/api/auth/[...nextauth]` | JWT refresh (every 4h) — returns `null` → automatic logout |
| **Next.js Middleware** | `apps/web/src/middleware.ts` | Navigation between pages |
| **Client Hook** | `apps/web/src/hooks/use-session-verification.ts` | Polling every 10s + focus/visibility change |

### Immediate invalidation

- **API cache**: invalidated in < 1ms on a `tokenVersion` write
- **Client**: polling every 10s guarantees a redirect in < 10s after revocation
- **Navigation**: the Next.js middleware blocks navigation server-side immediately

### Scenarios that increment `tokenVersion`

- `me.revokeAllSessions` — user revokes their own sessions
- `users.admin.revokeUserSessions` — admin revokes other users' sessions
- Password change (`auth.changePassword`)
- Hard logout (`auth.logoutAll`)

## Consequences

- Every session revocation operation requires a write to `User.tokenVersion` — it cannot be forgotten in new "logout" or "revoke" endpoints
- The 5min cache is a deliberate trade-off: it reduces DB hits on high-traffic APIs at the cost of a maximum 5min propagation delay (acceptable because the client-side hook covers the gap)
- Adding a new invalidation scenario requires incrementing `tokenVersion` — that is sufficient, no other operations are needed
- The NextAuth callback must stay in sync with the API logic: if either one stops verifying `tokenVersion`, a layer fails silently
