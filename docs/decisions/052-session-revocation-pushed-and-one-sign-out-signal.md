# ADR-052 — Session Revocation: Pushed at Once, with One Sign-Out Signal

## Status

Accepted

## Context

[ADR-048](048-session-revocation-signing-out-always-ends-the-browser-session.md), carrying
[ADR-039](039-session-revocation-tokenversion-and-absolute-lifetime.md), let the web learn of a
revocation by asking: `useSessionVerification` called `me.get` on mount, every 10 seconds and on
focus, and `HeartbeatTicker` called `users.heartbeat` every 60 seconds. The 10-second check was most
of an idle tab's traffic, which W8a measured at about 10 requests a minute (#239). Notifications
polled every 30 seconds and the maintenance state every 60 seconds, even with the SSE stream open.

Each client signed out on any `UNAUTHORIZED`, which also answers a wrong current password and a
refused sign-in, so the web branched on message strings. ADR-039 also required every revoking write
to invalidate the cache by hand, "which nothing couples".

The owner decided (#239, #85, 2026-11-24, decision 2b) that a revocation is pushed. The W8d choices
were made on 2026-11-25.

## Decision

This record supersedes ADR-048 as a whole. ADR-048's decisions, and the decisions of ADR-039 it
carries, stand unchanged except for the parts listed here. This record replaces:

- ADR-039's client-side periodic session check;
- the rule that a revoking path pairs its write with the cache invalidation by hand;
- which signal the automatic sign-outs act on.

- **One revocation path.** Every `tokenVersion` increment goes through `revokingTransaction`
  (`apps/api/src/lib/sessionRevocation.ts`). Inside the transaction, `revoke.user(id)` is the
  increment, and `revoke.where(...)` revokes in bulk with one `updateManyAndReturn`. `revoke.ended(id)`
  records a deactivation or a deletion, which ends sessions without an increment.

  After the commit, and only then, each recorded user's cached version is dropped. Their open
  streams receive `session-revoked` and are ended. A rolled-back transaction publishes nothing.

  `.semgrep/rules/session-revocation-helper.yml` refuses a bare increment anywhere else; tests are
  exempt. A future host command outside the API that must increment carries a reasoned `nosemgrep`
  and is bounded by the cache TTL. None exists today.
- **One sign-out signal.** A bearer that no longer authenticates is refused with `SessionEndedError`
  (`apps/api/src/lib/error.ts`). That covers a revoked or expired bearer, a missing or inactive user,
  and a session without `authTime`. The formatter sends it as `data.sessionEnded: true`.

  A request with no bearer gets a bare `UNAUTHORIZED`: a page still loading its session sends none.
  A wrong current password and a refused sign-in also stay bare. The web signs out only on
  `sessionEnded`: through the `QueryCache` and `MutationCache` handlers of `createQueryClient`, the
  JWT refresh, and the section-layout guard. A future step-up or assurance error never carries it.
- **One automatic sign-out.** `endSession()` (`apps/web/src/lib/sessionEnd.ts`) signs the browser
  out to `/login` once per page, without calling `auth.logout`: the session is already over.
  Everything that ends the session on the client uses it:
  - a `session-revoked` push;
  - an ended session reported by a call;
  - the password change;
  - `me.revokeAllSessions`.
- **Checks without a timer.** While the stream is down, `SessionVerification` calls `me.get` when
  the tab becomes visible or the network comes back; an open stream delivers the revocation itself,
  and a stream silent for 75 seconds (two missed beats) counts as dead and is reopened.
  `HeartbeatTicker` stays the fallback while the stream is down: a revoked session is seen at its
  next beat, within 60 seconds with network and a running tab, or at the next call.
- **Polling only while the stream is down.** Notifications and the maintenance state poll every
  2 minutes only while the stream is down (`useSseFallbackPoll`), and refetch when it reopens
  (`connected`). A change of read state pushes `notification` to the user's tabs, as a new
  notification does. A ticket refused for an ended session is not asked for again; one refused
  with a wait is retried after it.

Rejected alternatives:

- **Keep the 10-second check and add the push.** The check was the traffic #239 measured.
- **Mark every `UNAUTHORIZED` as ended.** A wrong password would sign the user out, and a page
  loading its session would sign itself out.
- **Coupling by convention.** Each revoking path invalidating and pushing by hand is the drift
  ADR-039 recorded.

## Consequences

- With the stream connected, a revocation shows within about a second. Without it, it shows at the
  next heartbeat, visibility change or call, which the API refuses.
- A deactivation or a deletion signs the user's open tabs out at once.
- The push reaches the streams of this API process only. The single-instance requirement of
  [ADR-011](011-single-instance-scaling-constraint.md) still applies; a second instance would need a shared channel.
- A stream that opened from a cache read just before an invalidation can miss the push. It ends at
  its next 30-second check.
- During an active maintenance window a user who cannot bypass it gets no ticket, so the end of the
  window shows at the 2-minute poll. The owner accepted this on 2026-11-25.
- A later push of an authorization change (`authz-changed`) will reuse the post-commit step,
  without ending streams.
